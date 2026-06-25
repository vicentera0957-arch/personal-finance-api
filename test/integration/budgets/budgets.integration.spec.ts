import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../helpers/app-bootstrap';
import { cleanDatabase } from '../../helpers/db-cleaner';

describe('Budgets: limit >= spent invariant and spend-blocking, against real data', () => {
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
      .send({
        name: 'Test User',
        email: 'user@example.com',
        password: 'Password1!',
      });
    accessToken = auth.body.accessToken;

    const account = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Account', type: 'corriente', initialBalance: 5000 });
    accountId = account.body.id;

    const cat = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Food', nature: 'expense' });
    categoryId = cat.body.id;

    const budget = await request(app.getHttpServer())
      .post('/budgets')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ categoryId, limit: 500, month, year });
    budgetId = budget.body.id;
  });

  // Records a real expense in the base budget's category/period.
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
        description: 'Expense',
      })
      .expect(201);
    return tx.body.id;
  };

  // =======================================================================
  // Real period uniqueness (userId, categoryId, month, year): the constraint
  // exists in the migrated schema and fires 409 (catch 23505).
  // =======================================================================
  describe('POST /budgets', () => {
    it('creates a budget and GET returns it (round-trip)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/budgets/${budgetId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('id', budgetId);
      expect(res.body).toHaveProperty('limit', 500);
      expect(res.body).toHaveProperty('month', month);
      expect(res.body).toHaveProperty('year', year);
    });

    it('rejects a duplicate (user, category, month, year) with 409 — real constraint', async () => {
      await request(app.getHttpServer())
        .post('/budgets')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ categoryId, limit: 300, month, year })
        .expect(409);
    });
  });

  // =======================================================================
  // Invariant B4: the limit cannot drop below the real period spend.
  // The use-case spec mocks the ScopedExpenseChecker; here the sum runs over
  // real transactions via the real UoW.
  // =======================================================================
  describe('PATCH /budgets/:id/limit', () => {
    it('raises the limit (200)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/budgets/${budgetId}/limit`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ limit: 800 })
        .expect(200);

      expect(res.body).toHaveProperty('limit', 800);
    });

    it('rejects lowering the limit below what is already spent in the period (409)', async () => {
      await spend(100); // real spend of 100 in the period

      // Lowering the limit to 50 < 100 spent -> BudgetLimitBelowSpentException (409).
      await request(app.getHttpServer())
        .patch(`/budgets/${budgetId}/limit`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ limit: 50 })
        .expect(409);
    });
  });

  // =======================================================================
  // Cross-module: a budget with spend in the period cannot be deleted.
  // BudgetHasTransactionsInPeriodException is decided by summing real
  // transactions under the UoW; mocked in the unit test.
  // =======================================================================
  describe('Cross-module: DELETE /budgets/:id with spend', () => {
    it('rejects deleting a budget with a transaction in the period (409)', async () => {
      await spend(100);

      await request(app.getHttpServer())
        .delete(`/budgets/${budgetId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(409);
    });

    it('allows deleting it after deleting the transaction (204)', async () => {
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
