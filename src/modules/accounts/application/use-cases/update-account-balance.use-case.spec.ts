import { UpdateAccountBalanceUseCase } from './update-account-balance.use-case';
import { InMemoryAccountRepository } from '../../infrastructure/persistence/__fakes__/in-memory-account.repository';
import {
  AccountNotFoundException,
  CannotOperateOnArchivedAccountException,
  InsufficientFundsException,
} from '../../domain/exceptions/account.exceptions';
import { makeAccount } from '../../../../test-support/factories';

describe('UpdateAccountBalanceUseCase', () => {
  let repo: InMemoryAccountRepository;
  let useCase: UpdateAccountBalanceUseCase;

  beforeEach(() => {
    repo = new InMemoryAccountRepository();
    useCase = new UpdateAccountBalanceUseCase(repo);
  });

  it('should increase balance on inflow', async () => {
    repo.seed([
      makeAccount({ id: 'a1', userId: 'user-1', currentBalance: 100 }),
    ]);

    const result = await useCase.execute('a1', 50, 'inflow');

    expect(result.getCurrentBalance().getValue()).toBe(150);
  });

  it('should decrease balance on outflow', async () => {
    repo.seed([
      makeAccount({ id: 'a1', userId: 'user-1', currentBalance: 100 }),
    ]);

    const result = await useCase.execute('a1', 40, 'outflow');

    expect(result.getCurrentBalance().getValue()).toBe(60);
  });

  it('should throw InsufficientFundsException when outflow exceeds balance', async () => {
    repo.seed([
      makeAccount({ id: 'a1', userId: 'user-1', currentBalance: 30 }),
    ]);

    await expect(useCase.execute('a1', 100, 'outflow')).rejects.toThrow(
      InsufficientFundsException,
    );
  });

  it('should throw CannotOperateOnArchivedAccountException on archived account', async () => {
    repo.seed([makeAccount({ id: 'a1', userId: 'user-1', isArchived: true })]);

    await expect(useCase.execute('a1', 10, 'inflow')).rejects.toThrow(
      CannotOperateOnArchivedAccountException,
    );
  });

  it('should throw AccountNotFoundException when account is missing', async () => {
    await expect(useCase.execute('ghost', 10, 'inflow')).rejects.toThrow(
      AccountNotFoundException,
    );
  });
});
