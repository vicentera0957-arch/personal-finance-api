import { CleanupExpiredTokensScheduler } from './cleanup-expired-tokens.scheduler';
import { IRefreshTokenRepository } from '../../domain/repository/refresh-token.repository';

describe('CleanupExpiredTokensScheduler', () => {
  let repo: jest.Mocked<Pick<IRefreshTokenRepository, 'deleteExpired'>>;
  let scheduler: CleanupExpiredTokensScheduler;

  beforeEach(() => {
    repo = { deleteExpired: jest.fn() };
    scheduler = new CleanupExpiredTokensScheduler(
      repo as unknown as IRefreshTokenRepository,
    );
  });

  it('borra los tokens expirados pasando la fecha actual', async () => {
    repo.deleteExpired.mockResolvedValue(3);

    await scheduler.cleanupExpiredTokens();

    expect(repo.deleteExpired).toHaveBeenCalledTimes(1);
    const arg = repo.deleteExpired.mock.calls[0][0];
    expect(arg).toBeInstanceOf(Date);
  });
});
