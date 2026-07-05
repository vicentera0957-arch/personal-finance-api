import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from '../../helpers/app-bootstrap';
import { cleanDatabase } from '../../helpers/db-cleaner';
import { decodeJwtSub } from '../../helpers/jwt';

describe('Users: profile round-trip and ownership with the real guard', () => {
  let app: INestApplication;
  let accessToken: string;
  let userId: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(app);

    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        name: 'Test User',
        email: 'user@example.com',
        password: 'Password1!',
      });

    accessToken = res.body.accessToken;
    // register/login don't return the id in the body: we read it from the `sub` claim.
    userId = decodeJwtSub(accessToken);
  });

  // =======================================================================
  // Profile round-trip: the update really persists (mapper + real UPDATE).
  // The mapper.spec tests the mapper in isolation; only here we test the trip
  // to Postgres.
  // =======================================================================
  describe('PATCH /users/:id/profile -> GET /users/:id', () => {
    it('updates the name and the later GET reflects it (persisted)', async () => {
      await request(app.getHttpServer())
        .patch(`/users/${userId}/profile`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Updated Name' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/users/${userId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('id', userId);
      expect(res.body).toHaveProperty('name', 'Updated Name');
    });
  });

  // =======================================================================
  // Ownership barrier: real chain token -> @CurrentUser -> use case -> other's row.
  // The controller specs mock the use case and fabricate currentUser; this tests
  // the real wiring of the global guard.
  // =======================================================================
  describe('ownership barrier', () => {
    it('responds 401 without a token (real global guard)', async () => {
      await request(app.getHttpServer()).get(`/users/${userId}`).expect(401);
    });

    it("user B's token on user A's id responds 403", async () => {
      const other = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          name: 'Other User',
          email: 'other@example.com',
          password: 'Password1!',
        });

      // B uses its token against A's id -> 403.
      await request(app.getHttpServer())
        .get(`/users/${userId}`)
        .set('Authorization', `Bearer ${other.body.accessToken}`)
        .expect(403);
    });
  });

  // =======================================================================
  // Cascade deletion: deleting a user deletes all associated data via DB constraints.
  // =======================================================================
  describe('DELETE /users/:id (Cascade Deletion)', () => {
    it('deletes the user and cascades to clean up all associated relations from the database (204)', async () => {
      const dataSource = app.get(DataSource);

      // 1. Create an account
      const accountRes = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Test Account',
          type: 'corriente',
          initialBalance: 1000,
        })
        .expect(201);
      const accountId = accountRes.body.id;

      // 2. Create an expense category
      const categoryRes = await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Food',
          nature: 'expense',
        })
        .expect(201);
      const categoryId = categoryRes.body.id;

      // 3. Create a budget
      await request(app.getHttpServer())
        .post('/budgets')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          categoryId,
          month: 6,
          year: 2026,
          limit: 500,
        })
        .expect(201);

      // 4. Create a transaction
      await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          accountId,
          categoryId,
          nature: 'expense',
          amount: 50,
          description: 'Lunch',
          transactionDate: '2026-06-15T12:00:00Z',
        })
        .expect(201);

      // Verify the items exist pre-delete
      const preDeleteAccounts = await dataSource.query(
        'SELECT COUNT(*) as count FROM accounts WHERE user_id = $1',
        [userId],
      );
      expect(Number(preDeleteAccounts[0].count)).toBe(1);

      // 5. Delete the user
      await request(app.getHttpServer())
        .delete(`/users/${userId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(204);

      // 6. Verify cascade deletion via DataSource
      const checkTable = async (table: string) => {
        const res = await dataSource.query(
          `SELECT COUNT(*) as count FROM ${table} WHERE user_id = $1`,
          [userId],
        );
        return Number(res[0].count);
      };

      const checkUsersTable = async () => {
        const res = await dataSource.query(
          `SELECT COUNT(*) as count FROM users WHERE id = $1`,
          [userId],
        );
        return Number(res[0].count);
      };

      expect(await checkTable('accounts')).toBe(0);
      expect(await checkTable('categories')).toBe(0);
      expect(await checkTable('budgets')).toBe(0);
      expect(await checkTable('transactions')).toBe(0);
      expect(await checkTable('refresh_tokens')).toBe(0);
      expect(await checkUsersTable()).toBe(0);
    });
  });
});

