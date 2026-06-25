import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../helpers/app-bootstrap';
import { cleanDatabase } from '../../helpers/db-cleaner';

describe('Transactions: balance and budget invariants against the real DB', () => {
  let app: INestApplication;
  let accessToken: string;
  let accountId: string;
  let expenseCategoryId: string;
  let incomeCategoryId: string;
  let transactionId: string;

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
      .send({
        name: 'Test User',
        email: 'user@example.com',
        password: 'Password1!',
      });
    accessToken = authRes.body.accessToken;

    const accountRes = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Checking Account',
        type: 'corriente',
        initialBalance: 5000,
      });
    accountId = accountRes.body.id;

    const expCatRes = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Food', nature: 'expense' });
    expenseCategoryId = expCatRes.body.id;

    const incCatRes = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Salary', nature: 'income' });
    incomeCategoryId = incCatRes.body.id;

    await request(app.getHttpServer())
      .post('/budgets')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ categoryId: expenseCategoryId, limit: 1000, month, year });

    const txRes = await request(app.getHttpServer())
      .post('/transactions')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        accountId,
        categoryId: expenseCategoryId,
        amount: 100,
        nature: 'expense',
        transactionDate: now.toISOString(),
        description: 'Groceries',
      });
    transactionId = txRes.body.id;
  });

  // =======================================================================
  // POST /transactions  (HTTP contract: 201 + body, 400)
  // DTO validation and exception mapping are covered by the unit tests; here
  // we verify the route wires correctly into the real stack.
  // =======================================================================
  describe('POST /transactions', () => {
    it('returns 201 with the correct body when creating an expense', async () => {
      const res = await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          accountId,
          categoryId: expenseCategoryId,
          amount: 50,
          nature: 'expense',
          transactionDate: now.toISOString(),
          description: 'Coffee',
        })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('amount', 50);
    });

    it('returns 201 with the correct body when creating an income', async () => {
      const res = await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          accountId,
          categoryId: incomeCategoryId,
          amount: 2000,
          nature: 'income',
          transactionDate: now.toISOString(),
          description: 'Paycheck',
        })
        .expect(201);

      expect(res.body).toHaveProperty('nature', 'income');
    });

    it('rejects incompatible nature and category (400)', async () => {
      await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          accountId,
          categoryId: incomeCategoryId,
          amount: 50,
          nature: 'expense',
          transactionDate: now.toISOString(),
        })
        .expect(400);
    });
  });

  // =======================================================================
  // GET /transactions  (real pagination against Postgres)
  // =======================================================================
  describe('GET /transactions', () => {
    it('returns the user transactions with pagination', async () => {
      const res = await request(app.getHttpServer())
        .get('/transactions?page=1&limit=10')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(Array.isArray(res.body.data ?? res.body)).toBe(true);
    });
  });

  // =======================================================================
  // GET /transactions/account/:accountId  (real filtering by account + ownership)
  // =======================================================================
  describe('GET /transactions/account/:accountId', () => {
    it('returns the transactions for the given account', async () => {
      const res = await request(app.getHttpServer())
        .get(`/transactions/account/${accountId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(Array.isArray(res.body.data ?? res.body)).toBe(true);
    });

    it('rejects access to another user account (403)', async () => {
      const other = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          name: 'Other User',
          email: 'other@example.com',
          password: 'Password1!',
        });

      await request(app.getHttpServer())
        .get(`/transactions/account/${accountId}`)
        .set('Authorization', `Bearer ${other.body.accessToken}`)
        .expect(403);
    });

    it('responds 404 for a non-existent account', async () => {
      await request(app.getHttpServer())
        .get('/transactions/account/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);
    });
  });

  // =======================================================================
  // GET /transactions/:id  (persistence round-trip)
  // =======================================================================
  describe('GET /transactions/:id', () => {
    it('returns the requested transaction', async () => {
      const res = await request(app.getHttpServer())
        .get(`/transactions/${transactionId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('id', transactionId);
    });

    it('responds 404 for a non-existent id', async () => {
      await request(app.getHttpServer())
        .get('/transactions/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);
    });
  });

  // =======================================================================
  // DELETE /transactions/:id  (HTTP contract — balance reversal lives in the
  // balance-invariant block below)
  // =======================================================================
  describe('DELETE /transactions/:id', () => {
    it('deletes the transaction and makes it inaccessible (204 -> 404)', async () => {
      await request(app.getHttpServer())
        .delete(`/transactions/${transactionId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(204);

      await request(app.getHttpServer())
        .get(`/transactions/${transactionId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);
    });

    it('rejects deleting another user transaction (403)', async () => {
      const other = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          name: 'Other User',
          email: 'other@example.com',
          password: 'Password1!',
        });

      await request(app.getHttpServer())
        .delete(`/transactions/${transactionId}`)
        .set('Authorization', `Bearer ${other.body.accessToken}`)
        .expect(403);
    });
  });

  // =======================================================================
  // Invariant: the account balance reflects the movements
  // Unit tests verify the balance with in-memory fakes; here we check that the
  // real UoW commits the mutation and the GET returns it updated.
  // =======================================================================
  describe('Invariant: the account balance reflects the movements', () => {
    it('an expense reduces the currentBalance', async () => {
      await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          accountId,
          categoryId: expenseCategoryId,
          amount: 200,
          nature: 'expense',
          transactionDate: now.toISOString(),
          description: 'Extra expense',
        })
        .expect(201);

      const accountRes = await request(app.getHttpServer())
        .get(`/accounts/${accountId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      // initial balance 5000, base expense 100, new expense 200 -> 4700
      expect(accountRes.body.currentBalance).toBe(4700);
    });

    it('an income increases the currentBalance', async () => {
      await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          accountId,
          categoryId: incomeCategoryId,
          amount: 3000,
          nature: 'income',
          transactionDate: now.toISOString(),
          description: 'Extra paycheck',
        })
        .expect(201);

      const accountRes = await request(app.getHttpServer())
        .get(`/accounts/${accountId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      // initial balance 5000, base expense 100, income 3000 -> 7900
      expect(accountRes.body.currentBalance).toBe(7900);
    });

    it('the balance is correct after multiple movements', async () => {
      await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          accountId,
          categoryId: expenseCategoryId,
          amount: 200,
          nature: 'expense',
          transactionDate: now.toISOString(),
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          accountId,
          categoryId: expenseCategoryId,
          amount: 300,
          nature: 'expense',
          transactionDate: now.toISOString(),
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          accountId,
          categoryId: incomeCategoryId,
          amount: 1000,
          nature: 'income',
          transactionDate: now.toISOString(),
        })
        .expect(201);

      const accountRes = await request(app.getHttpServer())
        .get(`/accounts/${accountId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      // 5000 - 100(base) - 200 - 300 + 1000 = 5400
      expect(accountRes.body.currentBalance).toBe(5400);
    });

    it('deleting an expense restores the previous balance', async () => {
      const before = await request(app.getHttpServer())
        .get(`/accounts/${accountId}`)
        .set('Authorization', `Bearer ${accessToken}`);
      // 5000 - 100(base) = 4900
      expect(before.body.currentBalance).toBe(4900);

      await request(app.getHttpServer())
        .delete(`/transactions/${transactionId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(204);

      const after = await request(app.getHttpServer())
        .get(`/accounts/${accountId}`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(after.body.currentBalance).toBe(5000);
    });

    it('deleting an income reverts the credit', async () => {
      const incomeRes = await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          accountId,
          categoryId: incomeCategoryId,
          amount: 2000,
          nature: 'income',
          transactionDate: now.toISOString(),
          description: 'Bonus',
        })
        .expect(201);

      const incomeTransactionId = incomeRes.body.id;

      const before = await request(app.getHttpServer())
        .get(`/accounts/${accountId}`)
        .set('Authorization', `Bearer ${accessToken}`);
      // 5000 - 100(base) + 2000 = 6900
      expect(before.body.currentBalance).toBe(6900);

      await request(app.getHttpServer())
        .delete(`/transactions/${incomeTransactionId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(204);

      const after = await request(app.getHttpServer())
        .get(`/accounts/${accountId}`)
        .set('Authorization', `Bearer ${accessToken}`);
      // 6900 - 2000 = 4900
      expect(after.body.currentBalance).toBe(4900);
    });
  });

  // =======================================================================
  // Invariant: the budget limit is respected
  // beforeEach creates budget limit=1000 and a base tx of 100 -> spent=100.
  // Unit tests cover BudgetLimitExceededException with fakes; here the expense
  // sum is real (ScopedExpenseChecker against Postgres).
  // =======================================================================
  describe('Invariant: the budget limit is respected', () => {
    it('allows an expense that reaches exactly the limit', async () => {
      // 100 (base) + 900 = 1000 = exact limit -> must pass
      await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          accountId,
          categoryId: expenseCategoryId,
          amount: 900,
          nature: 'expense',
          transactionDate: now.toISOString(),
          description: 'Up to the limit',
        })
        .expect(201);
    });

    it('rejects the expense that exceeds the accumulated limit (422)', async () => {
      // 100(base) + 400 = 500 -> ok
      await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          accountId,
          categoryId: expenseCategoryId,
          amount: 400,
          nature: 'expense',
          transactionDate: now.toISOString(),
          description: 'First purchase',
        })
        .expect(201);

      // 500 + 600 = 1100 > 1000 -> must fail
      await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          accountId,
          categoryId: expenseCategoryId,
          amount: 600,
          nature: 'expense',
          transactionDate: now.toISOString(),
          description: 'Second purchase that exceeds',
        })
        .expect(422);
    });
  });

  // =======================================================================
  // Rule: expense categories require a budget in the period (409)
  // BudgetRequiredForExpenseTransactionException — the missing budgets row is
  // checked against the real DB, not a fake.
  // =======================================================================
  describe('Rule: expense categories require a budget in the period', () => {
    it('rejects an expense without a budget in the period (409)', async () => {
      const catRes = await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Transport', nature: 'expense' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          accountId,
          categoryId: catRes.body.id,
          amount: 50,
          nature: 'expense',
          transactionDate: now.toISOString(),
        })
        .expect(409);
    });
  });

  // =======================================================================
  // Rule: the account must have sufficient funds (422)
  // InsufficientFundsException — current balance < expense amount.
  // =======================================================================
  describe('Rule: the account must have sufficient funds', () => {
    it('rejects an expense that exceeds the balance (422)', async () => {
      const smallAccountRes = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Small account', type: 'corriente', initialBalance: 100 })
        .expect(201);

      const catRes = await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Small expenses', nature: 'expense' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/budgets')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ categoryId: catRes.body.id, limit: 9999, month, year })
        .expect(201);

      await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          accountId: smallAccountRes.body.id,
          categoryId: catRes.body.id,
          amount: 200,
          nature: 'expense',
          transactionDate: now.toISOString(),
        })
        .expect(422);
    });

    it('rejects an expense on a zero-balance account (422)', async () => {
      const zeroAccountRes = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Empty account', type: 'corriente', initialBalance: 0 })
        .expect(201);

      const catRes = await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Zero expenses', nature: 'expense' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/budgets')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ categoryId: catRes.body.id, limit: 9999, month, year })
        .expect(201);

      await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          accountId: zeroAccountRes.body.id,
          categoryId: catRes.body.id,
          amount: 1,
          nature: 'expense',
          transactionDate: now.toISOString(),
        })
        .expect(422);
    });
  });

  // =======================================================================
  // Rule: archived accounts reject movements (409)
  // CannotOperateOnArchivedAccountException — checked against the persisted
  // isArchived flag in Postgres, not an in-memory mock.
  // =======================================================================
  describe('Rule: archived accounts reject movements', () => {
    it('rejects a transaction on an archived account (409)', async () => {
      await request(app.getHttpServer())
        .patch(`/accounts/${accountId}/archive`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          accountId,
          categoryId: expenseCategoryId,
          amount: 50,
          nature: 'expense',
          transactionDate: now.toISOString(),
        })
        .expect(409);
    });

    it('allows the transaction after unarchiving the account', async () => {
      await request(app.getHttpServer())
        .patch(`/accounts/${accountId}/archive`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/accounts/${accountId}/unarchive`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          accountId,
          categoryId: expenseCategoryId,
          amount: 50,
          nature: 'expense',
          transactionDate: now.toISOString(),
          description: 'After unarchive',
        })
        .expect(201);
    });
  });

  // =======================================================================
  // Ownership barrier (smoke of the real global guard — not repeated per verb)
  // =======================================================================
  describe('ownership barrier', () => {
    it('responds 401 without a token (global guard active)', async () => {
      await request(app.getHttpServer())
        .post('/transactions')
        .send({})
        .expect(401);
    });
  });
});
