import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../helpers/app-bootstrap';
import { cleanDatabase } from '../../helpers/db-cleaner';

describe('Auth: registration, refresh rotation and family revocation', () => {
  let app: INestApplication;

  // Registers a user; returns the issued token pair.
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
  // POST /auth/register  (real round-trip + email uniqueness enforced by the DB)
  // Error mapping and DTO validation are covered by the unit tests; here we only
  // test what needs a real Postgres.
  // =======================================================================
  describe('POST /auth/register', () => {
    it('registers and the returned accessToken works on a protected route', async () => {
      const res = await register().expect(201);

      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');

      // The token really works: the real JWT guard accepts it on a protected route.
      await request(app.getHttpServer())
        .get('/accounts')
        .set('Authorization', `Bearer ${res.body.accessToken}`)
        .expect(200);
    });

    it('rejects a duplicate email (409) — real constraint, not a pre-check', async () => {
      await register('dup@example.com').expect(201);

      // The 409 comes from the DB UNIQUE -> catch 23505 -> UserAlreadyExistsException.
      await register('dup@example.com').expect(409);
    });
  });

  // =======================================================================
  // POST /auth/refresh  (THE JEWEL: rotation + replay + family revocation)
  // The unit test uses a mocked UoW; here the real revocation SQL runs and the
  // token chain is actually persisted.
  // =======================================================================
  describe('POST /auth/refresh', () => {
    it('issues a new pair and the refreshToken rotates (changes)', async () => {
      const { refreshToken: r1 } = (await register()).body;

      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: r1 })
        .expect(200);

      expect(res.body).toHaveProperty('accessToken');
      expect(res.body.refreshToken).toBeDefined();
      expect(res.body.refreshToken).not.toBe(r1); // real rotation
    });

    it('reusing the previous token after rotating responds 401 (replay)', async () => {
      const { refreshToken: r1 } = (await register()).body;

      // Rotate R1 -> R2; R1 becomes revoked.
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: r1 })
        .expect(200);

      // Reusing R1 (already rotated) is a replay -> 401.
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: r1 })
        .expect(401);
    });

    it('replay revokes the whole family: the new token also becomes invalid (401)', async () => {
      const { refreshToken: r1 } = (await register()).body;

      const r2 = (
        await request(app.getHttpServer())
          .post('/auth/refresh')
          .send({ refreshToken: r1 })
          .expect(200)
      ).body.refreshToken;

      // Replay of R1 -> revokes the entire family (UPDATE ... WHERE family_id).
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: r1 })
        .expect(401);

      // R2 belonged to the same family -> also invalid now.
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: r2 })
        .expect(401);
    });

    it('rejects a corrupt refreshToken (401)', async () => {
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: 'not.a.valid.token' })
        .expect(401);
    });
  });

  // =======================================================================
  // POST /auth/logout  (real server-side revocation; public endpoint)
  // =======================================================================
  describe('POST /auth/logout', () => {
    it('revokes the refresh: a later refresh with that token responds 401', async () => {
      const { refreshToken } = (await register()).body;

      await request(app.getHttpServer())
        .post('/auth/logout')
        .send({ refreshToken })
        .expect(204);

      // After logout, that refresh no longer works.
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken })
        .expect(401);
    });

    it('works without an access token (204) — public endpoint', async () => {
      const { refreshToken } = (await register()).body;

      // No Authorization sent: logout must still be reachable.
      await request(app.getHttpServer())
        .post('/auth/logout')
        .send({ refreshToken })
        .expect(204);
    });
  });
});
