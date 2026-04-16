import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';

/**
 * Crea e inicializa la aplicación NestJS completa para integration tests.
 * Usa el AppModule real (DB real, JWT real, guards reales).
 *
 * Uso:
 *   let app: INestApplication;
 *   beforeAll(async () => { app = await createTestApp(); });
 *   afterAll(async () => { await app.close(); });
 */
export async function createTestApp(): Promise<INestApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();

  // Mismo pipe de validación que usa el app real
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.init();
  return app;
}
