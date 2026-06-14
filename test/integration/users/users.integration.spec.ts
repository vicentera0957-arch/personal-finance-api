import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../helpers/app-bootstrap';
import { cleanDatabase } from '../../helpers/db-cleaner';
import { decodeJwtSub } from '../../helpers/jwt';

describe('Usuarios: round-trip de perfil y ownership con el guard real', () => {
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
    // register/login no devuelven el id en el body: lo leemos del claim `sub`.
    userId = decodeJwtSub(accessToken);
  });

  // =======================================================================
  // Round-trip de perfil: el update realmente persiste (mapper + UPDATE real).
  // El mapper.spec prueba el mapper aislado; sólo aquí se prueba el viaje a Postgres.
  // =======================================================================
  describe('PATCH /users/:id/profile → GET /users/:id', () => {
    it('actualiza el nombre y el GET posterior lo refleja (persistido)', async () => {
      await request(app.getHttpServer())
        .patch(`/users/${userId}/profile`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Nombre Actualizado' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/users/${userId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('id', userId);
      expect(res.body).toHaveProperty('name', 'Nombre Actualizado');
    });
  });

  // =======================================================================
  // Barrera de propiedad: cadena real token → @CurrentUser → use case → fila ajena.
  // Los controller specs mockean el use case y fabrican currentUser; esto prueba
  // el cableado real del guard global.
  // =======================================================================
  describe('barrera de propiedad', () => {
    it('responde 401 sin token (guard global real)', async () => {
      await request(app.getHttpServer()).get(`/users/${userId}`).expect(401);
    });

    it('el token del usuario B sobre el id del usuario A responde 403', async () => {
      const other = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ name: 'Other User', email: 'other@example.com', password: 'Password1!' });

      // B usa su token contra el id de A → 403.
      await request(app.getHttpServer())
        .get(`/users/${userId}`)
        .set('Authorization', `Bearer ${other.body.accessToken}`)
        .expect(403);
    });
  });
});
