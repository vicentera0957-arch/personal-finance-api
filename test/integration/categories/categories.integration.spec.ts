import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../helpers/app-bootstrap';
import { cleanDatabase } from '../../helpers/db-cleaner';

describe('Categories (integration)', () => {
  let app: INestApplication;
  let accessToken: string;
  let categoryId: string;

  const expenseCategoryPayload = { name: 'Alimentación', nature: 'expense' };

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
      .send({ email: 'user@example.com', password: 'Password1!' });

    accessToken = res.body.accessToken;

    const category = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(expenseCategoryPayload);

    categoryId = category.body.id;
  });

  // -----------------------------------------------------------------------
  // POST /categories
  // -----------------------------------------------------------------------
  describe('POST /categories', () => {
    it('crea una categoría y devuelve 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Salario', nature: 'income' })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('nature', 'income');
    });

    it('devuelve 401 sin token', async () => {
      await request(app.getHttpServer())
        .post('/categories')
        .send(expenseCategoryPayload)
        .expect(401);
    });
  });

  // -----------------------------------------------------------------------
  // GET /categories
  // -----------------------------------------------------------------------
  describe('GET /categories', () => {
    it('devuelve las categorías del usuario autenticado', async () => {
      const res = await request(app.getHttpServer())
        .get('/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -----------------------------------------------------------------------
  // GET /categories/:id
  // -----------------------------------------------------------------------
  describe('GET /categories/:id', () => {
    it('devuelve la categoría por id', async () => {
      const res = await request(app.getHttpServer())
        .get(`/categories/${categoryId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('id', categoryId);
    });

    it('devuelve 404 para id inexistente', async () => {
      await request(app.getHttpServer())
        .get('/categories/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);
    });

    it('devuelve 403 al acceder a categoría ajena', async () => {
      const other = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'other@example.com', password: 'Password1!' });

      await request(app.getHttpServer())
        .get(`/categories/${categoryId}`)
        .set('Authorization', `Bearer ${other.body.accessToken}`)
        .expect(403);
    });
  });

  // -----------------------------------------------------------------------
  // PATCH /categories/:id
  // -----------------------------------------------------------------------
  describe('PATCH /categories/:id', () => {
    it('actualiza el nombre de la categoría', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/categories/${categoryId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Comida' })
        .expect(200);

      expect(res.body).toHaveProperty('name', 'Comida');
    });

    it('no permite cambiar isBudgetable después de la creación', async () => {
      await request(app.getHttpServer())
        .patch(`/categories/${categoryId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ isBudgetable: false })
        .expect(409); // CategoryBudgetableImmutableException → ConflictException (409)
    });
  });

  // -----------------------------------------------------------------------
  // DELETE /categories/:id
  // -----------------------------------------------------------------------
  describe('DELETE /categories/:id', () => {
    it('elimina la categoría cuando no está en uso', async () => {
      await request(app.getHttpServer())
        .delete(`/categories/${categoryId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(204);
    });
  });

  // -----------------------------------------------------------------------
  // Cross-module: category deletion bloqueada por uso
  // -----------------------------------------------------------------------
  describe('Cross-module: category deletion bloqueada por uso', () => {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    it('rechaza eliminar categoría con transacciones asociadas con 409', async () => {
      // Crear cuenta y budget necesarios para la transacción
      const accountRes = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Cuenta test', type: 'corriente', initialBalance: 5000 })
        .expect(201);
      const accountId = accountRes.body.id;

      await request(app.getHttpServer())
        .post('/budgets')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ categoryId, limit: 1000, month, year })
        .expect(201);

      await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          accountId,
          categoryId,
          amount: 100,
          nature: 'expense',
          transactionDate: now.toISOString(),
          description: 'Compra',
        })
        .expect(201);

      // Intentar eliminar la categoría → falla por FK con transacciones
      await request(app.getHttpServer())
        .delete(`/categories/${categoryId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(409);
    });

    it('rechaza eliminar categoría con budget asociado con 409', async () => {
      // Solo crear budget (sin transacción)
      await request(app.getHttpServer())
        .post('/budgets')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ categoryId, limit: 500, month, year })
        .expect(201);

      // Intentar eliminar la categoría → falla por FK con budget
      await request(app.getHttpServer())
        .delete(`/categories/${categoryId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(409);
    });

    it('permite eliminar categoría después de remover transacciones y budget', async () => {
      const accountRes = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Cuenta limpieza', type: 'corriente', initialBalance: 5000 })
        .expect(201);
      const accountId = accountRes.body.id;

      const budgetRes = await request(app.getHttpServer())
        .post('/budgets')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ categoryId, limit: 1000, month, year })
        .expect(201);
      const budgetId = budgetRes.body.id;

      const txRes = await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          accountId,
          categoryId,
          amount: 100,
          nature: 'expense',
          transactionDate: now.toISOString(),
        })
        .expect(201);
      const transactionId = txRes.body.id;

      // Eliminar en orden: transacción → budget → categoría
      await request(app.getHttpServer())
        .delete(`/transactions/${transactionId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(204);

      await request(app.getHttpServer())
        .delete(`/budgets/${budgetId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(204);

      await request(app.getHttpServer())
        .delete(`/categories/${categoryId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(204);
    });
  });
});
