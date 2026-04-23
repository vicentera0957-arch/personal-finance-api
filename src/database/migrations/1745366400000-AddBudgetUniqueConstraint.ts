import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBudgetUniqueConstraint1745366400000
  implements MigrationInterface
{
  name = 'AddBudgetUniqueConstraint1745366400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Remove any auto-generated unique constraint on the same columns that
    // synchronize:true may have created with a TypeORM-hashed name, then add
    // the explicit named constraint.
    await queryRunner.query(`
      DO $$
      DECLARE existing text;
      BEGIN
        SELECT tc.constraint_name INTO existing
        FROM information_schema.table_constraints tc
        INNER JOIN (
          SELECT constraint_name,
                 array_agg(column_name ORDER BY column_name) AS cols
          FROM information_schema.key_column_usage
          WHERE table_name = 'budgets'
          GROUP BY constraint_name
        ) kcu ON tc.constraint_name = kcu.constraint_name
        WHERE tc.table_name    = 'budgets'
          AND tc.constraint_type = 'UNIQUE'
          AND kcu.cols = ARRAY['category_id','month','user_id','year']
        LIMIT 1;

        IF existing IS NOT NULL AND existing <> 'UQ_budgets_user_category_period' THEN
          EXECUTE 'ALTER TABLE budgets DROP CONSTRAINT ' || quote_ident(existing);
          existing := NULL;
        END IF;

        IF existing IS NULL THEN
          ALTER TABLE "budgets"
          ADD CONSTRAINT "UQ_budgets_user_category_period"
          UNIQUE ("user_id", "category_id", "month", "year");
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "budgets" DROP CONSTRAINT "UQ_budgets_user_category_period"`,
    );
  }
}
