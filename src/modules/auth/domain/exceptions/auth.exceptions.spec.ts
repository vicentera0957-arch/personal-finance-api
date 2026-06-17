import {
  AuthException,
  InvalidCredentialsException,
  InvalidRefreshTokenException,
  RefreshTokenRevokedException,
  RefreshTokenExpiredException,
  RefreshTokenReplayDetectedException,
} from './auth.exceptions';

describe('Auth domain exceptions', () => {
  const cases: Array<[new () => AuthException, string]> = [
    [InvalidCredentialsException, 'InvalidCredentialsException'],
    [InvalidRefreshTokenException, 'InvalidRefreshTokenException'],
    [RefreshTokenRevokedException, 'RefreshTokenRevokedException'],
    [RefreshTokenExpiredException, 'RefreshTokenExpiredException'],
    [RefreshTokenReplayDetectedException, 'RefreshTokenReplayDetectedException'],
  ];

  it.each(cases)(
    '%p extiende AuthException/Error, expone name y un message no vacío',
    (Ctor, expectedName) => {
      const error = new Ctor();

      expect(error).toBeInstanceOf(AuthException);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe(expectedName);
      expect(error.message.length).toBeGreaterThan(0);
    },
  );
});
