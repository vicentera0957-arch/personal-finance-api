import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { AppDataSource } from '../../src/data-source';

/**
 * Crea e inicializa la aplicación NestJS completa para integration tests.
 * Usa el AppModule real (DB real, JWT real, guards reales).
 *
 * Antes de arrancar el app, corre las migraciones pendientes en la DB de
 * test (personal_finance_db_test) usando el AppDataSource standalone.
 * Esto garantiza que los tests nunca dependan de synchronize:true y que
 * cualquier migración nueva se detecte antes de llegar a producción.
 *
 * Uso:
 *   let app: INestApplication;
 *   beforeAll(async () => { app = await createTestApp(); });
 *   afterAll(async () => { await app.close(); });
 */
export async function createTestApp(): Promise<INestApplication> {
  // Correr migraciones con el DataSource standalone (no usa DI de NestJS).
  // runMigrations() es idempotente: la tabla `migrations` evita re-aplicar.
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }
  await AppDataSource.runMigrations();
  await AppDataSource.destroy();

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
