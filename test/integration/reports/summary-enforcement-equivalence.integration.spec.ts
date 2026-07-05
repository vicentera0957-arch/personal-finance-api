import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../helpers/app-bootstrap';
import { cleanDatabase } from '../../helpers/db-cleaner';

/**
 * Equivalencia por construcción: el `expenses` que muestra el reporte y el
 * `spent` que usa el enforcement de presupuestos salen AMBOS de la view
 * v_period_expenses. Este test lo verifica end-to-end sin poder inspeccionar el
 * `spent` interno: usa los códigos de estado del enforcement como sondas.
 *
 * Escenario: límite L = 1000, gasto real S = 600 (400 + 200) en el período.
 *   - GET /reports/summary        → expenses === S           (el reporte ve S)
 *   - PATCH limit = S             → 200 (limit == spent ok)   (enforcement suma S)
 *   - PATCH limit = S - 1         → 409 BudgetLimitBelowSpent (enforcement suma S)
 *   - POST expense (proyecta > L) → 422 BudgetLimitExceeded   (enforcement suma S)
 *
 * Si el reporte y el enforcement sumaran distinto, alguna de estas sondas
 * fallaría.
 */
describe('Reports ↔ budget enforcement: shared expense definition', () => {
  let app: INestApplication;

  const year = 2026;
  const month = 6;
  const midJune = new Date(Date.UTC(2026, 5, 15, 12)).toISOString();

  let token: string;
  let accountId: string;
  let expenseCategoryId: string;
  let budgetId: string;

  const L = 1000;

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
      .send({ name: 'User', email: 'equiv@example.com', password: 'Password1!' })
      .expect(201);
    token = auth.body.accessToken;

    const account = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Account', type: 'corriente', initialBalance: 1000000 })
      .expect(201);
    accountId = account.body.id;

    const expenseCat = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Food', nature: 'expense' })
      .expect(201);
    expenseCategoryId = expenseCat.body.id;

    const budget = await request(app.getHttpServer())
      .post('/budgets')
      .set('Authorization', `Bearer ${token}`)
      .send({ categoryId: expenseCategoryId, limit: L, month, year })
      .expect(201);
    budgetId = budget.body.id;
  });

  const spend = async (amount: number): Promise<void> => {
    await request(app.getHttpServer())
      .post('/transactions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        accountId,
        categoryId: expenseCategoryId,
        amount,
        nature: 'expense',
        transactionDate: midJune,
      })
      .expect(201);
  };

  it('report.expenses equals the amount the enforcement sums (200/409/422 probes agree on S)', async () => {
    await spend(400);
    await spend(200);
    const S = 600;

    // 1) El reporte ve exactamente S.
    const summary = await request(app.getHttpServer())
      .get(`/reports/summary?month=${month}&year=${year}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(summary.body.expenses).toBe(S);

    // 2) Bajar el límite justo a S está permitido (limit == spent).
    await request(app.getHttpServer())
      .patch(`/budgets/${budgetId}/limit`)
      .set('Authorization', `Bearer ${token}`)
      .send({ limit: S })
      .expect(200);

    // 3) Bajarlo a S - 1 se rechaza: el enforcement sumó el mismo S.
    await request(app.getHttpServer())
      .patch(`/budgets/${budgetId}/limit`)
      .set('Authorization', `Bearer ${token}`)
      .send({ limit: S - 1 })
      .expect(409);

    // 4) Con el límite ya en S y gastado S, cualquier gasto extra proyecta > límite.
    await request(app.getHttpServer())
      .post('/transactions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        accountId,
        categoryId: expenseCategoryId,
        amount: 1,
        nature: 'expense',
        transactionDate: midJune,
      })
      .expect(422);
  });
});
