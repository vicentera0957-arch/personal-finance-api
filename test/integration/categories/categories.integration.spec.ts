import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../helpers/app-bootstrap';
import { cleanDatabase } from '../../helpers/db-cleaner';

describe('Categories (integration)', () => {
  let app: INestApplication;
  let accessToken: string;
  let categoryId: string;

  const expenseCategoryPayload = { name: 'Alimentación', nature: 'expense', isBudgetable: true };

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
        .send({ name: 'Salario', nature: 'income', isBudgetable: false })
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
        .expect(422); // CategoryBudgetableImmutableException → 422
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
        .expect(200);
    });
  });
});
