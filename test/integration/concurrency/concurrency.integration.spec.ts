import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../helpers/app-bootstrap';
import { cleanDatabase } from '../../helpers/db-cleaner';

describe('Concurrency: pessimistic locks and invariant serialization under load', () => {
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
      .send({ name: 'Test Account', type: 'corriente', initialBalance: 10_000 });
    accountId = accountRes.body.id;

    const incCatRes = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Salary', nature: 'income' });
    incomeCategoryId = incCatRes.body.id;

    const expCatRes = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Food', nature: 'expense' });
    expenseCategoryId = expCatRes.body.id;

    const budgetRes = await request(app.getHttpServer())
      .post('/budgets')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ categoryId: expenseCategoryId, limit: 100, month, year });
    budgetId = budgetRes.body.id;
  });

  // =======================================================================
  // N concurrent inflows on the same account
  // Without the lock in ScopedAccountRepository.findById, two concurrent requests
  // read the same currentBalance and both write balance+100 instead of
  // (balance+100)+100. The result would be 10_100 instead of 10_200.
  // With FOR UPDATE, the second request blocks until the first commits.
  // =======================================================================
  describe('N concurrent inflows on the same account', () => {
    it('produces the exact accumulated balance with no lost updates', async () => {
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
              description: 'Concurrent income',
            }),
        ),
      );

      const successes = results.filter((r) => r.status === 201);
      expect(successes).toHaveLength(N);

      const accountRes = await request(app.getHttpServer())
        .get(`/accounts/${accountId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      // If any update is lost, the balance will be higher than expected.
      expect(accountRes.body.currentBalance).toBe(10_000 + N * amount);
    });
  });

  // =======================================================================
  // N concurrent expenses respect the budget limit
  // Without the lock in ScopedBudgetRepository.findByUserIdAndCategoryIdAndPeriod
  // and in sumExpenseAmountByUserCategoryAndPeriod, all concurrent requests read
  // sum=90 at the same time, all validate 90+5=95 <= 100 and all pass, leaving the
  // final sum at 90+25=115 > 100 (invariant violated).
  // With FOR UPDATE on the budget row, the check is atomic: the budget acts as the
  // invariant's mutex.
  // =======================================================================
  describe('N concurrent expenses respect the budget limit', () => {
    it('the committed expense sum never exceeds the limit', async () => {
      // Prior spend: $90 of the $100 limit. Exactly enough room for 2 expenses of
      // $5 (90+5=95 <= 100, 95+5=100 <= 100, 100+5=105 > 100 -> reject).
      await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          accountId,
          categoryId: expenseCategoryId,
          amount: 90,
          nature: 'expense',
          transactionDate: now.toISOString(),
          description: 'Base expense',
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
              description: 'Concurrent expense',
            }),
        ),
      );

      const successes = results.filter((r) => r.status === 201);
      const failures = results.filter((r) => r.status === 422);

      // With serialized locks: 90+5=95 passes, 95+5=100 passes, 100+5=105 fails.
      // Only 2 of 5 can be committed within the limit.
      expect(successes.length).toBeLessThanOrEqual(2);
      expect(failures.length).toBeGreaterThanOrEqual(3);

      // The account balance must reflect exactly the committed expenses.
      // If there were lost updates on the balance, this assert would also fail.
      const accountRes = await request(app.getHttpServer())
        .get(`/accounts/${accountId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const expectedBalance = 10_000 - 90 - successes.length * amount;
      expect(accountRes.body.currentBalance).toBe(expectedBalance);
    });

    // Regression: empty period. The previous test started with $90 already spent,
    // so the FOR UPDATE on the SUM grabbed real rows and serialized by accident.
    // With an empty period there are no rows to lock, and the only viable
    // serialization is the lock on the budget row. Before the fix (order SUM ->
    // budget) this test fails because both TX read sum=0 before touching the
    // budget. With the inverted order (budget -> SUM) each SUM runs post-gate and
    // sees the prior commits.
    it('respects the limit even when the period starts empty', async () => {
      // Budget: limit=$100, no prior spend. amount=60 -> only one can pass
      // (0+60 <= 100 ok; the next would be 60+60=120 > 100 fail).
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
              description: 'Concurrent expense in empty period',
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
  // PATCH /budgets/:id/limit competes with POST /transactions
  // Without locks, the POST can read the budget with limit=100 while the PATCH
  // hasn't committed yet, validate 90+5=95 <= 100 and pass — even if the PATCH
  // lowers the limit to 90 right after. The invariant is violated silently.
  // With FOR UPDATE in both use cases, access to the budget row is serial:
  // whoever wins the lock first completes its critical section atomically.
  // =======================================================================
  describe('PATCH /budgets/:id/limit competes with POST /transactions', () => {
    it('the final state is consistent and no operation produces a 500', async () => {
      // Prior spend: $90 of $100. The PATCH lowers the limit to $90 (== spent, valid
      // by B4: the rejection is strict `< spent`). It is a true race for the budget
      // row lock: exactly one of the two operations "wins".
      await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          accountId,
          categoryId: expenseCategoryId,
          amount: 90,
          nature: 'expense',
          transactionDate: now.toISOString(),
          description: 'Base expense',
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
            description: 'Concurrent expense',
          }),
      ]);

      // Neither must produce an internal error (it would indicate DB inconsistency).
      expect(patchRes.status).not.toBe(500);
      expect(postRes.status).not.toBe(500);

      // With the budget row as the mutex, exactly one operation wins the lock:
      //   - PATCH wins: lowers the limit to 90 (90 == spent, valid) -> 200; then the
      //     POST sees 90+5=95 > 90 -> 422 (limit exceeded).
      //   - POST wins: 90+5=95 <= 100 -> 201 (spent=95); then the PATCH to 90 < 95
      //     violates B4 -> 409.
      const patchWon = patchRes.status === 200 && postRes.status === 422;
      const postWon = patchRes.status === 409 && postRes.status === 201;
      expect(patchWon || postWon).toBe(true);

      // The balance reflects exactly whether the POST committed or not.
      const accountRes = await request(app.getHttpServer())
        .get(`/accounts/${accountId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const expectedBalance = postWon ? 10_000 - 90 - 5 : 10_000 - 90;
      expect(accountRes.body.currentBalance).toBe(expectedBalance);
    });
  });

  // =======================================================================
  // Two concurrent expenses: SAME account, DIFFERENT budget
  // Proves the account lock is NOT redundant with the budget lock.
  // Each expense takes a DIFFERENT budget row (different categories), so they do
  // NOT serialize against each other via the budget. Only the FOR UPDATE on the
  // account row prevents the lost update on the balance.
  // Without that lock: the balance would end at 9_950 or 9_970 instead of 9_920.
  // =======================================================================
  describe('Two concurrent expenses: same account, different budget', () => {
    it('the balance reflects both expenses (account lock serializes even if the budget does not)', async () => {
      // Second expense category + its budget, with a generous limit so the only
      // factor at play is the balance, not the budget limit.
      const cat2Res = await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Transport', nature: 'expense' });
      const category2Id = cat2Res.body.id;

      await request(app.getHttpServer())
        .post('/budgets')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ categoryId: category2Id, limit: 10_000, month, year })
        .expect(201);

      // original budget (expenseCategoryId) has limit 100 -> 50 fits comfortably.
      const [r1, r2] = await Promise.all([
        request(app.getHttpServer())
          .post('/transactions')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            accountId,
            categoryId: expenseCategoryId,
            amount: 50,
            nature: 'expense',
            transactionDate: now.toISOString(),
            description: 'Food expense',
          }),
        request(app.getHttpServer())
          .post('/transactions')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            accountId,
            categoryId: category2Id,
            amount: 30,
            nature: 'expense',
            transactionDate: now.toISOString(),
            description: 'Transport expense',
          }),
      ]);

      // Both fit within their respective budgets -> both 201.
      expect(r1.status).toBe(201);
      expect(r2.status).toBe(201);

      const accountRes = await request(app.getHttpServer())
        .get(`/accounts/${accountId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      // 10_000 - 50 - 30 = 9_920. Without the account lock -> lost update (9_950/9_970).
      expect(accountRes.body.currentBalance).toBe(10_000 - 50 - 30);
    });
  });

  // =======================================================================
  // Race 2 — POST /transactions competes with PATCH /accounts/:id/archive
  // Both take FOR UPDATE on the SAME account row. Exactly one wins:
  //   - create wins: balance 10_100; then archive ok (200).
  //   - archive wins: the account becomes archived; the create on an archived
  //     account -> CannotOperateOnArchivedAccountException (409); balance 10_000.
  // In both cases archive responds 200 (archiving doesn't depend on the balance);
  // the outcome is distinguished by the POST status.
  // =======================================================================
  describe('POST /transactions competes with PATCH /accounts/:id/archive (Race 2)', () => {
    it('the final state is consistent and nobody produces a 500', async () => {
      const [postRes, archiveRes] = await Promise.all([
        request(app.getHttpServer())
          .post('/transactions')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            accountId,
            categoryId: incomeCategoryId,
            amount: 100,
            nature: 'income',
            transactionDate: now.toISOString(),
            description: 'Income vs archive',
          }),
        request(app.getHttpServer())
          .patch(`/accounts/${accountId}/archive`)
          .set('Authorization', `Bearer ${accessToken}`),
      ]);

      expect(postRes.status).not.toBe(500);
      expect(archiveRes.status).not.toBe(500);
      expect(archiveRes.status).toBe(200);

      const createWon = postRes.status === 201;
      const archiveWon = postRes.status === 409;
      expect(createWon || archiveWon).toBe(true);

      const accountRes = await request(app.getHttpServer())
        .get(`/accounts/${accountId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(accountRes.body.currentBalance).toBe(createWon ? 10_100 : 10_000);
    });
  });

  // =======================================================================
  // Race 3 — Two concurrent DELETE /transactions/:id on the same tx
  // FOR UPDATE on the transaction row serializes: one deletes (204) and reverts
  // the balance ONCE; the other, once unblocked, sees null -> 404.
  // Without the lock: double balance reversal (it would end at 9_900).
  // =======================================================================
  describe('Two concurrent DELETE /transactions/:id (Race 3)', () => {
    it('deletes once, reverts once, the second returns 404', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          accountId,
          categoryId: incomeCategoryId,
          amount: 100,
          nature: 'income',
          transactionDate: now.toISOString(),
          description: 'Income to delete twice',
        })
        .expect(201);
      const txId = createRes.body.id;
      // balance is now 10_100

      const results = await Promise.all([
        request(app.getHttpServer())
          .delete(`/transactions/${txId}`)
          .set('Authorization', `Bearer ${accessToken}`),
        request(app.getHttpServer())
          .delete(`/transactions/${txId}`)
          .set('Authorization', `Bearer ${accessToken}`),
      ]);

      results.forEach((r) => expect(r.status).not.toBe(500));
      const statuses = results.map((r) => r.status).sort((a, b) => a - b);
      expect(statuses).toEqual([204, 404]);

      const accountRes = await request(app.getHttpServer())
        .get(`/accounts/${accountId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      // Reverted ONCE: 10_100 - 100 = 10_000. A double reversal would give 9_900.
      expect(accountRes.body.currentBalance).toBe(10_000);
    });
  });

  // =======================================================================
  // Race 1 — DELETE /budgets/:id competes with POST /transactions (expense)
  // FOR UPDATE on the budget row serializes. Exactly one wins:
  //   - delete wins: budget deleted (204); the expense with no budget in the period
  //     -> BudgetRequiredForExpenseTransactionException (409); balance 10_000.
  //   - create wins: expense 201 (balance 9_950); the delete with spend in the
  //     period -> BudgetHasTransactionsInPeriodException (409); budget NOT deleted.
  // =======================================================================
  describe('DELETE /budgets/:id competes with POST /transactions (Race 1)', () => {
    it('the final state is consistent and nobody produces a 500', async () => {
      const [deleteRes, postRes] = await Promise.all([
        request(app.getHttpServer())
          .delete(`/budgets/${budgetId}`)
          .set('Authorization', `Bearer ${accessToken}`),
        request(app.getHttpServer())
          .post('/transactions')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            accountId,
            categoryId: expenseCategoryId,
            amount: 50,
            nature: 'expense',
            transactionDate: now.toISOString(),
            description: 'Expense vs delete budget',
          }),
      ]);

      expect(deleteRes.status).not.toBe(500);
      expect(postRes.status).not.toBe(500);

      const deleteWon = deleteRes.status === 204 && postRes.status === 409;
      const createWon = postRes.status === 201 && deleteRes.status === 409;
      expect(deleteWon || createWon).toBe(true);

      const accountRes = await request(app.getHttpServer())
        .get(`/accounts/${accountId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(accountRes.body.currentBalance).toBe(createWon ? 9_950 : 10_000);
    });
  });

  // =======================================================================
  // Concurrent replay — Two POST /auth/refresh with the SAME refresh token
  // findByTokenHashWithLock takes FOR UPDATE: one rotates (200), the other, once
  // unblocked, re-reads the ALREADY revoked token -> replay -> 401 (revokes family).
  // Without the lock both could rotate -> two valid chains from a single token.
  // (The auth spec covers the SEQUENTIAL replay; this covers the lock serialization.)
  // =======================================================================
  describe('Two concurrent /auth/refresh with the same token', () => {
    it('exactly one rotates (200) and the other detects replay (401)', async () => {
      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'concurrency@example.com', password: 'Password1!' })
        .expect(200);
      const refreshToken = loginRes.body.refreshToken;

      const results = await Promise.all([
        request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken }),
        request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken }),
      ]);

      results.forEach((r) => expect(r.status).not.toBe(500));
      const statuses = results.map((r) => r.status).sort((a, b) => a - b);
      expect(statuses).toEqual([200, 401]);
    });
  });
});
