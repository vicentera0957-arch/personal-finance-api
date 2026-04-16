import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../helpers/app-bootstrap';
import { cleanDatabase } from '../../helpers/db-cleaner';

describe('Accounts (integration)', () => {
  let app: INestApplication;
  let accessToken: string;
  let accountId: string;

  const accountPayload = { name: 'Cuenta Corriente', type: 'checking', initialBalance: 1000 };

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

    const account = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(accountPayload);

    accountId = account.body.id;
  });

  // -----------------------------------------------------------------------
  // POST /accounts
  // -----------------------------------------------------------------------
  describe('POST /accounts', () => {
    it('crea una cuenta y devuelve 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Ahorro', type: 'savings', initialBalance: 500 })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('name', 'Ahorro');
    });

    it('devuelve 401 sin token', async () => {
      await request(app.getHttpServer())
        .post('/accounts')
        .send(accountPayload)
        .expect(401);
    });
  });

  // -----------------------------------------------------------------------
  // GET /accounts
  // -----------------------------------------------------------------------
  describe('GET /accounts', () => {
    it('devuelve las cuentas del usuario autenticado', async () => {
      const res = await request(app.getHttpServer())
        .get('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -----------------------------------------------------------------------
  // GET /accounts/:id
  // -----------------------------------------------------------------------
  describe('GET /accounts/:id', () => {
    it('devuelve la cuenta por id', async () => {
      const res = await request(app.getHttpServer())
        .get(`/accounts/${accountId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('id', accountId);
    });

    it('devuelve 404 para id inexistente', async () => {
      await request(app.getHttpServer())
        .get('/accounts/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);
    });

    it('devuelve 403 al acceder a cuenta de otro usuario', async () => {
      const other = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'other@example.com', password: 'Password1!' });

      await request(app.getHttpServer())
        .get(`/accounts/${accountId}`)
        .set('Authorization', `Bearer ${other.body.accessToken}`)
        .expect(403);
    });
  });

  // -----------------------------------------------------------------------
  // PATCH /accounts/:id/name
  // -----------------------------------------------------------------------
  describe('PATCH /accounts/:id/name', () => {
    it('renombra la cuenta', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/accounts/${accountId}/name`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Nuevo nombre' })
        .expect(200);

      expect(res.body).toHaveProperty('name', 'Nuevo nombre');
    });
  });

  // -----------------------------------------------------------------------
  // PATCH /accounts/:id/archive  &  /unarchive
  // -----------------------------------------------------------------------
  describe('PATCH /accounts/:id/archive', () => {
    it('archiva la cuenta', async () => {
      await request(app.getHttpServer())
        .patch(`/accounts/${accountId}/archive`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
    });

    it('desarchiva la cuenta previamente archivada', async () => {
      await request(app.getHttpServer())
        .patch(`/accounts/${accountId}/archive`)
        .set('Authorization', `Bearer ${accessToken}`);

      await request(app.getHttpServer())
        .patch(`/accounts/${accountId}/unarchive`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
    });
  });

  // -----------------------------------------------------------------------
  // DELETE /accounts/:id
  // -----------------------------------------------------------------------
  describe('DELETE /accounts/:id', () => {
    it('elimina la cuenta', async () => {
      await request(app.getHttpServer())
        .delete(`/accounts/${accountId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
    });

    it('devuelve 403 al intentar eliminar cuenta ajena', async () => {
      const other = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'other@example.com', password: 'Password1!' });

      await request(app.getHttpServer())
        .delete(`/accounts/${accountId}`)
        .set('Authorization', `Bearer ${other.body.accessToken}`)
        .expect(403);
    });
  });
});
