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

  constructor(private readonly refreshTokenRepo: IRefreshTokenRepository) {
    super();
  }

  async run<T>(work: (ctx: AuthTxContext) => Promise<T>): Promise<T> {
    try {
      const result = await work({ refreshTokens: this.refreshTokenRepo });
      this._commits++;
      return result;
    } catch (err) {
      this._rollbacks++;
      throw err;
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
