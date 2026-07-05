import { MigrationInterface, QueryRunner } from 'typeorm';

// Definición ÚNICA de "qué cuenta como gasto" del sistema. Es una regla de
// negocio, no una conveniencia de código: hoy es `nature = 'expense'`, mañana
// podría excluir reversos o transferencias. Consumida por dos caminos que DEBEN
// coincidir siempre:
//   - reports  → GET /reports/summary  (el `expenses` del resumen)
//   - budgets  → los 3 agregados de enforcement en TypeOrmUnitOfWorkImpl
//                (sum del límite, sum al bajar límite, has-expenses al borrar)
// Si esa definición viviera duplicada en dos SQL, podrían derivar y el sistema
// se contradiría (el enforcement rechaza "gastaste S" mientras el reporte
// muestra otro S) — el mismo tipo de bug que `isBudgetable` en CLAUDE.md.
//
// NO se registra como @ViewEntity a propósito: TypeORM sólo gestiona las views
// anotadas en `typeorm_metadata`; una view creada por SQL crudo es invisible a
// `migration:generate` (verificado con dry-run), así que no propone recrearla ni
// dropearla. Misma política que el índice parcial descartado en
// docs/period-sum-index-decision.md: objetos DB no modelables declarativamente
// se gestionan sólo por migración manual.
export class CreatePeriodExpensesView1783292601885 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE VIEW "v_period_expenses" AS
       SELECT "id", "user_id", "category_id", "account_id", "amount", "transaction_date"
       FROM "transactions"
       WHERE "nature" = 'expense'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // La view no tiene estado: DROP la deja exactamente como estaba antes.
    await queryRunner.query(`DROP VIEW "v_period_expenses"`);
  }
}
