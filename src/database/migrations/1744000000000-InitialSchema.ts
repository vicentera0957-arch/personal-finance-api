import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1744000000000 implements MigrationInterface {
  name = 'InitialSchema1744000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // uuid_generate_v4() lo usa TypeORM para PrimaryGeneratedColumn('uuid').
    // La extensión es idempotente — no falla si ya existe.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying NOT NULL, "password_hash" character varying NOT NULL, "full_name" character varying NOT NULL, "created_at" TIMESTAMP NOT NULL, "updated_at" TIMESTAMP NOT NULL, CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_users_email" ON "users" ("email") `,
    );
    await queryRunner.query(
      `CREATE TABLE "accounts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "name" character varying NOT NULL, "type" character varying NOT NULL, "initial_balance" integer NOT NULL, "current_balance" integer NOT NULL, "is_archived" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_5a7a02c20412299d198e097a8fe" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_account_user" ON "accounts" ("user_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "categories" ("id" uuid NOT NULL, "user_id" uuid NOT NULL, "name" character varying(80) NOT NULL, "nature" character varying(20) NOT NULL, "color" character varying(20), "icon" character varying(50), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_60f3bd4aa1b7e60c1c76c7fa0a5" UNIQUE ("user_id", "name", "nature"), CONSTRAINT "PK_24dbc6126a28ff948da33e97d3b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2296b7fe012d95646fa41921c8" ON "categories" ("user_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "transactions" ("id" uuid NOT NULL, "user_id" uuid NOT NULL, "account_id" uuid NOT NULL, "category_id" uuid NOT NULL, "nature" character varying(20) NOT NULL, "amount" integer NOT NULL, "description" character varying(255), "transaction_date" TIMESTAMP NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_a219afd8dd77ed80f5a862f1db9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_tx_user_cat_nature_date" ON "transactions" ("user_id", "category_id", "nature", "transaction_date") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_tx_account_date" ON "transactions" ("account_id", "transaction_date") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_tx_user_date" ON "transactions" ("user_id", "transaction_date") `,
    );
    await queryRunner.query(
      `CREATE TABLE "budgets" ("id" uuid NOT NULL, "user_id" uuid NOT NULL, "category_id" uuid NOT NULL, "month" integer NOT NULL, "year" integer NOT NULL, "amount_limit" integer NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_budgets_user_category_period" UNIQUE ("user_id", "category_id", "month", "year"), CONSTRAINT "PK_9c8a51748f82387644b773da482" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c0c45c679cb723c1ffff48a139" ON "budgets" ("user_id", "month", "year") `,
    );
    await queryRunner.query(
      `ALTER TABLE "accounts" ADD CONSTRAINT "FK_3000dad1da61b29953f07476324" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "categories" ADD CONSTRAINT "FK_2296b7fe012d95646fa41921c8b" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" ADD CONSTRAINT "FK_e9acc6efa76de013e8c1553ed2b" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" ADD CONSTRAINT "FK_49c0d6e8ba4bfb5582000d851f0" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" ADD CONSTRAINT "FK_c9e41213ca42d50132ed7ab2b0f" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "budgets" ADD CONSTRAINT "FK_5d25d8bbd6c209261dfe04558f1" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "budgets" ADD CONSTRAINT "FK_4bb589bf6db49e8c1fd6af05f49" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "budgets" DROP CONSTRAINT "FK_4bb589bf6db49e8c1fd6af05f49"`,
    );
    await queryRunner.query(
      `ALTER TABLE "budgets" DROP CONSTRAINT "FK_5d25d8bbd6c209261dfe04558f1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" DROP CONSTRAINT "FK_c9e41213ca42d50132ed7ab2b0f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" DROP CONSTRAINT "FK_49c0d6e8ba4bfb5582000d851f0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" DROP CONSTRAINT "FK_e9acc6efa76de013e8c1553ed2b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "categories" DROP CONSTRAINT "FK_2296b7fe012d95646fa41921c8b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "accounts" DROP CONSTRAINT "FK_3000dad1da61b29953f07476324"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c0c45c679cb723c1ffff48a139"`,
    );
    await queryRunner.query(`DROP TABLE "budgets"`);
    await queryRunner.query(`DROP INDEX "public"."idx_tx_user_date"`);
    await queryRunner.query(`DROP INDEX "public"."idx_tx_account_date"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_tx_user_cat_nature_date"`,
    );
    await queryRunner.query(`DROP TABLE "transactions"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2296b7fe012d95646fa41921c8"`,
    );
    await queryRunner.query(`DROP TABLE "categories"`);
    await queryRunner.query(`DROP INDEX "public"."idx_account_user"`);
    await queryRunner.query(`DROP TABLE "accounts"`);
    await queryRunner.query(`DROP INDEX "public"."uq_users_email"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
