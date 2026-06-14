import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../helpers/app-bootstrap';
import { cleanDatabase } from '../../helpers/db-cleaner';

describe('Categorías: unicidad y bloqueo por uso, contra la DB real', () => {
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

    // Categoría base: expense 'Alimentación'.
    const cat = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Alimentación', nature: 'expense' });
    categoryId = cat.body.id;
  });

  // =======================================================================
  // Unicidad real (userId, name, nature): la constraint existe en el esquema
  // migrado y dispara 409 (catch 23505). No hay pre-check en categorías.
  // =======================================================================
  describe('POST /categories', () => {
    it('crea una categoría y el GET la devuelve (round-trip)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/categories/${categoryId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('id', categoryId);
      expect(res.body).toHaveProperty('name', 'Alimentación');
      expect(res.body).toHaveProperty('nature', 'expense');
    });

    it('rechaza un duplicado (mismo name+nature) con 409 — constraint real', async () => {
      await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Alimentación', nature: 'expense' })
        .expect(409);
    });
  });

  // =======================================================================
  // Cross-module: el FK real bloquea el borrado desde DOS agregados
  // referenciantes (budgets y transactions). catch 23503 → CategoryInUseException.
  // =======================================================================
  describe('Cross-module: DELETE /categories/:id en uso', () => {
    it('rechaza eliminar una categoría con un budget asociado (409)', async () => {
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

    it('rechaza eliminar una categoría con una transacción asociada (409)', async () => {
      const account = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Cuenta', type: 'corriente', initialBalance: 5000 });

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
          description: 'Compra',
        })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/categories/${categoryId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(409);
    });

    it('permite eliminarla tras remover budget y transacción (204)', async () => {
      const account = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Cuenta', type: 'corriente', initialBalance: 5000 });

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
          description: 'Compra',
        });

      // Remover en orden inverso a las dependencias: transacción → budget → categoría.
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
