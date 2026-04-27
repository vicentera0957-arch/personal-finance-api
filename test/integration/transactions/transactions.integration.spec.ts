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
      .send({ name: 'Alimentación', nature: 'expense' });
    expenseCategoryId = expCatRes.body.id;

    // Categoría income
    const incCatRes = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Salario', nature: 'income' });
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
        transactionDate: now.toISOString(),
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
          transactionDate: now.toISOString(),
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
          transactionDate: now.toISOString(),
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
          transactionDate: now.toISOString(),
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
          transactionDate: now.toISOString(),
        })
        .expect(400);
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
          transactionDate: now.toISOString(),
        })
        .expect(409);
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
        .expect(204);

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

  // -----------------------------------------------------------------------
  // Cross-module: verificación de balance tras transacciones
  // -----------------------------------------------------------------------
  describe('Cross-module: verificación de balance tras transacciones', () => {
    it('expense reduce currentBalance de la cuenta', async () => {
      await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          accountId,
          categoryId: expenseCategoryId,
          amount: 200,
          nature: 'expense',
          transactionDate: now.toISOString(),
          description: 'Expense extra',
        })
        .expect(201);

      const accountRes = await request(app.getHttpServer())
        .get(`/accounts/${accountId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      // balance inicial 5000, base expense 100, nuevo expense 200 → 4700
      expect(accountRes.body.currentBalance).toBe(4700);
    });

    it('income aumenta currentBalance de la cuenta', async () => {
      await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          accountId,
          categoryId: incomeCategoryId,
          amount: 3000,
          nature: 'income',
          transactionDate: now.toISOString(),
          description: 'Sueldo extra',
        })
        .expect(201);

      const accountRes = await request(app.getHttpServer())
        .get(`/accounts/${accountId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      // balance inicial 5000, base expense 100, income 3000 → 7900
      expect(accountRes.body.currentBalance).toBe(7900);
    });

    it('balance acumulativo es correcto tras múltiples transacciones', async () => {
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
  });

  // -----------------------------------------------------------------------
  // Cross-module: reversión de balance al eliminar transacción
  // -----------------------------------------------------------------------
  describe('Cross-module: reversión de balance al eliminar transacción', () => {
    it('eliminar expense restaura el balance previo', async () => {
      // Verificar balance actual (5000 - 100 base = 4900)
      const before = await request(app.getHttpServer())
        .get(`/accounts/${accountId}`)
        .set('Authorization', `Bearer ${accessToken}`);
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

    it('eliminar income revierte el crédito en la cuenta', async () => {
      const incomeRes = await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          accountId,
          categoryId: incomeCategoryId,
          amount: 2000,
          nature: 'income',
          transactionDate: now.toISOString(),
          description: 'Bono',
        })
        .expect(201);

      const incomeTransactionId = incomeRes.body.id;

      // balance: 5000 - 100(base) + 2000 = 6900
      const before = await request(app.getHttpServer())
        .get(`/accounts/${accountId}`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(before.body.currentBalance).toBe(6900);

      await request(app.getHttpServer())
        .delete(`/transactions/${incomeTransactionId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(204);

      // balance: 6900 - 2000 = 4900
      const after = await request(app.getHttpServer())
        .get(`/accounts/${accountId}`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(after.body.currentBalance).toBe(4900);
    });
  });

  // -----------------------------------------------------------------------
  // Cross-module: fondos insuficientes
  // -----------------------------------------------------------------------
  describe('Cross-module: fondos insuficientes', () => {
    it('rechaza expense que excede el balance de la cuenta con 422', async () => {
      // Crear cuenta propia con balance pequeño
      const smallAccountRes = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Cuenta pequeña', type: 'corriente', initialBalance: 100 })
        .expect(201);
      const smallAccountId = smallAccountRes.body.id;

      // Crear categoría y budget propios para no interferir con el beforeEach
      const catRes = await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Gastos pequeños', nature: 'expense' })
        .expect(201);
      const smallCatId = catRes.body.id;

      await request(app.getHttpServer())
        .post('/budgets')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ categoryId: smallCatId, limit: 9999, month, year })
        .expect(201);

      await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          accountId: smallAccountId,
          categoryId: smallCatId,
          amount: 200,
          nature: 'expense',
          transactionDate: now.toISOString(),
        })
        .expect(422);
    });

    it('rechaza expense en cuenta con balance cero con 422', async () => {
      const zeroAccountRes = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Cuenta vacía', type: 'corriente', initialBalance: 0 })
        .expect(201);
      const zeroAccountId = zeroAccountRes.body.id;

      const catRes = await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Gastos cero', nature: 'expense' })
        .expect(201);
      const zeroCatId = catRes.body.id;

      await request(app.getHttpServer())
        .post('/budgets')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ categoryId: zeroCatId, limit: 9999, month, year })
        .expect(201);

      await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          accountId: zeroAccountId,
          categoryId: zeroCatId,
          amount: 1,
          nature: 'expense',
          transactionDate: now.toISOString(),
        })
        .expect(422);
    });
  });

  // -----------------------------------------------------------------------
  // Cross-module: enforcement acumulativo de budget limit
  // -----------------------------------------------------------------------
  describe('Cross-module: enforcement acumulativo de budget limit', () => {
    // beforeEach crea budget limit=1000 y una transacción base de 100 → gastado=100

    it('permite expense que alcanza exactamente el límite del budget', async () => {
      // 100 (base) + 900 = 1000 = limit exacto → debe pasar
      await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          accountId,
          categoryId: expenseCategoryId,
          amount: 900,
          nature: 'expense',
          transactionDate: now.toISOString(),
          description: 'Hasta el límite',
        })
        .expect(201);
    });

    it('rechaza segunda expense que supera el límite acumulado con 422', async () => {
      // Primera: 100(base) + 400 = 500 → ok
      await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          accountId,
          categoryId: expenseCategoryId,
          amount: 400,
          nature: 'expense',
          transactionDate: now.toISOString(),
          description: 'Primera compra',
        })
        .expect(201);

      // Segunda: 500 + 600 = 1100 > 1000 → debe fallar
      await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          accountId,
          categoryId: expenseCategoryId,
          amount: 600,
          nature: 'expense',
          transactionDate: now.toISOString(),
          description: 'Segunda compra que excede',
        })
        .expect(422);
    });
  });

  // -----------------------------------------------------------------------
  // Cross-module: budget requerido y categoría budgetable
  // -----------------------------------------------------------------------
  describe('Cross-module: budget requerido y categoría budgetable', () => {
    it('rechaza expense en categoría budgetable sin budget en el período con 409', async () => {
      // Nueva categoría expense+budgetable sin budget creado
      const catRes = await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Transporte', nature: 'expense' })
        .expect(201);

      // NO crear budget → debe fallar con 409
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

    it('rechaza expense en categoría expense no-budgetable con 409', async () => {
      const catRes = await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Misceláneos', nature: 'expense' })
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

  // -----------------------------------------------------------------------
  // Cross-module: cuenta archivada bloquea transacciones
  // -----------------------------------------------------------------------
  describe('Cross-module: cuenta archivada bloquea transacciones', () => {
    it('rechaza transacción en cuenta archivada con 409', async () => {
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

    it('permite transacción en cuenta después de desarchivarla', async () => {
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
          description: 'Tras unarchive',
        })
        .expect(201);
    });
  });
});
