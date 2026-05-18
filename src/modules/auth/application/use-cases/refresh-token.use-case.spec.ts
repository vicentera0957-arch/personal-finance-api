import { UnauthorizedException } from '@nestjs/common';
import { RefreshTokenUseCase } from './refresh-token.use-case';
import { ITokenProvider } from '../../domain/ports/token-provider.port';
import { IAuthUnitOfWork } from '../../domain/IAuthUnitOfWork';
import { IRefreshTokenRepository } from '../../domain/repository/refresh-token.repository';
import { RefreshToken } from '../../domain/entities/refresh-token.entity';
import {
  InvalidRefreshTokenException,
  RefreshTokenExpiredException,
  RefreshTokenReplayDetectedException,
} from '../../domain/exceptions/auth.exceptions';

function makeToken(
  overrides: Partial<Parameters<typeof RefreshToken.create>[0]> & {
    revokedAt?: Date | null;
    expiresAt?: Date;
  } = {},
): RefreshToken {
  const base = RefreshToken.create({
    id: 'jti-1',
    userId: 'user-1',
    familyId: 'family-1',
    tokenHash: 'hash-abc',
    expiresAt: new Date(Date.now() + 86_400_000),
    ...overrides,
  });
  if (overrides.revokedAt !== undefined && overrides.revokedAt !== null) {
    base.revoke();
  }
  return base;
}

describe('RefreshTokenUseCase', () => {
  let useCase: RefreshTokenUseCase;
  let tokenProvider: jest.Mocked<ITokenProvider>;
  let repo: jest.Mocked<IRefreshTokenRepository>;
  let uow: jest.Mocked<IAuthUnitOfWork>;

  beforeEach(() => {
    repo = {
      findByTokenHash: jest.fn(),
      findByTokenHashWithLock: jest.fn(),
      save: jest.fn().mockResolvedValue(undefined),
      revokeFamily: jest.fn().mockResolvedValue(undefined),
      deleteExpired: jest.fn(),
    };

    uow = {
      begin: jest.fn().mockResolvedValue(undefined),
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      isActive: jest.fn().mockReturnValue(false),
      getRefreshTokenRepository: jest.fn().mockReturnValue(repo),
    };

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

  it('rota correctamente: invalida el viejo y emite par nuevo', async () => {
    const stored = makeToken();
    tokenProvider.verifyRefreshToken.mockResolvedValue({
      sub: 'user-1',
      email: 'a@b.cl',
      jti: 'jti-1',
    });
    repo.findByTokenHashWithLock.mockResolvedValue(stored);

    const result = await useCase.execute('old-refresh-token');

    expect(result).toEqual({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
    });
    expect(uow.begin).toHaveBeenCalledTimes(1);
    expect(uow.commit).toHaveBeenCalledTimes(1);
    expect(uow.release).toHaveBeenCalledTimes(1);
    // Guardó el token viejo (revocado) y el nuevo
    expect(repo.save).toHaveBeenCalledTimes(2);
    expect(stored.isRevoked()).toBe(true);
  });

  it('lanza InvalidRefreshTokenException si el token no está en DB', async () => {
    tokenProvider.verifyRefreshToken.mockResolvedValue({
      sub: 'user-1',
      email: 'a@b.cl',
      jti: 'jti-1',
    });
    repo.findByTokenHashWithLock.mockResolvedValue(null);

    await expect(useCase.execute('unknown-token')).rejects.toThrow(
      InvalidRefreshTokenException,
    );
    expect(uow.rollback).toHaveBeenCalledTimes(1);
    expect(uow.release).toHaveBeenCalledTimes(1);
  });

  it('detecta replay: revoca la familia entera y lanza ReplayDetectedException', async () => {
    const revoked = makeToken({ revokedAt: new Date() });
    tokenProvider.verifyRefreshToken.mockResolvedValue({
      sub: 'user-1',
      email: 'a@b.cl',
      jti: 'jti-1',
    });
    repo.findByTokenHashWithLock.mockResolvedValue(revoked);

    await expect(useCase.execute('already-rotated-token')).rejects.toThrow(
      RefreshTokenReplayDetectedException,
    );
    expect(repo.revokeFamily).toHaveBeenCalledWith('family-1');
    expect(uow.commit).toHaveBeenCalledTimes(1); // la revocación sí se comitea
    expect(uow.release).toHaveBeenCalledTimes(1);
  });

  it('lanza RefreshTokenExpiredException si el token está expirado', async () => {
    const expired = RefreshToken.create({
      id: 'jti-1',
      userId: 'user-1',
      familyId: 'family-1',
      tokenHash: 'h',
      expiresAt: new Date(Date.now() - 1000),
    });
    tokenProvider.verifyRefreshToken.mockResolvedValue({
      sub: 'user-1',
      email: 'a@b.cl',
      jti: 'jti-1',
    });
    repo.findByTokenHashWithLock.mockResolvedValue(expired);

    await expect(useCase.execute('expired-token')).rejects.toThrow(
      RefreshTokenExpiredException,
    );
    expect(uow.rollback).toHaveBeenCalledTimes(1);
  });

  it('propaga excepción si verifyRefreshToken falla (firma inválida)', async () => {
    tokenProvider.verifyRefreshToken.mockRejectedValue(
      new UnauthorizedException('invalid'),
    );

    await expect(useCase.execute('bad-token')).rejects.toThrow(
      UnauthorizedException,
    );
    // No se debe abrir transacción si la firma falla
    expect(uow.begin).not.toHaveBeenCalled();
  });
});
