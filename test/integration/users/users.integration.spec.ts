import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../helpers/app-bootstrap';
import { cleanDatabase } from '../../helpers/db-cleaner';
import { decodeJwtSub } from '../../helpers/jwt';

describe('Users: profile round-trip and ownership with the real guard', () => {
  let app: INestApplication;
  let accessToken: string;
  let userId: string;

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
      .send({ name: 'Test User', email: 'user@example.com', password: 'Password1!' });

    accessToken = res.body.accessToken;
    // register/login don't return the id in the body: we read it from the `sub` claim.
    userId = decodeJwtSub(accessToken);
  });

  // =======================================================================
  // Profile round-trip: the update really persists (mapper + real UPDATE).
  // The mapper.spec tests the mapper in isolation; only here we test the trip
  // to Postgres.
  // =======================================================================
  describe('PATCH /users/:id/profile -> GET /users/:id', () => {
    it('updates the name and the later GET reflects it (persisted)', async () => {
      await request(app.getHttpServer())
        .patch(`/users/${userId}/profile`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Updated Name' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/users/${userId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('id', userId);
      expect(res.body).toHaveProperty('name', 'Updated Name');
    });
  });

  // =======================================================================
  // Ownership barrier: real chain token -> @CurrentUser -> use case -> other's row.
  // The controller specs mock the use case and fabricate currentUser; this tests
  // the real wiring of the global guard.
  // =======================================================================
  describe('ownership barrier', () => {
    it('responds 401 without a token (real global guard)', async () => {
      await request(app.getHttpServer()).get(`/users/${userId}`).expect(401);
    });

    it("user B's token on user A's id responds 403", async () => {
      const other = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ name: 'Other User', email: 'other@example.com', password: 'Password1!' });

      // B uses its token against A's id -> 403.
      await request(app.getHttpServer())
        .get(`/users/${userId}`)
        .set('Authorization', `Bearer ${other.body.accessToken}`)
        .expect(403);
    });
  });
});
