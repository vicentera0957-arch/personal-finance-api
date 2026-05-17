import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRefreshTokens1746230400000 implements MigrationInterface {
  name = 'CreateRefreshTokens1746230400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "refresh_tokens" (
        "id"              UUID        NOT NULL,
        "user_id"         UUID        NOT NULL,
        "family_id"       UUID        NOT NULL,
        "token_hash"      VARCHAR(255) NOT NULL,
        "expires_at"      TIMESTAMP   NOT NULL,
        "created_at"      TIMESTAMP   NOT NULL DEFAULT now(),
        "revoked_at"      TIMESTAMP   NULL,
        "replaced_by_id"  UUID        NULL,
        CONSTRAINT "pk_refresh_tokens" PRIMARY KEY ("id"),
        CONSTRAINT "fk_refresh_tokens_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_refresh_tokens_replaced_by"
          FOREIGN KEY ("replaced_by_id") REFERENCES "refresh_tokens"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "idx_refresh_tokens_token_hash" ON "refresh_tokens" ("token_hash")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_refresh_tokens_family_id" ON "refresh_tokens" ("family_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_refresh_tokens_user_id" ON "refresh_tokens" ("user_id")`,
    );
    // Índice parcial: solo filas no revocadas — acelera el job de limpieza
    await queryRunner.query(
      `CREATE INDEX "idx_refresh_tokens_expires_at" ON "refresh_tokens" ("expires_at") WHERE "revoked_at" IS NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_refresh_tokens_expires_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_refresh_tokens_user_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_refresh_tokens_family_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_refresh_tokens_token_hash"`);
    await queryRunner.query(`DROP TABLE "refresh_tokens"`);
  }
}
