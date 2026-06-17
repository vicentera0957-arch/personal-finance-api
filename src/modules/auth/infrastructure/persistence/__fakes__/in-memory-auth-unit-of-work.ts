import { IAuthUnitOfWork } from '../../../domain/IAuthUnitOfWork';
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
  private active = false;

  constructor(private readonly refreshTokenRepo: IRefreshTokenRepository) {
    super();
  }

  async begin(): Promise<void> {
    this.active = true;
  }

  async commit(): Promise<void> {
    this._commits++;
    this.active = false;
  }

  async rollback(): Promise<void> {
    this._rollbacks++;
    this.active = false;
  }

  async release(): Promise<void> {}

  isActive(): boolean {
    return this.active;
  }

  getRefreshTokenRepository(): IRefreshTokenRepository {
    return this.refreshTokenRepo;
  }

  // ── Test helpers ──
  commits(): number {
    return this._commits;
  }

  rollbacks(): number {
    return this._rollbacks;
  }
}
