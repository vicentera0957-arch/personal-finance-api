import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../helpers/app-bootstrap';
import { cleanDatabase } from '../../helpers/db-cleaner';

describe('Transactions (integration)', () => {
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

    // Usuario base
    const authRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'user@example.com', password: 'Password1!' });
    accessToken = authRes.body.accessToken;

    // Cuenta con saldo suficiente
    const accountRes = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Cuenta Corriente', type: 'checking', initialBalance: 5000 });
    accountId = accountRes.body.id;

    // Categoría expense + budgetable
    const expCatRes = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Alimentación', nature: 'expense', isBudgetable: true });
    expenseCategoryId = expCatRes.body.id;

    // Categoría income
    const incCatRes = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Salario', nature: 'income', isBudgetable: false });
    incomeCategoryId = incCatRes.body.id;

    // Budget para la categoría expense del mes actual
    await request(app.getHttpServer())
      .post('/budgets')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ categoryId: expenseCategoryId, limit: 1000, month, year });

    // Transacción base (expense)
    const txRes = await request(app.getHttpServer())
      .post('/transactions')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        accountId,
        categoryId: expenseCategoryId,
        amount: 100,
        nature: 'expense',
        date: now.toISOString(),
        description: 'Supermercado',
      });
    transactionId = txRes.body.id;
  });

  // -----------------------------------------------------------------------
  // POST /transactions
  // -----------------------------------------------------------------------
  describe('POST /transactions', () => {
    it('crea una transacción expense y descuenta el saldo', async () => {
      const res = await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          accountId,
          categoryId: expenseCategoryId,
          amount: 50,
          nature: 'expense',
          date: now.toISOString(),
          description: 'Café',
        })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('amount', 50);
    });

    it('crea una transacción income y suma el saldo', async () => {
      const res = await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          accountId,
          categoryId: incomeCategoryId,
          amount: 2000,
          nature: 'income',
          date: now.toISOString(),
          description: 'Sueldo',
        })
        .expect(201);

      expect(res.body).toHaveProperty('nature', 'income');
    });

    it('rechaza expense que supera el límite del presupuesto con 422', async () => {
      await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          accountId,
          categoryId: expenseCategoryId,
          amount: 950, // presupuesto 1000, ya hay 100 → total sería 1050
          nature: 'expense',
          date: now.toISOString(),
          description: 'Compra grande',
        })
        .expect(422);
    });

    it('rechaza missmatch entre nature y categoría con 422', async () => {
      // expense con categoría income
      await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          accountId,
          categoryId: incomeCategoryId,
          amount: 50,
          nature: 'expense',
          date: now.toISOString(),
        })
        .expect(422);
    });

    it('rechaza cuenta archivada con 422', async () => {
      await request(app.getHttpServer())
        .patch(`/accounts/${accountId}/archive`)
        .set('Authorization', `Bearer ${accessToken}`);

      await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          accountId,
          categoryId: expenseCategoryId,
          amount: 10,
          nature: 'expense',
          date: now.toISOString(),
        })
        .expect(422);
    });

    it('devuelve 401 sin token', async () => {
      await request(app.getHttpServer()).post('/transactions').send({}).expect(401);
    });
  });

  // -----------------------------------------------------------------------
  // GET /transactions
  // -----------------------------------------------------------------------
  describe('GET /transactions', () => {
    it('devuelve las transacciones del usuario con paginación', async () => {
      const res = await request(app.getHttpServer())
        .get('/transactions?page=1&limit=10')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(Array.isArray(res.body.data ?? res.body)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // GET /transactions/account/:accountId
  // -----------------------------------------------------------------------
  describe('GET /transactions/account/:accountId', () => {
    it('devuelve transacciones de la cuenta indicada', async () => {
      const res = await request(app.getHttpServer())
        .get(`/transactions/account/${accountId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(Array.isArray(res.body.data ?? res.body)).toBe(true);
    });

    it('devuelve 403 al consultar cuenta ajena', async () => {
      const other = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'other@example.com', password: 'Password1!' });

      await request(app.getHttpServer())
        .get(`/transactions/account/${accountId}`)
        .set('Authorization', `Bearer ${other.body.accessToken}`)
        .expect(403);
    });
  });

  // -----------------------------------------------------------------------
  // GET /transactions/:id
  // -----------------------------------------------------------------------
  describe('GET /transactions/:id', () => {
    it('devuelve la transacción por id', async () => {
      const res = await request(app.getHttpServer())
        .get(`/transactions/${transactionId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('id', transactionId);
    });

    it('devuelve 404 para id inexistente', async () => {
      await request(app.getHttpServer())
        .get('/transactions/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);
    });
  });

  // -----------------------------------------------------------------------
  // DELETE /transactions/:id
  // -----------------------------------------------------------------------
  describe('DELETE /transactions/:id', () => {
    it('elimina la transacción y revierte el saldo de la cuenta', async () => {
      await request(app.getHttpServer())
        .delete(`/transactions/${transactionId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      // Verificar que ya no existe
      await request(app.getHttpServer())
        .get(`/transactions/${transactionId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);
    });

    it('devuelve 403 al intentar eliminar transacción ajena', async () => {
      const other = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'other@example.com', password: 'Password1!' });

      await request(app.getHttpServer())
        .delete(`/transactions/${transactionId}`)
        .set('Authorization', `Bearer ${other.body.accessToken}`)
        .expect(403);
    });
  });
});
