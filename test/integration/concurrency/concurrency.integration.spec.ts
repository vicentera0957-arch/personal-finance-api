import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../helpers/app-bootstrap';
import { cleanDatabase } from '../../helpers/db-cleaner';

describe('Concurrencia — Pessimistic Locks (Integration)', () => {
  let app: INestApplication;
  let accessToken: string;
  let accountId: string;
  let incomeCategoryId: string;
  let expenseCategoryId: string;
  let budgetId: string;

  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(app);

    const authRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'concurrency@example.com', password: 'Password1!' });
    accessToken = authRes.body.accessToken;

    const accountRes = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Cuenta Test', type: 'checking', initialBalance: 10_000 });
    accountId = accountRes.body.id;

    const incCatRes = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Salario', nature: 'income' });
    incomeCategoryId = incCatRes.body.id;

    const expCatRes = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Alimentación', nature: 'expense' });
    expenseCategoryId = expCatRes.body.id;

    const budgetRes = await request(app.getHttpServer())
      .post('/budgets')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ categoryId: expenseCategoryId, limit: 100, month, year });
    budgetId = budgetRes.body.id;
  });

  // ── Bug B ──────────────────────────────────────────────────────────────────
  // Sin el lock en ScopedAccountRepository.findById, dos requests concurrentes
  // leen el mismo currentBalance y ambos escriben balance+100 en lugar de
  // balance+100 y (balance+100)+100. El resultado sería 10_100 en vez de 10_200.
  // Con FOR UPDATE, el segundo request bloquea hasta que el primero commit.

  describe('Bug B — N inflows concurrentes en la misma cuenta', () => {
    it('produce el balance acumulado exacto sin lost updates', async () => {
      const N = 10;
      const amount = 100;

      const results = await Promise.all(
        Array.from({ length: N }, () =>
          request(app.getHttpServer())
            .post('/transactions')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({
              accountId,
              categoryId: incomeCategoryId,
              amount,
              nature: 'income',
              transactionDate: now.toISOString(),
              description: 'Ingreso concurrente',
            }),
        ),
      );

      const successes = results.filter((r) => r.status === 201);
      expect(successes).toHaveLength(N);

      const accountRes = await request(app.getHttpServer())
        .get(`/accounts/${accountId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      // Si algún update se pierde, el balance será mayor que el esperado.
      expect(accountRes.body.currentBalance).toBe(10_000 + N * amount);
    });
  });

  // ── Bug A — suma concurrente ───────────────────────────────────────────────
  // Sin el lock en ScopedBudgetRepository.findByUserIdAndCategoryIdAndPeriod y
  // en sumExpenseAmountByUserCategoryAndPeriod, todos los requests concurrentes
  // leen sum=90 al mismo tiempo, todos validan 90+5=95 ≤ 100 y todos pasan,
  // dejando la suma final en 90+25=115 > 100 (invariante violado).
  // Con FOR UPDATE sobre la fila del presupuesto, la comprobación es atómica:
  // el presupuesto actúa como mutex del invariante.

  describe('Bug A — N expenses concurrentes respetan el límite del presupuesto', () => {
    it('la suma de gastos comprometidos nunca supera el límite', async () => {
      // Gasto previo: $90 de $100 de límite. Queda margen exacto para 2 expenses
      // de $5 (90+5=95 ≤ 100, 95+5=100 ≤ 100, 100+5=105 > 100 → rechazo).
      await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          accountId,
          categoryId: expenseCategoryId,
          amount: 90,
          nature: 'expense',
          transactionDate: now.toISOString(),
          description: 'Gasto base',
        })
        .expect(201);

      const N = 5;
      const amount = 5;

      const results = await Promise.all(
        Array.from({ length: N }, () =>
          request(app.getHttpServer())
            .post('/transactions')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({
              accountId,
              categoryId: expenseCategoryId,
              amount,
              nature: 'expense',
              transactionDate: now.toISOString(),
              description: 'Gasto concurrente',
            }),
        ),
      );

      const successes = results.filter((r) => r.status === 201);
      const failures = results.filter((r) => r.status === 422);

      // Con locks serializados: 90+5=95 pasa, 95+5=100 pasa, 100+5=105 falla.
      // Solo 2 de 5 pueden comprometerse dentro del límite.
      expect(successes.length).toBeLessThanOrEqual(2);
      expect(failures.length).toBeGreaterThanOrEqual(3);

      // El balance de la cuenta debe reflejar exactamente los gastos comprometidos.
      // Si hubiera lost updates en el balance, este assert también fallaría.
      const accountRes = await request(app.getHttpServer())
        .get(`/accounts/${accountId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const expectedBalance = 10_000 - 90 - successes.length * amount;
      expect(accountRes.body.currentBalance).toBe(expectedBalance);
    });
  });

  // ── Bug A — PATCH vs POST ─────────────────────────────────────────────────
  // Sin locks, el POST puede leer el budget con limit=100 mientras el PATCH
  // aún no ha commit, valida 90+5=95 ≤ 100 y pasa — incluso si el PATCH
  // rebaja el límite a 70 justo después. El invariante queda violado silenciosamente.
  // Con FOR UPDATE en ambos use cases, el acceso al budget row es serial:
  // quien gana el lock primero completa su sección crítica de forma atómica.

  describe('Bug A — PATCH /limit compite con POST /transactions', () => {
    it('el estado final es consistente y ninguna operación produce error 500', async () => {
      // Gasto previo: $90. Margen original: $10 (90+5=95 ≤ 100 pasaría).
      // El PATCH baja el límite a $70 (90+5=95 > 70 fallaría si PATCH gana el lock).
      await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          accountId,
          categoryId: expenseCategoryId,
          amount: 90,
          nature: 'expense',
          transactionDate: now.toISOString(),
          description: 'Gasto base',
        })
        .expect(201);

      const [patchRes, postRes] = await Promise.all([
        request(app.getHttpServer())
          .patch(`/budgets/${budgetId}/limit`)
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ limit: 70 }),
        request(app.getHttpServer())
          .post('/transactions')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            accountId,
            categoryId: expenseCategoryId,
            amount: 5,
            nature: 'expense',
            transactionDate: now.toISOString(),
            description: 'Gasto concurrente',
          }),
      ]);

      // Ninguno debe producir un error interno (indicaría inconsistencia de DB).
      expect(patchRes.status).not.toBe(500);
      expect(postRes.status).not.toBe(500);

      // El PATCH no tiene restricción de negocio que lo pueda rechazar.
      expect(patchRes.status).toBe(200);

      // El POST debe haber sido validado contra el límite vigente en su momento:
      //   - POST ganó el lock (antes del PATCH): 90+5=95 ≤ 100 → 201
      //   - PATCH ganó el lock (antes del POST): 90+5=95 > 70   → 422
      expect([201, 422]).toContain(postRes.status);

      // El balance refleja exactamente si el POST se comprometió o no.
      const accountRes = await request(app.getHttpServer())
        .get(`/accounts/${accountId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const postSucceeded = postRes.status === 201;
      const expectedBalance = postSucceeded ? 10_000 - 90 - 5 : 10_000 - 90;
      expect(accountRes.body.currentBalance).toBe(expectedBalance);
    });
  });
});
