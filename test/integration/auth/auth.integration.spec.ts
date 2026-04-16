import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../helpers/app-bootstrap';
import { cleanDatabase } from '../../helpers/db-cleaner';

describe('Auth (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(app);
  });

  // -----------------------------------------------------------------------
  // POST /auth/register
  // -----------------------------------------------------------------------
  describe('POST /auth/register', () => {
    it('registra un usuario nuevo y devuelve tokens', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'test@example.com', password: 'Password1!' })
        .expect(201);

      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');
    });

    it('rechaza un email duplicado con 409', async () => {
      const payload = { email: 'dup@example.com', password: 'Password1!' };
      await request(app.getHttpServer()).post('/auth/register').send(payload);

      await request(app.getHttpServer())
        .post('/auth/register')
        .send(payload)
        .expect(409);
    });

    it('rechaza datos inválidos con 400', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'not-an-email', password: '123' })
        .expect(400);
    });
  });

  // -----------------------------------------------------------------------
  // POST /auth/login
  // -----------------------------------------------------------------------
  describe('POST /auth/login', () => {
    beforeEach(async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'user@example.com', password: 'Password1!' });
    });

    it('devuelve tokens con credenciales correctas', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'user@example.com', password: 'Password1!' })
        .expect(200);

      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');
    });

    it('rechaza contraseña incorrecta con 401', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'user@example.com', password: 'WrongPass!' })
        .expect(401);
    });

    it('rechaza email inexistente con 401', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'ghost@example.com', password: 'Password1!' })
        .expect(401);
    });
  });

  // -----------------------------------------------------------------------
  // POST /auth/refresh
  // -----------------------------------------------------------------------
  describe('POST /auth/refresh', () => {
    it('devuelve un nuevo accessToken con refreshToken válido', async () => {
      const register = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'refresh@example.com', password: 'Password1!' });

      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: register.body.refreshToken })
        .expect(200);

      expect(res.body).toHaveProperty('accessToken');
    });

    it('rechaza un refreshToken inválido con 401', async () => {
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: 'invalid.token.here' })
        .expect(401);
    });
  });
});
