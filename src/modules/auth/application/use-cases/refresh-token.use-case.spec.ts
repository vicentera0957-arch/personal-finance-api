import { UnauthorizedException } from '@nestjs/common';
import { RefreshTokenUseCase } from './refresh-token.use-case';
import { ITokenProvider } from '../../domain/ports/token-provider.port';
import { RefreshToken } from '../../domain/entities/refresh-token.entity';
import {
  InvalidRefreshTokenException,
  RefreshTokenExpiredException,
  RefreshTokenReplayDetectedException,
} from '../../domain/exceptions/auth.exceptions';
import { InMemoryRefreshTokenRepository } from '../../infrastructure/persistence/__fakes__/in-memory-refresh-token.repository';
import { InMemoryAuthUnitOfWork } from '../../infrastructure/persistence/__fakes__/in-memory-auth-unit-of-work';
import { sha256 } from '../utils/token-hash.util';

// The use case looks the token up by sha256(rawToken); seeds use the real hash so
// the lookup matches (exercises the hashing path instead of bypassing it).
function makeToken(
  rawToken: string,
  opts: {
    id?: string;
    familyId?: string;
    revoked?: boolean;
    expiresAt?: Date;
  } = {},
): RefreshToken {
  const token = RefreshToken.create({
    id: opts.id ?? 'jti-1',
    userId: 'user-1',
    familyId: opts.familyId ?? 'family-1',
    tokenHash: sha256(rawToken),
    expiresAt: opts.expiresAt ?? new Date(Date.now() + 86_400_000),
  });
  if (opts.revoked) token.revoke();
  return token;
}

describe('RefreshTokenUseCase', () => {
  let useCase: RefreshTokenUseCase;
  let tokenProvider: jest.Mocked<ITokenProvider>;
  let repo: InMemoryRefreshTokenRepository;
  let uow: InMemoryAuthUnitOfWork;

  beforeEach(() => {
    // Stateful ports -> InMemory fakes (the UoW hands back the same repo).
    repo = new InMemoryRefreshTokenRepository();
    uow = new InMemoryAuthUnitOfWork(repo);

    // Thin adapter -> jest.fn.
    tokenProvider = {
      generateAccessToken: jest.fn().mockResolvedValue('new-access'),
      generateRefreshToken: jest.fn().mockResolvedValue('new-refresh'),
      verifyAccessToken: jest.fn(),
      verifyRefreshToken: jest.fn(),
      getRefreshTokenExpiresAt: jest
        .fn()
        .mockReturnValue(new Date(Date.now() + 86_400_000)),
    };

    useCase = new RefreshTokenUseCase(tokenProvider, uow);
  });

  it('rotates correctly: invalidates the old one and issues a new pair', async () => {
    repo.seed([makeToken('old-refresh-token')]);
    tokenProvider.verifyRefreshToken.mockResolvedValue({
      sub: 'user-1',
      email: 'a@b.cl',
      jti: 'jti-1',
    });

    const result = await useCase.execute('old-refresh-token');

    expect(result).toEqual({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
    });
    expect(uow.commits()).toBe(1);
    expect(uow.rollbacks()).toBe(0);

    // State: old token revoked, new token persisted under the same family.
    const old = await repo.findByTokenHash(sha256('old-refresh-token'));
    expect(old?.isRevoked()).toBe(true);
    const fresh = await repo.findByTokenHash(sha256('new-refresh'));
    expect(fresh?.isRevoked()).toBe(false);
    expect(fresh?.familyId).toBe('family-1');
    expect(repo.size()).toBe(2);
  });

  it('throws InvalidRefreshTokenException if the token is not in the DB', async () => {
    tokenProvider.verifyRefreshToken.mockResolvedValue({
      sub: 'user-1',
      email: 'a@b.cl',
      jti: 'jti-1',
    });
    // repo is empty

    await expect(useCase.execute('unknown-token')).rejects.toThrow(
      InvalidRefreshTokenException,
    );
    expect(uow.rollbacks()).toBe(1);
  });

  it('detects replay: revokes the whole family and throws ReplayDetectedException', async () => {
    // The presented token is already revoked; a sibling in the same family is
    // still active — after replay detection it must end up revoked too.
    repo.seed([
      makeToken('already-rotated-token', { id: 'jti-1', revoked: true }),
      makeToken('sibling-token', { id: 'jti-2', familyId: 'family-1' }),
    ]);
    tokenProvider.verifyRefreshToken.mockResolvedValue({
      sub: 'user-1',
      email: 'a@b.cl',
      jti: 'jti-1',
    });

    await expect(useCase.execute('already-rotated-token')).rejects.toThrow(
      RefreshTokenReplayDetectedException,
    );
    expect(uow.commits()).toBe(1); // the revocation is committed on purpose

    // State proof: revokeFamily revoked the active sibling too.
    const sibling = await repo.findByTokenHash(sha256('sibling-token'));
    expect(sibling?.isRevoked()).toBe(true);
  });

  it('throws RefreshTokenExpiredException if the token is expired', async () => {
    repo.seed([
      makeToken('expired-token', { expiresAt: new Date(Date.now() - 1000) }),
    ]);
    tokenProvider.verifyRefreshToken.mockResolvedValue({
      sub: 'user-1',
      email: 'a@b.cl',
      jti: 'jti-1',
    });

    await expect(useCase.execute('expired-token')).rejects.toThrow(
      RefreshTokenExpiredException,
    );
    expect(uow.rollbacks()).toBe(1);
  });

  it('propagates the exception if verifyRefreshToken fails (invalid signature)', async () => {
    tokenProvider.verifyRefreshToken.mockRejectedValue(
      new UnauthorizedException('invalid'),
    );

    await expect(useCase.execute('bad-token')).rejects.toThrow(
      UnauthorizedException,
    );
    // Must not open a transaction if the signature fails (no commit, no rollback).
    expect(uow.commits()).toBe(0);
    expect(uow.rollbacks()).toBe(0);
  });
});
