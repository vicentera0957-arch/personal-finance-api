import { EntityManager, QueryRunner } from 'typeorm';
import { IAccountRepository } from '../../domain/repository/accounts.repository';
import { Account } from '../../domain/entities/account.entity';
import { AccountOrmEntity } from './account.orm.entity';
import { AccountMapper } from './account.mapper';

// ── Scoped repository — private to this file; only the factory below constructs it ──
//
// Runs on the EntityManager of the ACTIVE QueryRunner, so every read/write happens
// inside the transaction the caller's UoW opened. Key fact about the FOR UPDATE lock
// below: a pessimistic row lock is held until the TRANSACTION commits or rolls back —
// NOT until the findOne call returns. The method returns the row, but the lock stays
// for the whole begin()→commit() window, covering the later write. (If this ran on the
// global DataSource in autocommit, the lock would be released right after the SELECT
// and would be useless — hence scoped repos only, built from a QueryRunner with an
// active transaction.)

class ScopedAccountRepository extends IAccountRepository {
  constructor(
    private readonly manager: EntityManager,
    private readonly mapper: AccountMapper,
  ) {
    super();
  }

  // LOCK (FOR UPDATE): account row, held until commit. Serializes every balance
  // mutation on this account — CreateTransaction, DeleteTransaction, and the
  // Archive/Unarchive/Rename use cases all compete for this same row (Race 2).
  async findById(id: string): Promise<Account | null> {
    const orm = await this.manager.findOne(AccountOrmEntity, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    return orm ? this.mapper.toDomain(orm) : null;
  }

  async findByUserId(userId: string): Promise<Account[]> {
    const orms = await this.manager.find(AccountOrmEntity, {
      where: { userId },
    });
    return orms.map((orm) => this.mapper.toDomain(orm));
  }

  async save(account: Account): Promise<Account> {
    const orm = this.mapper.toOrm(account);
    const saved = await this.manager.save(AccountOrmEntity, orm);
    return this.mapper.toDomain(saved);
  }

  async delete(id: string): Promise<void> {
    await this.manager.delete(AccountOrmEntity, id);
  }
}

// ── Factory — the only way to obtain a ScopedAccountRepository ────────────────
//
// Takes a QueryRunner (not an EntityManager / DataSource) on purpose: a
// `dataSource.manager` is not a QueryRunner, so passing it stops compiling. This
// moves the "must be transactional" precondition from a runtime guard to a
// compile-time one for the common misuse (autocommit via the global DataSource).
// It still can't catch a QueryRunner that's connected but never started a
// transaction, so we validate that here too — a FOR UPDATE without an open
// transaction is type-correct but silently pointless.
export function createScopedAccountRepository(
  queryRunner: QueryRunner,
  mapper: AccountMapper,
): IAccountRepository {
  if (queryRunner.isReleased || !queryRunner.isTransactionActive) {
    throw new Error(
      'createScopedAccountRepository requires a QueryRunner with an active transaction: ' +
        'its FOR UPDATE locks have no effect otherwise.',
    );
  }
  return new ScopedAccountRepository(queryRunner.manager, mapper);
}
