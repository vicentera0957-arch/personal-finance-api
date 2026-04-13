import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;

  beforeEach(() => {
    const configService = {
      getOrThrow: jest.fn().mockReturnValue('access-secret'),
    } as unknown as ConfigService;
    strategy = new JwtStrategy(configService);
  });

  describe('validate', () => {
    it('should map the JWT payload into { userId, email }', () => {
      expect(strategy.validate({ sub: 'user-1', email: 'a@b.cl' })).toEqual({
        userId: 'user-1',
        email: 'a@b.cl',
      });
    });
  });
});
