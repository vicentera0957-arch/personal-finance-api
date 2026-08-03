import { Injectable, Scope } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';
import {
  AccountTxContext,
  IAccountUnitOfWork,
} from '../../domain/IAccountUnitOfWork';
import { IAccountRepository } from '../../domain/repository/accounts.repository';
import { AccountMapper } from './account.mapper';
import { createScopedAccountRepository } from './scoped-account.repository';

// ── Implementación del UoW ─────────────────────────────────────────────────────

@Injectable({ scope: Scope.REQUEST })
export class AccountUnitOfWorkImpl extends IAccountUnitOfWork {
  private queryRunner: QueryRunner | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly mapper: AccountMapper,
  ) {
    super();
  }

  async begin(): Promise<void> {
    this.queryRunner = this.dataSource.createQueryRunner();
    await this.queryRunner.connect();
    await this.queryRunner.startTransaction();
  }

  async commit(): Promise<void> {
    await this.queryRunner?.commitTransaction();
  }

  async rollback(): Promise<void> {
    // No-op si no hay transacción abierta: un commit previo ya la cerró (typeorm
    // pone isTransactionActive=false en commitTransaction()). Sin este guard,
    // rollbackTransaction() lanza TransactionNotStartedError y enmascara la
    // excepción original que llevó al catch del use case.
    if (!this.queryRunner?.isTransactionActive) return;
    await this.queryRunner.rollbackTransaction();
  }

  async release(): Promise<void> {
    await this.queryRunner?.release();
    this.queryRunner = null;
  }

  isConnected(): boolean {
    return this.queryRunner !== null;
  }

  getScopedAccountRepository(): IAccountRepository {
    return createScopedAccountRepository(this.queryRunner!, this.mapper);
  }

  // Transicional: reusa el ciclo de vida manual de arriba. Todavía no usa el
  // AsyncLocalStorage/Proxy de TypeOrmTransactionRunner — este impl sigue
  // siendo statefull, así que el agujero de anidamiento que ese detector
  // cierra no existe todavía acá (ver PLAN-P3P4 §5.2).
  async run<T>(work: (ctx: AccountTxContext) => Promise<T>): Promise<T> {
    await this.begin();
    try {
      const result = await work({
        accounts: this.getScopedAccountRepository(),
      });
      await this.commit();
      return result;
    } catch (err) {
      await this.rollback();
      throw err;
    } finally {
      await this.release();
    }
  }
}
