import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../helpers/app-bootstrap';
import { cleanDatabase } from '../../helpers/db-cleaner';

/**
 * GET /reports/summary contra datos reales (view v_period_expenses incluida).
 *
 * Fechas SIEMPRE a mediodía del 15 → lejos de cualquier borde de mes, así los
 * asserts no dependen de la TZ del servidor (esa semántica se prueba, de forma
 * determinista, en el spec unitario de monthPeriod).
 */
describe('Reports: GET /reports/summary against real data', () => {
  let app: INestApplication;

  const year = 2026;
  const month = 6;
  const midJune = new Date(Date.UTC(2026, 5, 15, 12)).toISOString();
  const midMay = new Date(Date.UTC(2026, 4, 15, 12)).toISOString();
  const midJuly = new Date(Date.UTC(2026, 6, 15, 12)).toISOString();

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(app);
  });

  // Registra un usuario y devuelve su token + los ids que sus transacciones
  // necesitan (cuenta, categoría income, categoría expense con budget del período).
  const setupUser = async (
    email: string,
  ): Promise<{
    token: string;
    accountId: string;
    incomeCategoryId: string;
    expenseCategoryId: string;
  }> => {
    const auth = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'User', email, password: 'Password1!' })
      .expect(201);
    const token = auth.body.accessToken;

    const account = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Account', type: 'corriente', initialBalance: 1000000 })
      .expect(201);

    const incomeCat = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Salary', nature: 'income' })
      .expect(201);

    const expenseCat = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Food', nature: 'expense' })
      .expect(201);

    // Los gastos exigen un budget del período; límite alto para no bloquear.
    await request(app.getHttpServer())
      .post('/budgets')
      .set('Authorization', `Bearer ${token}`)
      .send({ categoryId: expenseCat.body.id, limit: 10000000, month, year })
      .expect(201);

    return {
      token,
      accountId: account.body.id,
      incomeCategoryId: incomeCat.body.id,
      expenseCategoryId: expenseCat.body.id,
    };
  };

  const postTx = async (
    token: string,
    body: Record<string, unknown>,
  ): Promise<void> => {
    await request(app.getHttpServer())
      .post('/transactions')
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(201);
  };

  const getSummary = (token: string, q = `month=${month}&year=${year}`) =>
    request(app.getHttpServer())
      .get(`/reports/summary?${q}`)
      .set('Authorization', `Bearer ${token}`);

  describe('auth & validation', () => {
    it('rejects an unauthenticated request with 401', async () => {
      await request(app.getHttpServer())
        .get(`/reports/summary?month=${month}&year=${year}`)
        .expect(401);
    });

    it.each([
      ['missing month', `year=${year}`],
      ['missing year', `month=${month}`],
      ['month = 0', `month=0&year=${year}`],
      ['month = 13', `month=13&year=${year}`],
      ['month not a number', `month=abc&year=${year}`],
    ])('returns 400 when %s', async (_label, q) => {
      const { token } = await setupUser('val@example.com');
      await getSummary(token, q).expect(400);
    });

    it('returns 400 when an unknown query param is sent (forbidNonWhitelisted)', async () => {
      const { token } = await setupUser('extra@example.com');
      await getSummary(token, `month=${month}&year=${year}&foo=bar`).expect(400);
    });
  });

  describe('computation', () => {
    it('returns zeros for a period with no movements (200, not 404)', async () => {
      const { token } = await setupUser('empty@example.com');

      const res = await getSummary(token).expect(200);

      expect(res.body).toEqual({
        month,
        year,
        income: 0,
        expenses: 0,
        net: 0,
      });
    });

    it('sums income and expenses of the queried month and excludes adjacent months', async () => {
      const u = await setupUser('sums@example.com');

      // Dentro de junio: income 1000 + 500, expense 300.
      await postTx(u.token, {
        accountId: u.accountId,
        categoryId: u.incomeCategoryId,
        amount: 1000,
        nature: 'income',
        transactionDate: midJune,
      });
      await postTx(u.token, {
        accountId: u.accountId,
        categoryId: u.incomeCategoryId,
        amount: 500,
        nature: 'income',
        transactionDate: midJune,
      });
      await postTx(u.token, {
        accountId: u.accountId,
        categoryId: u.expenseCategoryId,
        amount: 300,
        nature: 'expense',
        transactionDate: midJune,
      });

      // Fuera de junio: income en mayo y julio (income no requiere budget) → excluidos.
      await postTx(u.token, {
        accountId: u.accountId,
        categoryId: u.incomeCategoryId,
        amount: 99999,
        nature: 'income',
        transactionDate: midMay,
      });
      await postTx(u.token, {
        accountId: u.accountId,
        categoryId: u.incomeCategoryId,
        amount: 88888,
        nature: 'income',
        transactionDate: midJuly,
      });

      const res = await getSummary(u.token).expect(200);

      expect(res.body).toEqual({
        month,
        year,
        income: 1500,
        expenses: 300,
        net: 1200,
      });
    });

    it('produces a negative net when expenses exceed income', async () => {
      const u = await setupUser('neg@example.com');

      await postTx(u.token, {
        accountId: u.accountId,
        categoryId: u.incomeCategoryId,
        amount: 100,
        nature: 'income',
        transactionDate: midJune,
      });
      await postTx(u.token, {
        accountId: u.accountId,
        categoryId: u.expenseCategoryId,
        amount: 700,
        nature: 'expense',
        transactionDate: midJune,
      });

      const res = await getSummary(u.token).expect(200);

      expect(res.body.net).toBe(-600);
    });

    it("does not leak another user's movements into the summary", async () => {
      const a = await setupUser('a@example.com');
      const b = await setupUser('b@example.com');

      // B gasta y recibe en el mismo período.
      await postTx(b.token, {
        accountId: b.accountId,
        categoryId: b.incomeCategoryId,
        amount: 50000,
        nature: 'income',
        transactionDate: midJune,
      });
      await postTx(b.token, {
        accountId: b.accountId,
        categoryId: b.expenseCategoryId,
        amount: 40000,
        nature: 'expense',
        transactionDate: midJune,
      });

      // A tiene un único movimiento.
      await postTx(a.token, {
        accountId: a.accountId,
        categoryId: a.incomeCategoryId,
        amount: 100,
        nature: 'income',
        transactionDate: midJune,
      });

      const resA = await getSummary(a.token).expect(200);
      expect(resA.body).toEqual({
        month,
        year,
        income: 100,
        expenses: 0,
        net: 100,
      });

      const resB = await getSummary(b.token).expect(200);
      expect(resB.body).toEqual({
        month,
        year,
        income: 50000,
        expenses: 40000,
        net: 10000,
      });
    });
  });
});
