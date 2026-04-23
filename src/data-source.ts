import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';

/**
 * DataSource dedicado para la CLI de TypeORM (migrations, etc).
 *
 * ¿Por qué un DataSource separado y no reutilizar el de NestJS?
 *   - La CLI de TypeORM es standalone — corre fuera del runtime de Nest,
 *     entonces no tiene acceso al ConfigModule ni al DI graph.
 *   - Esta instancia se carga con dotenv directamente.
 *
 * Uso:
 *   npm run migration:generate -- src/database/migrations/AddRefreshTokens
 *   npm run migration:run
 *   npm run migration:revert
 *
 * Flujo típico de cambio de schema:
 *   1. Editás la ORM entity (agregás columna, índice, etc).
 *   2. migration:generate → TypeORM compara entity vs DB actual y emite SQL.
 *   3. Revisás el SQL manualmente (CRÍTICO — TypeORM a veces propone DROPs peligrosos).
 *   4. migration:run en dev → verificás. Commit.
 *   5. En CI/CD, migration:run se ejecuta ANTES del deploy del nuevo código.
 *   6. Si algo falla, migration:revert.
 *
 * Para zero-downtime, aplicá el patrón expand/contract — ver notes.md del módulo.
 */
dotenv.config();

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USER ?? 'finance_user',
  password: process.env.DB_PASSWORD ?? 'finance_password',
  database: process.env.DB_NAME ?? 'personal_finance_db',
  // Carga todas las *.orm.entity.ts bajo src/ — sin listar manualmente.
  entities: ['src/**/*.orm.entity.ts'],
  migrations: ['src/database/migrations/*.ts'],
  // La CLI NUNCA debe hacer synchronize (destruye datos). Siempre migrations.
  synchronize: false,
  logging: process.env.DB_LOGGING === 'true',
});
