import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../helpers/app-bootstrap';
import { cleanDatabase } from '../../helpers/db-cleaner';

describe('Budgets (integration)', () => {
  let app: INestApplication;
  let accessToken: string;
  let categoryId: string;
  let budgetId: string;

  const now = new Date();
  const month = now.getMonth() + 1; // 1-indexed
  const year = now.getFullYear();

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(app);

    // Usuario base
    const authRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'user@example.com', password: 'Password1!' });
    accessToken = authRes.body.accessToken;

    // Categoría budgetable de tipo expense (requisito de negocio)
    const catRes = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Alimentación', nature: 'expense', isBudgetable: true });
    categoryId = catRes.body.id;

    // Budget base
    const budgetRes = await request(app.getHttpServer())
      .post('/budgets')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ categoryId, limit: 500, month, year });
    budgetId = budgetRes.body.id;
  });

  // -----------------------------------------------------------------------
  // POST /budgets
  // -----------------------------------------------------------------------
  describe('POST /budgets', () => {
    it('crea un budget y devuelve 201', async () => {
      // Necesita otra categoría para no duplicar (mes/año/categoría únicos)
      const catRes = await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Transporte', nature: 'expense', isBudgetable: true });

      const res = await request(app.getHttpServer())
        .post('/budgets')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ categoryId: catRes.body.id, limit: 200, month, year })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('limit', 200);
    });

    it('rechaza presupuesto duplicado (mismo usuario/categoría/mes/año) con 409', async () => {
      await request(app.getHttpServer())
        .post('/budgets')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ categoryId, limit: 300, month, year })
        .expect(409);
    });

    it('rechaza categoría de tipo income con 422', async () => {
      const incomeCat = await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Salario', nature: 'income', isBudgetable: false });

      await request(app.getHttpServer())
        .post('/budgets')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ categoryId: incomeCat.body.id, limit: 100, month, year })
        .expect(422);
    });

    it('devuelve 401 sin token', async () => {
      await request(app.getHttpServer())
        .post('/budgets')
        .send({ categoryId, limit: 100, month, year })
        .expect(401);
    });
  });

  // -----------------------------------------------------------------------
  // GET /budgets
  // -----------------------------------------------------------------------
  describe('GET /budgets', () => {
    it('devuelve los budgets del usuario autenticado', async () => {
      const res = await request(app.getHttpServer())
        .get('/budgets')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    it('filtra por mes y año', async () => {
      const res = await request(app.getHttpServer())
        .get(`/budgets?month=${month}&year=${year}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // GET /budgets/:id
  // -----------------------------------------------------------------------
  describe('GET /budgets/:id', () => {
    it('devuelve el budget por id', async () => {
      const res = await request(app.getHttpServer())
        .get(`/budgets/${budgetId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('id', budgetId);
    });

    it('devuelve 404 para id inexistente', async () => {
      await request(app.getHttpServer())
        .get('/budgets/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);
    });

    it('devuelve 403 al acceder a budget ajeno', async () => {
      const other = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'other@example.com', password: 'Password1!' });

      await request(app.getHttpServer())
        .get(`/budgets/${budgetId}`)
        .set('Authorization', `Bearer ${other.body.accessToken}`)
        .expect(403);
    });
  });

  // -----------------------------------------------------------------------
  // PATCH /budgets/:id/limit
  // -----------------------------------------------------------------------
  describe('PATCH /budgets/:id/limit', () => {
    it('actualiza el límite del budget', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/budgets/${budgetId}/limit`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ limit: 800 })
        .expect(200);

      expect(res.body).toHaveProperty('limit', 800);
    });
  });

  // -----------------------------------------------------------------------
  // DELETE /budgets/:id
  // -----------------------------------------------------------------------
  describe('DELETE /budgets/:id', () => {
    it('elimina el budget cuando no tiene transacciones', async () => {
      await request(app.getHttpServer())
        .delete(`/budgets/${budgetId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
    });
  });
});
