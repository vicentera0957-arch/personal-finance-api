import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../helpers/app-bootstrap';
import { cleanDatabase } from '../../helpers/db-cleaner';

describe('Transacciones: movimientos y sus invariantes de saldo y presupuesto', () => {
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
      .send({ name: 'Test User', email: 'user@example.com', password: 'Password1!' });
    accessToken = authRes.body.accessToken;

    // Cuenta con saldo suficiente
    const accountRes = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Cuenta Corriente', type: 'corriente', initialBalance: 5000 });
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

  // =======================================================================
  // POST /transactions
  // =======================================================================
  describe('POST /transactions', () => {
    describe('cuando el movimiento es válido', () => {
      it('crea un expense y descuenta el saldo', async () => {
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

      it('crea un income y aumenta el saldo', async () => {
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
    });

    describe('cuando viola una regla de negocio', () => {
      it('rechaza nature y categoría incompatibles (400)', async () => {
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
    });

    describe('cuando la petición no está autenticada', () => {
      it('responde 401 sin token', async () => {
        await request(app.getHttpServer()).post('/transactions').send({}).expect(401);
      });
    });
  });

  // =======================================================================
  // GET /transactions
  // =======================================================================
  describe('GET /transactions', () => {
    it('devuelve las transacciones del usuario con paginación', async () => {
      const res = await request(app.getHttpServer())
        .get('/transactions?page=1&limit=10')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(Array.isArray(res.body.data ?? res.body)).toBe(true);
    });
  });

  // =======================================================================
  // GET /transactions/account/:accountId
  // =======================================================================
  describe('GET /transactions/account/:accountId', () => {
    it('devuelve las transacciones de la cuenta indicada', async () => {
      const res = await request(app.getHttpServer())
        .get(`/transactions/account/${accountId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(Array.isArray(res.body.data ?? res.body)).toBe(true);
    });

    it('rechaza el acceso a una cuenta ajena (403)', async () => {
      const other = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ name: 'Other User', email: 'other@example.com', password: 'Password1!' });

      await request(app.getHttpServer())
        .get(`/transactions/account/${accountId}`)
        .set('Authorization', `Bearer ${other.body.accessToken}`)
        .expect(403);
    });

    it('responde 404 para una cuenta inexistente', async () => {
      await request(app.getHttpServer())
        .get('/transactions/account/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);
    });
  });

  // =======================================================================
  // GET /transactions/:id
  // =======================================================================
  describe('GET /transactions/:id', () => {
    it('devuelve la transacción solicitada', async () => {
      const res = await request(app.getHttpServer())
        .get(`/transactions/${transactionId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('id', transactionId);
    });

    it('responde 404 para un id inexistente', async () => {
      await request(app.getHttpServer())
        .get('/transactions/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);
    });
  });

  // =======================================================================
  // DELETE /transactions/:id  (contrato HTTP — la reversión de saldo vive en
  // el bloque de invariante de saldo)
  // =======================================================================
  describe('DELETE /transactions/:id', () => {
    it('elimina la transacción y la deja inaccesible (204 → 404)', async () => {
      await request(app.getHttpServer())
        .delete(`/transactions/${transactionId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(204);

      await request(app.getHttpServer())
        .get(`/transactions/${transactionId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);
    });

    it('rechaza eliminar una transacción ajena (403)', async () => {
      const other = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ name: 'Other User', email: 'other@example.com', password: 'Password1!' });

      await request(app.getHttpServer())
        .delete(`/transactions/${transactionId}`)
        .set('Authorization', `Bearer ${other.body.accessToken}`)
        .expect(403);
    });
  });

  // =======================================================================
  // Invariante: el saldo de la cuenta refleja los movimientos
  // =======================================================================
  describe('Invariante: el saldo de la cuenta refleja los movimientos', () => {
    it('un expense reduce el currentBalance', async () => {
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

    it('un income aumenta el currentBalance', async () => {
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

    it('el saldo es correcto tras múltiples movimientos', async () => {
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

    it('al eliminar un expense se restaura el saldo previo', async () => {
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

    it('al eliminar un income se revierte el crédito', async () => {
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

  // =======================================================================
  // Invariante: el límite del presupuesto se respeta
  // beforeEach crea budget limit=1000 y una transacción base de 100 → gastado=100
  // =======================================================================
  describe('Invariante: el límite del presupuesto se respeta', () => {
    it('permite un expense que alcanza exactamente el límite', async () => {
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

    it('rechaza el expense que supera el límite acumulado (422)', async () => {
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

  // =======================================================================
  // Regla: las categorías de gasto requieren un budget en el período
  // =======================================================================
  describe('Regla: las categorías de gasto requieren un budget en el período', () => {
    it('rechaza un expense sin budget en el período (409)', async () => {
      // Nueva categoría expense sin budget creado
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
  });

  // =======================================================================
  // Regla: la cuenta debe tener fondos suficientes
  // =======================================================================
  describe('Regla: la cuenta debe tener fondos suficientes', () => {
    it('rechaza un expense que excede el balance (422)', async () => {
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

    it('rechaza un expense en una cuenta con balance cero (422)', async () => {
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

  // =======================================================================
  // Regla: las cuentas archivadas no aceptan movimientos
  // =======================================================================
  describe('Regla: las cuentas archivadas no aceptan movimientos', () => {
    it('rechaza una transacción en una cuenta archivada (409)', async () => {
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

    it('permite la transacción tras desarchivar la cuenta', async () => {
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
