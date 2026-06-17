import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../helpers/app-bootstrap';
import { cleanDatabase } from '../../helpers/db-cleaner';

describe('Categories: uniqueness and in-use blocking, against the real DB', () => {
  let app: INestApplication;
  let accessToken: string;
  let categoryId: string;

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

    // Base category: expense 'Food'.
    const cat = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Food', nature: 'expense' });
    categoryId = cat.body.id;
  });

  // =======================================================================
  // Real uniqueness (userId, name, nature): the constraint exists in the
  // migrated schema and fires 409 (catch 23505). There is no pre-check on categories.
  // =======================================================================
  describe('POST /categories', () => {
    it('creates a category and GET returns it (round-trip)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/categories/${categoryId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('id', categoryId);
      expect(res.body).toHaveProperty('name', 'Food');
      expect(res.body).toHaveProperty('nature', 'expense');
    });

    it('rejects a duplicate (same name+nature) with 409 — real constraint', async () => {
      await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Food', nature: 'expense' })
        .expect(409);
    });
  });

  // =======================================================================
  // Cross-module: the real FK blocks deletion from TWO referencing aggregates
  // (budgets and transactions). catch 23503 -> CategoryInUseException.
  // =======================================================================
  describe('Cross-module: DELETE /categories/:id in use', () => {
    it('rejects deleting a category with an associated budget (409)', async () => {
      await request(app.getHttpServer())
        .post('/budgets')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ categoryId, limit: 500, month, year })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/categories/${categoryId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(409);
    });

    it('rejects deleting a category with an associated transaction (409)', async () => {
      const account = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Account', type: 'corriente', initialBalance: 5000 });

      await request(app.getHttpServer())
        .post('/budgets')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ categoryId, limit: 1000, month, year });

      await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          accountId: account.body.id,
          categoryId,
          amount: 100,
          nature: 'expense',
          transactionDate: now.toISOString(),
          description: 'Purchase',
        })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/categories/${categoryId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(409);
    });

    it('allows deleting it after removing budget and transaction (204)', async () => {
      const account = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Account', type: 'corriente', initialBalance: 5000 });

      const budget = await request(app.getHttpServer())
        .post('/budgets')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ categoryId, limit: 1000, month, year });

      const tx = await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          accountId: account.body.id,
          categoryId,
          amount: 100,
          nature: 'expense',
          transactionDate: now.toISOString(),
          description: 'Purchase',
        });

      // Remove in reverse dependency order: transaction -> budget -> category.
      await request(app.getHttpServer())
        .delete(`/transactions/${tx.body.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(204);

      await request(app.getHttpServer())
        .delete(`/budgets/${budget.body.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(204);

      await request(app.getHttpServer())
        .delete(`/categories/${categoryId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(204);
    });
  });
});
