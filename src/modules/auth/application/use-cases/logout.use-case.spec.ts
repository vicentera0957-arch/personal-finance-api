import { UnauthorizedException } from '@nestjs/common';
import { LogoutUseCase } from './logout.use-case';
import { ITokenProvider } from '../../domain/ports/token-provider.port';
import { IRefreshTokenRepository } from '../../domain/repository/refresh-token.repository';
import { RefreshToken } from '../../domain/entities/refresh-token.entity';
import { InvalidRefreshTokenException } from '../../domain/exceptions/auth.exceptions';

function makeToken(expiresAt?: Date): RefreshToken {
  return RefreshToken.create({
    id: 'jti-1',
    userId: 'user-1',
    familyId: 'family-1',
    tokenHash: 'hash-abc',
    expiresAt: expiresAt ?? new Date(Date.now() + 86_400_000),
  });
}

describe('LogoutUseCase', () => {
  let useCase: LogoutUseCase;
  let tokenProvider: jest.Mocked<Pick<ITokenProvider, 'verifyRefreshToken'>>;
  let repo: jest.Mocked<
    Pick<IRefreshTokenRepository, 'findByTokenHash' | 'save'>
  >;

  beforeEach(() => {
    tokenProvider = {
      verifyRefreshToken: jest.fn().mockResolvedValue({
        sub: 'user-1',
        email: 'a@b.cl',
        jti: 'jti-1',
      }),
    };

    repo = {
      findByTokenHash: jest.fn(),
      save: jest.fn().mockResolvedValue(undefined),
    };

    useCase = new LogoutUseCase(
      tokenProvider as unknown as ITokenProvider,
      repo as unknown as IRefreshTokenRepository,
    );
  });

  it('revoca el token y lo guarda', async () => {
    const stored = makeToken();
    repo.findByTokenHash.mockResolvedValue(stored);

    await useCase.execute('valid-refresh-token');

    expect(stored.isRevoked()).toBe(true);
    expect(repo.save).toHaveBeenCalledWith(stored);
  });

  it('es idempotente: si ya está revocado no llama a save', async () => {
    const stored = makeToken();
    stored.revoke();
    repo.findByTokenHash.mockResolvedValue(stored);

    await useCase.execute('already-revoked-token');

    expect(repo.save).not.toHaveBeenCalled();
  });

  it('lanza InvalidRefreshTokenException si el token no está en DB', async () => {
    repo.findByTokenHash.mockResolvedValue(null);

    await expect(useCase.execute('unknown-token')).rejects.toThrow(
      InvalidRefreshTokenException,
    );
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('lanza InvalidRefreshTokenException si la firma JWT es inválida', async () => {
    tokenProvider.verifyRefreshToken.mockRejectedValue(
      new UnauthorizedException('bad sig'),
    );

    await expect(useCase.execute('bad-token')).rejects.toThrow(
      InvalidRefreshTokenException,
    );
    expect(repo.findByTokenHash).not.toHaveBeenCalled();
  });
});
