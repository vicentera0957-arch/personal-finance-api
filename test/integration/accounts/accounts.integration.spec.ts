import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../helpers/app-bootstrap';
import { cleanDatabase } from '../../helpers/db-cleaner';

describe('Accounts: lifecycle persistence and FK-reference blocking against the real DB', () => {
  let app: INestApplication;
  let accessToken: string;
  let accountId: string;

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
      .send({ name: 'Checking Account', type: 'corriente', initialBalance: 5000 });
    accountId = account.body.id;
  });

  // Creates an expense transaction on the account (needs an expense category + budget).
  const createExpenseTransaction = async (): Promise<string> => {
    const cat = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Food', nature: 'expense' });

    await request(app.getHttpServer())
      .post('/budgets')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ categoryId: cat.body.id, limit: 1000, month, year });

    const tx = await request(app.getHttpServer())
      .post('/transactions')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        accountId,
        categoryId: cat.body.id,
        amount: 100,
        nature: 'expense',
        transactionDate: now.toISOString(),
        description: 'Purchase',
      });
    return tx.body.id;
  };

  // =======================================================================
  // Creation round-trip: POST persists and GET returns it with the seeded
  // initial balance. Proves mapper + migrated schema + ORM agree.
  // =======================================================================
  describe('POST /accounts -> GET /accounts/:id', () => {
    it('creates and retrieves the account with the seeded initial balance', async () => {
      const res = await request(app.getHttpServer())
        .get(`/accounts/${accountId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('id', accountId);
      expect(res.body).toHaveProperty('name', 'Checking Account');
      expect(res.body).toHaveProperty('currentBalance', 5000);
      expect(res.body).toHaveProperty('isArchived', false);
    });
  });

  // =======================================================================
  // The lifecycle PERSISTS: the rule (no double-archive, etc.) is already in
  // the domain/use case; here we check the real UoW commits the flag to Postgres.
  // =======================================================================
  describe('PATCH /accounts/:id/archive · /unarchive', () => {
    it('archives (GET shows isArchived=true) and unarchives (back to false)', async () => {
      await request(app.getHttpServer())
        .patch(`/accounts/${accountId}/archive`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const archived = await request(app.getHttpServer())
        .get(`/accounts/${accountId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(archived.body.isArchived).toBe(true);

      await request(app.getHttpServer())
        .patch(`/accounts/${accountId}/unarchive`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const restored = await request(app.getHttpServer())
        .get(`/accounts/${accountId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(restored.body.isArchived).toBe(false);
    });
  });

  // =======================================================================
  // Cross-module: the real FK (transactions -> accounts) blocks deletion.
  // The controller unit test mocks AccountInUseException; only the real DB
  // proves the FK exists and fires (catch 23503).
  // =======================================================================
  describe('Cross-module: DELETE /accounts/:id with movements', () => {
    it('rejects deleting an account with an associated transaction (409)', async () => {
      await createExpenseTransaction();

      await request(app.getHttpServer())
        .delete(`/accounts/${accountId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(409);
    });

    it('allows deleting the account after deleting the transaction (204)', async () => {
      const transactionId = await createExpenseTransaction();

      await request(app.getHttpServer())
        .delete(`/transactions/${transactionId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(204);

      await request(app.getHttpServer())
        .delete(`/accounts/${accountId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(204);
    });
  });

  // =======================================================================
  // Ownership barrier (one smoke of the real chain; not repeated per verb).
  // =======================================================================
  describe('ownership barrier', () => {
    it('GET /accounts/:id of another user responds 403 (real chain)', async () => {
      const other = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ name: 'Other User', email: 'other@example.com', password: 'Password1!' });

      await request(app.getHttpServer())
        .get(`/accounts/${accountId}`)
        .set('Authorization', `Bearer ${other.body.accessToken}`)
        .expect(403);
    });
  });
});
