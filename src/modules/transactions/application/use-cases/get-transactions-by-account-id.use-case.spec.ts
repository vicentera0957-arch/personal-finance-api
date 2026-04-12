import { GetTransactionsByAccountIdUseCase } from './get-transactions-by-account-id.use-case';
import { GetAccountByIdUseCase } from '../../../accounts/application/use-cases/get-account-by-id.use-case';
import { InMemoryTransactionRepository } from '../../infrastructure/persistence/__fakes__/in-memory-transaction.repository';
import { InMemoryAccountRepository } from '../../../accounts/infrastructure/persistence/__fakes__/in-memory-account.repository';
import { AccountNotFoundException } from '../../../accounts/domain/exceptions/account.exceptions';
import { ResourceOwnershipException } from '../../../../shared/domain/exceptions/resource-ownership.exception';
import {
  makeAccount,
  makeTransaction,
} from '../../../../test-support/factories';

describe('GetTransactionsByAccountIdUseCase', () => {
  let txRepo: InMemoryTransactionRepository;
  let accountRepo: InMemoryAccountRepository;
  let useCase: GetTransactionsByAccountIdUseCase;

  beforeEach(() => {
    txRepo = new InMemoryTransactionRepository();
    accountRepo = new InMemoryAccountRepository();
    useCase = new GetTransactionsByAccountIdUseCase(
      txRepo,
      new GetAccountByIdUseCase(accountRepo),
    );
  });

  it('should return transactions of the account after ownership check', async () => {
    accountRepo.seed([makeAccount({ id: 'a1', userId: 'user-1' })]);
    txRepo.seed([
      makeTransaction({ id: 't1', userId: 'user-1', accountId: 'a1' }),
      makeTransaction({ id: 't2', userId: 'user-1', accountId: 'a2' }),
    ]);

    const result = await useCase.execute('a1', 'user-1');

    expect(result.map((t) => t.id)).toEqual(['t1']);
  });

  it('should throw AccountNotFoundException when account is missing', async () => {
    await expect(useCase.execute('ghost', 'user-1')).rejects.toThrow(
      AccountNotFoundException,
    );
  });

  it('should throw ResourceOwnershipException when account belongs to other user', async () => {
    accountRepo.seed([makeAccount({ id: 'a1', userId: 'user-1' })]);

    await expect(useCase.execute('a1', 'user-2')).rejects.toThrow(
      ResourceOwnershipException,
    );
  });
});
