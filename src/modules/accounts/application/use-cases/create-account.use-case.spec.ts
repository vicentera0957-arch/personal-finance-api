import { CreateAccountUseCase } from './create-account.use-case';
import { InMemoryAccountRepository } from '../../infrastructure/persistence/__fakes__/in-memory-account.repository';
import {
  InvalidAccountTypeException,
  InvalidBalanceException,
} from '../../domain/exceptions/account.exceptions';

describe('CreateAccountUseCase', () => {
  let repo: InMemoryAccountRepository;
  let useCase: CreateAccountUseCase;

  beforeEach(() => {
    repo = new InMemoryAccountRepository();
    useCase = new CreateAccountUseCase(repo);
  });

  it('should persist a new account with matching initial and current balance', async () => {
    const result = await useCase.execute({
      userId: 'user-1',
      name: 'Main',
      type: 'corriente',
      initialBalance: 500,
    });

    expect(result.userId).toBe('user-1');
    expect(result.getCurrentBalance().getValue()).toBe(500);
    expect(result.getInitialBalance().getValue()).toBe(500);
    expect(result.getIsArchived()).toBe(false);
    expect(repo.size()).toBe(1);
  });

  it('should throw InvalidAccountTypeException when type is invalid', async () => {
    await expect(
      useCase.execute({
        userId: 'user-1',
        name: 'Main',
        type: 'bogus',
        initialBalance: 0,
      }),
    ).rejects.toThrow(InvalidAccountTypeException);

    expect(repo.size()).toBe(0);
  });

  it('should throw InvalidBalanceException when initial balance is not finite', async () => {
    await expect(
      useCase.execute({
        userId: 'user-1',
        name: 'Main',
        type: 'corriente',
        initialBalance: Number.NaN,
      }),
    ).rejects.toThrow(InvalidBalanceException);
  });
});
