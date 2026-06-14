import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../helpers/app-bootstrap';
import { cleanDatabase } from '../../helpers/db-cleaner';

describe('Cuentas: persistencia del ciclo de vida y bloqueo por referencias reales', () => {
  let app: INestApplication;
  let accessToken: string;
  let accountId: string;

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

    const account = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Cuenta Corriente', type: 'corriente', initialBalance: 5000 });
    accountId = account.body.id;
  });

  // Crea una transacción expense en la cuenta (requiere categoría expense + budget).
  const createExpenseTransaction = async (): Promise<string> => {
    const cat = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Alimentación', nature: 'expense' });

    await request(app.getHttpServer())
      .post('/budgets')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ categoryId: cat.body.id, limit: 1000, month, year });

    const tx = await request(app.getHttpServer())
      .post('/transactions')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        accountId,
        categoryId: cat.body.id,
        amount: 100,
        nature: 'expense',
        transactionDate: now.toISOString(),
        description: 'Compra',
      });
    return tx.body.id;
  };

  // =======================================================================
  // Round-trip de creación: el POST persiste y el GET lo devuelve con el saldo
  // inicial sembrado. Prueba que mapper + esquema migrado + ORM concuerdan.
  // =======================================================================
  describe('POST /accounts → GET /accounts/:id', () => {
    it('crea y recupera la cuenta con el saldo inicial sembrado', async () => {
      const res = await request(app.getHttpServer())
        .get(`/accounts/${accountId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('id', accountId);
      expect(res.body).toHaveProperty('name', 'Cuenta Corriente');
      expect(res.body).toHaveProperty('currentBalance', 5000);
      expect(res.body).toHaveProperty('isArchived', false);
    });
  });

  // =======================================================================
  // El ciclo de vida PERSISTE: la regla (no archivar dos veces, etc.) ya está
  // en el dominio/use case; aquí probamos que el UoW real commitea el flag a Postgres.
  // =======================================================================
  describe('PATCH /accounts/:id/archive · /unarchive', () => {
    it('archiva y el GET posterior muestra isArchived=true; desarchiva y vuelve a false', async () => {
      await request(app.getHttpServer())
        .patch(`/accounts/${accountId}/archive`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const archived = await request(app.getHttpServer())
        .get(`/accounts/${accountId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(archived.body.isArchived).toBe(true);

      await request(app.getHttpServer())
        .patch(`/accounts/${accountId}/unarchive`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const restored = await request(app.getHttpServer())
        .get(`/accounts/${accountId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(restored.body.isArchived).toBe(false);
    });
  });

  // =======================================================================
  // Cross-module: el FK real (transactions → accounts) bloquea el borrado.
  // El unit del controller mockea AccountInUseException; sólo la DB real prueba
  // que el FK existe y dispara (catch 23503).
  // =======================================================================
  describe('Cross-module: DELETE /accounts/:id con movimientos', () => {
    it('rechaza eliminar una cuenta con una transacción asociada (409)', async () => {
      await createExpenseTransaction();

      await request(app.getHttpServer())
        .delete(`/accounts/${accountId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(409);
    });

    it('permite eliminar la cuenta tras borrar la transacción (204)', async () => {
      const transactionId = await createExpenseTransaction();

      await request(app.getHttpServer())
        .delete(`/transactions/${transactionId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(204);

      await request(app.getHttpServer())
        .delete(`/accounts/${accountId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(204);
    });
  });

  // =======================================================================
  // Barrera de propiedad (1 smoke de la cadena real; no se repite por verbo).
  // =======================================================================
  describe('barrera de propiedad', () => {
    it('GET /accounts/:id de otro usuario responde 403 (cadena real)', async () => {
      const other = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ name: 'Other User', email: 'other@example.com', password: 'Password1!' });

      await request(app.getHttpServer())
        .get(`/accounts/${accountId}`)
        .set('Authorization', `Bearer ${other.body.accessToken}`)
        .expect(403);
    });
  });
});
