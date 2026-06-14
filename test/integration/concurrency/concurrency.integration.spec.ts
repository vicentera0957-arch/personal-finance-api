import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../helpers/app-bootstrap';
import { cleanDatabase } from '../../helpers/db-cleaner';

describe('Concurrencia: locks pesimistas y serialización de invariantes bajo carga', () => {
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
      .send({ name: 'Test User', email: 'concurrency@example.com', password: 'Password1!' });
    accessToken = authRes.body.accessToken;

    const accountRes = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Cuenta Test', type: 'corriente', initialBalance: 10_000 });
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

  // =======================================================================
  // N inflows concurrentes en la misma cuenta
  // Sin el lock en ScopedAccountRepository.findById, dos requests concurrentes
  // leen el mismo currentBalance y ambos escriben balance+100 en lugar de
  // (balance+100)+100. El resultado sería 10_100 en vez de 10_200.
  // Con FOR UPDATE, el segundo request bloquea hasta que el primero commit.
  // =======================================================================
  describe('N inflows concurrentes en la misma cuenta', () => {
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

  // =======================================================================
  // N expenses concurrentes respetan el límite del presupuesto
  // Sin el lock en ScopedBudgetRepository.findByUserIdAndCategoryIdAndPeriod y
  // en sumExpenseAmountByUserCategoryAndPeriod, todos los requests concurrentes
  // leen sum=90 al mismo tiempo, todos validan 90+5=95 ≤ 100 y todos pasan,
  // dejando la suma final en 90+25=115 > 100 (invariante violado).
  // Con FOR UPDATE sobre la fila del presupuesto, la comprobación es atómica:
  // el presupuesto actúa como mutex del invariante.
  // =======================================================================
  describe('N expenses concurrentes respetan el límite del presupuesto', () => {
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

    // Regresión: período vacío. El test anterior arrancaba con $90 ya gastados,
    // así que el FOR UPDATE sobre el SUM agarraba filas reales y serializaba
    // por casualidad. Con período vacío no hay filas que lockear, y la única
    // serialización viable es el lock sobre la fila del budget. Antes del fix
    // (orden SUM → budget) este test falla porque ambas TX leen sum=0 antes de
    // tocar el budget. Con el orden invertido (budget → SUM) cada SUM se ejecuta
    // post-gate y ve los commits previos.
    it('respeta el límite también cuando el período arranca vacío', async () => {
      // Budget: limit=$100, sin gasto previo. amount=60 → solo uno puede pasar
      // (0+60 ≤ 100 ✓; el siguiente sería 60+60=120 > 100 ✗).
      const N = 5;
      const amount = 60;

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
              description: 'Gasto concurrente en período vacío',
            }),
        ),
      );

      const successes = results.filter((r) => r.status === 201);
      const failures = results.filter((r) => r.status === 422);

      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(N - 1);

      const accountRes = await request(app.getHttpServer())
        .get(`/accounts/${accountId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(accountRes.body.currentBalance).toBe(10_000 - amount);
    });
  });

  // =======================================================================
  // PATCH /budgets/:id/limit compite con POST /transactions
  // Sin locks, el POST puede leer el budget con limit=100 mientras el PATCH
  // aún no ha commit, valida 90+5=95 ≤ 100 y pasa — incluso si el PATCH
  // rebaja el límite a 90 justo después. El invariante queda violado silenciosamente.
  // Con FOR UPDATE en ambos use cases, el acceso al budget row es serial:
  // quien gana el lock primero completa su sección crítica de forma atómica.
  // =======================================================================
  describe('PATCH /budgets/:id/limit compite con POST /transactions', () => {
    it('el estado final es consistente y ninguna operación produce error 500', async () => {
      // Gasto previo: $90 de $100. El PATCH baja el límite a $90 (== gastado, válido
      // por B4: el rechazo es estricto `< gastado`). Es una verdadera carrera por el
      // lock de la fila del budget: exactamente una de las dos operaciones "gana".
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
          .send({ limit: 90 }),
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

      // Con la fila del budget como mutex, exactamente una operación gana el lock:
      //   - PATCH gana: baja el límite a 90 (90 == gastado, válido) → 200; luego el
      //     POST ve 90+5=95 > 90 → 422 (límite excedido).
      //   - POST gana: 90+5=95 ≤ 100 → 201 (gastado=95); luego el PATCH a 90 < 95
      //     viola B4 → 409.
      const patchWon = patchRes.status === 200 && postRes.status === 422;
      const postWon = patchRes.status === 409 && postRes.status === 201;
      expect(patchWon || postWon).toBe(true);

      // El balance refleja exactamente si el POST se comprometió o no.
      const accountRes = await request(app.getHttpServer())
        .get(`/accounts/${accountId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const expectedBalance = postWon ? 10_000 - 90 - 5 : 10_000 - 90;
      expect(accountRes.body.currentBalance).toBe(expectedBalance);
    });
  });
});
