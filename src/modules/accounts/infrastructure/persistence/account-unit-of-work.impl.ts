import { Injectable } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';
import {
  AccountTxContext,
  IAccountUnitOfWork,
} from '../../domain/IAccountUnitOfWork';
import { AccountMapper } from './account.mapper';
import { createScopedAccountRepository } from './scoped-account.repository';
import { TypeOrmTransactionRunner } from '../../../../shared/infrastructure/persistence/typeorm-transaction-runner';

// ── Implementación del UoW ─────────────────────────────────────────────────────

@Injectable()
export class AccountUnitOfWorkImpl
  extends TypeOrmTransactionRunner<AccountTxContext>
  implements IAccountUnitOfWork
{
  constructor(
    dataSource: DataSource,
    private readonly mapper: AccountMapper,
  ) {
    super(dataSource);
  }

  protected createContext(queryRunner: QueryRunner): AccountTxContext {
    return {
      accounts: createScopedAccountRepository(queryRunner, this.mapper),
    };
  }
}
