import { MigrationInterface, QueryRunner } from 'typeorm';

// No-op: InitialSchema ya genera la tabla `budgets` con la constraint
// UQ_budgets_user_category_period incluida. La lógica PL/pgSQL original
// también fallaba en PostgreSQL 15 (sql_identifier[] vs text[]).
export class AddBudgetUniqueConstraint1745366400000
  implements MigrationInterface
{
  name = 'AddBudgetUniqueConstraint1745366400000';

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async up(_queryRunner: QueryRunner): Promise<void> {
    // no-op — constraint ya presente en InitialSchema
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async down(_queryRunner: QueryRunner): Promise<void> {
    // no-op
  }
}
