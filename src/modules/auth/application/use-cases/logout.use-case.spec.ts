import { UnauthorizedException } from '@nestjs/common';
import { LogoutUseCase } from './logout.use-case';
import { ITokenProvider } from '../../domain/ports/token-provider.port';
import { RefreshToken } from '../../domain/entities/refresh-token.entity';
import { InvalidRefreshTokenException } from '../../domain/exceptions/auth.exceptions';
import { InMemoryRefreshTokenRepository } from '../../infrastructure/persistence/__fakes__/in-memory-refresh-token.repository';
import { sha256 } from '../utils/token-hash.util';

// The use case looks the token up by sha256(rawToken), so the seed's tokenHash
// must be the hash of the raw token the test passes — this exercises the real
// hashing path instead of bypassing it.
function makeToken(
  rawToken: string,
  opts: { revoked?: boolean } = {},
): RefreshToken {
  const token = RefreshToken.create({
    id: 'jti-1',
    userId: 'user-1',
    familyId: 'family-1',
    tokenHash: sha256(rawToken),
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  if (opts.revoked) token.revoke();
  return token;
}

describe('LogoutUseCase', () => {
  let useCase: LogoutUseCase;
  let tokenProvider: jest.Mocked<Pick<ITokenProvider, 'verifyRefreshToken'>>;
  let repo: InMemoryRefreshTokenRepository;

  beforeEach(() => {
    tokenProvider = {
      verifyRefreshToken: jest.fn().mockResolvedValue({
        sub: 'user-1',
        email: 'a@b.cl',
        jti: 'jti-1',
      }),
    };
    repo = new InMemoryRefreshTokenRepository();

    useCase = new LogoutUseCase(
      tokenProvider as unknown as ITokenProvider,
      repo,
    );
  });

  it('revokes the token and saves it', async () => {
    repo.seed([makeToken('valid-refresh-token')]);

    await useCase.execute('valid-refresh-token');

    const after = await repo.findByTokenHash(sha256('valid-refresh-token'));
    expect(after?.isRevoked()).toBe(true);
  });

  it('is idempotent: does not call save if already revoked', async () => {
    repo.seed([makeToken('already-revoked-token', { revoked: true })]);
    // Idempotency is an interaction property (does it short-circuit the write?),
    // so we spy on the fake's save for this one assertion.
    const saveSpy = jest.spyOn(repo, 'save');

    await useCase.execute('already-revoked-token');

    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('throws InvalidRefreshTokenException if the token is not in the DB', async () => {
    // repo is empty
    await expect(useCase.execute('unknown-token')).rejects.toThrow(
      InvalidRefreshTokenException,
    );
  });

  it('throws InvalidRefreshTokenException if the JWT signature is invalid', async () => {
    tokenProvider.verifyRefreshToken.mockRejectedValue(
      new UnauthorizedException('bad sig'),
    );
    const findSpy = jest.spyOn(repo, 'findByTokenHash');

    await expect(useCase.execute('bad-token')).rejects.toThrow(
      InvalidRefreshTokenException,
    );
    // Fail-fast: the signature is rejected before any DB lookup.
    expect(findSpy).not.toHaveBeenCalled();
  });
});
