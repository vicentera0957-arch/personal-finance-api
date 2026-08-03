import {
  AuthTxContext,
  IAuthUnitOfWork,
} from '../../../domain/IAuthUnitOfWork';
import { IRefreshTokenRepository } from '../../../domain/repository/refresh-token.repository';

/**
 * In-memory fake of IAuthUnitOfWork for unit tests. Fakes the transaction
 * lifecycle by counting begin/commit/rollback (assert with commits()/rollbacks())
 * and hands back the same in-memory refresh-token repo, so a test asserts the
 * orchestration AND the resulting state in one coherent world — without a real DB.
 * No real locks: FOR UPDATE serialization is verified by the integration suite.
 */
export class InMemoryAuthUnitOfWork extends IAuthUnitOfWork {
  private _commits = 0;
  private _rollbacks = 0;
  private connected = false;

  constructor(private readonly refreshTokenRepo: IRefreshTokenRepository) {
    super();
  }

  async begin(): Promise<void> {
    this.connected = true;
  }

  async commit(): Promise<void> {
    this._commits++;
  }

  async rollback(): Promise<void> {
    this._rollbacks++;
  }

  async release(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getRefreshTokenRepository(): IRefreshTokenRepository {
    return this.refreshTokenRepo;
  }

  async run<T>(work: (ctx: AuthTxContext) => Promise<T>): Promise<T> {
    this.connected = true;
    try {
      const result = await work({ refreshTokens: this.refreshTokenRepo });
      this._commits++;
      return result;
    } catch (err) {
      this._rollbacks++;
      throw err;
    } finally {
      this.connected = false;
    }
  }

  // ── Test helpers ──
  commits(): number {
    return this._commits;
  }

  rollbacks(): number {
    return this._rollbacks;
  }
}
