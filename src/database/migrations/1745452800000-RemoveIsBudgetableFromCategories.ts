import { MigrationInterface, QueryRunner } from 'typeorm';

// No-op: InitialSchema ya genera la tabla `categories` sin la columna
// `is_budgetable`. Esta migración solo aplica sobre DBs creadas antes de la
// migración inicial (con synchronize:true activo). En una DB nueva desde cero,
// la columna nunca existió, por lo que el DROP COLUMN fallaría.
export class RemoveIsBudgetableFromCategories1745452800000
  implements MigrationInterface
{
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async up(_queryRunner: QueryRunner): Promise<void> {
    // no-op — columna ya ausente en InitialSchema
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async down(_queryRunner: QueryRunner): Promise<void> {
    // no-op
  }
}
