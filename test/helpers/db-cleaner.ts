import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * Trunca todas las tablas en orden inverso a las dependencias FK.
 * Llamar en beforeEach (o afterEach) de cada suite de integration tests
 * para garantizar aislamiento entre pruebas.
 *
 * Orden de truncado (inverso al orden de creación):
 *   transactions → budgets → categories → accounts → users
 */
export async function cleanDatabase(app: INestApplication): Promise<void> {
  const dataSource = app.get(DataSource);

  await dataSource.query(
    'TRUNCATE TABLE transactions, budgets, categories, accounts, users RESTART IDENTITY CASCADE',
  );
}
