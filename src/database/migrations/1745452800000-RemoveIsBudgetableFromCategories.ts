import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveIsBudgetableFromCategories1745452800000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "categories" DROP COLUMN "is_budgetable"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "categories" ADD COLUMN "is_budgetable" boolean NOT NULL DEFAULT true`,
    );
  }
}
