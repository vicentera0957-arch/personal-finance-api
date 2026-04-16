import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../helpers/app-bootstrap';
import { cleanDatabase } from '../../helpers/db-cleaner';

describe('Users (integration)', () => {
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

    // Registrar usuario base para los tests
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'user@example.com', password: 'Password1!' });

    accessToken = res.body.accessToken;
    userId = res.body.user?.id ?? res.body.id; // ajustar según la forma del response
  });

  // -----------------------------------------------------------------------
  // GET /users/:id
  // -----------------------------------------------------------------------
  describe('GET /users/:id', () => {
    it('devuelve el usuario autenticado', async () => {
      const res = await request(app.getHttpServer())
        .get(`/users/${userId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('id', userId);
      expect(res.body).toHaveProperty('email', 'user@example.com');
    });

    it('devuelve 401 sin token', async () => {
      await request(app.getHttpServer()).get(`/users/${userId}`).expect(401);
    });

    it('devuelve 403 intentando acceder al perfil de otro usuario', async () => {
      const other = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'other@example.com', password: 'Password1!' });

      await request(app.getHttpServer())
        .get(`/users/${other.body.user?.id ?? other.body.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(403);
    });

    it('devuelve 404 para un id que no existe', async () => {
      await request(app.getHttpServer())
        .get('/users/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);
    });
  });

  // -----------------------------------------------------------------------
  // PATCH /users/:id/profile
  // -----------------------------------------------------------------------
  describe('PATCH /users/:id/profile', () => {
    it('actualiza el perfil del usuario autenticado', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/users/${userId}/profile`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Nuevo Nombre' })
        .expect(200);

      expect(res.body).toHaveProperty('name', 'Nuevo Nombre');
    });

    it('devuelve 403 intentando actualizar el perfil de otro usuario', async () => {
      const other = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'other@example.com', password: 'Password1!' });

      await request(app.getHttpServer())
        .patch(`/users/${other.body.user?.id ?? other.body.id}/profile`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Hack' })
        .expect(403);
    });
  });

  // -----------------------------------------------------------------------
  // DELETE /users/:id
  // -----------------------------------------------------------------------
  describe('DELETE /users/:id', () => {
    it('elimina el usuario autenticado', async () => {
      await request(app.getHttpServer())
        .delete(`/users/${userId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
    });

    it('devuelve 403 intentando eliminar a otro usuario', async () => {
      const other = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'other@example.com', password: 'Password1!' });

      await request(app.getHttpServer())
        .delete(`/users/${other.body.user?.id ?? other.body.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(403);
    });
  });
});
