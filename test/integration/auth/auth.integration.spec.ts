import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../helpers/app-bootstrap';
import { cleanDatabase } from '../../helpers/db-cleaner';

describe('Autenticación: registro, rotación de refresh y revocación de familia', () => {
  let app: INestApplication;

  // Alta de un usuario; devuelve el par de tokens emitido.
  const register = (email = 'user@example.com') =>
    request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'Test User', email, password: 'Password1!' });

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(app);
  });

  // =======================================================================
  // POST /auth/register  (round-trip real + unicidad de email impuesta por la DB)
  // El mapeo de errores y la validación de DTO ya están en los unit tests;
  // aquí sólo probamos lo que necesita Postgres real.
  // =======================================================================
  describe('POST /auth/register', () => {
    it('registra y el accessToken devuelto funciona en una ruta protegida', async () => {
      const res = await register().expect(201);

      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');

      // El token sirve de verdad: el guard JWT real lo acepta en una ruta protegida.
      await request(app.getHttpServer())
        .get('/accounts')
        .set('Authorization', `Bearer ${res.body.accessToken}`)
        .expect(200);
    });

    it('rechaza un email duplicado (409) — constraint real, no pre-check', async () => {
      await register('dup@example.com').expect(201);

      // El 409 nace del UNIQUE de la DB → catch 23505 → UserAlreadyExistsException.
      await register('dup@example.com').expect(409);
    });
  });

  // =======================================================================
  // POST /auth/refresh  (LA JOYA: rotación + replay + revocación de familia)
  // El unit test usa un UoW mockeado; aquí se ejecuta el SQL real de revocación
  // y la persistencia de la cadena de tokens.
  // =======================================================================
  describe('POST /auth/refresh', () => {
    it('entrega un par nuevo y el refreshToken rota (cambia)', async () => {
      const { refreshToken: r1 } = (await register()).body;

      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: r1 })
        .expect(200);

      expect(res.body).toHaveProperty('accessToken');
      expect(res.body.refreshToken).toBeDefined();
      expect(res.body.refreshToken).not.toBe(r1); // rotación real
    });

    it('reusar el token anterior tras rotar responde 401 (replay)', async () => {
      const { refreshToken: r1 } = (await register()).body;

      // Rota R1 → R2; R1 queda revocado.
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: r1 })
        .expect(200);

      // Reusar R1 (ya rotado) es un replay → 401.
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: r1 })
        .expect(401);
    });

    it('el replay revoca toda la familia: el token nuevo también queda inválido (401)', async () => {
      const { refreshToken: r1 } = (await register()).body;

      const r2 = (
        await request(app.getHttpServer())
          .post('/auth/refresh')
          .send({ refreshToken: r1 })
          .expect(200)
      ).body.refreshToken;

      // Replay de R1 → revoca la familia entera (UPDATE ... WHERE family_id).
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: r1 })
        .expect(401);

      // R2 pertenecía a la misma familia → también queda inválido.
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: r2 })
        .expect(401);
    });

    it('rechaza un refreshToken corrupto (401)', async () => {
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: 'not.a.valid.token' })
        .expect(401);
    });
  });

  // =======================================================================
  // POST /auth/logout  (revocación real en servidor; endpoint público)
  // =======================================================================
  describe('POST /auth/logout', () => {
    it('revoca el refresh: un refresh posterior con ese token responde 401', async () => {
      const { refreshToken } = (await register()).body;

      await request(app.getHttpServer())
        .post('/auth/logout')
        .send({ refreshToken })
        .expect(204);

      // Tras el logout, ese refresh ya no sirve.
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken })
        .expect(401);
    });

    it('funciona sin access token (204) — endpoint público', async () => {
      const { refreshToken } = (await register()).body;

      // No se envía Authorization: el logout debe ser alcanzable igual.
      await request(app.getHttpServer())
        .post('/auth/logout')
        .send({ refreshToken })
        .expect(204);
    });
  });
});
