import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../helpers/app-bootstrap';
import { cleanDatabase } from '../../helpers/db-cleaner';

describe('Presupuestos: invariante límite ≥ gastado y bloqueo por gastos, contra datos reales', () => {
  let app: INestApplication;
  let accessToken: string;
  let accountId: string;
  let categoryId: string;
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

    const auth = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'Test User', email: 'user@example.com', password: 'Password1!' });
    accessToken = auth.body.accessToken;

    const account = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Cuenta', type: 'corriente', initialBalance: 5000 });
    accountId = account.body.id;

    const cat = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Alimentación', nature: 'expense' });
    categoryId = cat.body.id;

    const budget = await request(app.getHttpServer())
      .post('/budgets')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ categoryId, limit: 500, month, year });
    budgetId = budget.body.id;
  });

  // Registra un gasto real en la categoría/período del budget base.
  const spend = async (amount: number): Promise<string> => {
    const tx = await request(app.getHttpServer())
      .post('/transactions')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        accountId,
        categoryId,
        amount,
        nature: 'expense',
        transactionDate: now.toISOString(),
        description: 'Gasto',
      })
      .expect(201);
    return tx.body.id;
  };

  // =======================================================================
  // Unicidad real de período (userId, categoryId, month, year): la constraint
  // existe en el esquema migrado y dispara 409 (catch 23505).
  // =======================================================================
  describe('POST /budgets', () => {
    it('crea un presupuesto y el GET lo devuelve (round-trip)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/budgets/${budgetId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('id', budgetId);
      expect(res.body).toHaveProperty('limit', 500);
      expect(res.body).toHaveProperty('month', month);
      expect(res.body).toHaveProperty('year', year);
    });

    it('rechaza un duplicado (user, category, month, year) con 409 — constraint real', async () => {
      await request(app.getHttpServer())
        .post('/budgets')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ categoryId, limit: 300, month, year })
        .expect(409);
    });
  });

  // =======================================================================
  // Invariante B4: el límite no puede bajar por debajo del gasto real del período.
  // El use-case spec mockea el ScopedExpenseChecker; aquí la suma se hace sobre
  // transacciones reales vía el UoW real.
  // =======================================================================
  describe('PATCH /budgets/:id/limit', () => {
    it('sube el límite (200)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/budgets/${budgetId}/limit`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ limit: 800 })
        .expect(200);

      expect(res.body).toHaveProperty('limit', 800);
    });

    it('rechaza bajar el límite por debajo de lo ya gastado en el período (409)', async () => {
      await spend(100); // gasto real de 100 en el período

      // Bajar el límite a 50 < 100 gastado → BudgetLimitBelowSpentException (409).
      await request(app.getHttpServer())
        .patch(`/budgets/${budgetId}/limit`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ limit: 50 })
        .expect(409);
    });
  });

  // =======================================================================
  // Cross-module: el budget con gastos en el período no se puede eliminar.
  // BudgetHasTransactionsInPeriodException se decide sumando transacciones
  // reales bajo el UoW; mockeado en unit.
  // =======================================================================
  describe('Cross-module: DELETE /budgets/:id con gastos', () => {
    it('rechaza eliminar un budget con una transacción en el período (409)', async () => {
      await spend(100);

      await request(app.getHttpServer())
        .delete(`/budgets/${budgetId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(409);
    });

    it('permite eliminarlo tras borrar la transacción (204)', async () => {
      const transactionId = await spend(100);

      await request(app.getHttpServer())
        .delete(`/transactions/${transactionId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(204);

      await request(app.getHttpServer())
        .delete(`/budgets/${budgetId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(204);
    });
  });
});
