import { DeleteTransactionUseCase } from './delete-transaction.use-case';
import { GetTransactionByIdUseCase } from './get-transaction-by-id.use-case';

import { InMemoryTransactionRepository } from '../../infrastructure/persistence/__fakes__/in-memory-transaction.repository';
import { InMemoryAccountRepository } from '../../../accounts/infrastructure/persistence/__fakes__/in-memory-account.repository';
import { InMemoryUnitOfWork } from '../../infrastructure/persistence/__fakes__/in-memory-unit-of-work';

import { CannotDeleteTransactionException } from '../../domain/exceptions/transaction.exceptions';
import { TransactionNotFoundException } from '../../domain/exceptions/transaction.exceptions';

import {
  makeAccount,
  makeTransaction,
} from '../../../../test-support/factories';

describe('DeleteTransactionUseCase', () => {
  let txRepo: InMemoryTransactionRepository;
  let accountRepo: InMemoryAccountRepository;
  let uow: InMemoryUnitOfWork;
  let useCase: DeleteTransactionUseCase;

  beforeEach(() => {
    txRepo = new InMemoryTransactionRepository();
    accountRepo = new InMemoryAccountRepository();
    uow = new InMemoryUnitOfWork(txRepo, accountRepo);

    useCase = new DeleteTransactionUseCase(
      uow,
      new GetTransactionByIdUseCase(txRepo),
    );
  });

  it('should delete an expense transaction and restore the account balance', async () => {
    accountRepo.seed([
      makeAccount({
        id: 'a1',
        userId: 'user-1',
        initialBalance: 1000,
        currentBalance: 900,
      }),
    ]);
    txRepo.seed([
      makeTransaction({
        id: 't1',
        userId: 'user-1',
        accountId: 'a1',
        nature: 'expense',
        amount: 100,
      }),
    ]);

    await useCase.execute('t1', 'user-1');

    expect(txRepo.size()).toBe(0);
    const account = await accountRepo.findById('a1');
    expect(account?.getCurrentBalance().getValue()).toBe(1000);
    expect(uow.commits()).toBe(1);
  });

  it('should delete an income transaction and decrease the account balance', async () => {
    accountRepo.seed([
      makeAccount({
        id: 'a1',
        userId: 'user-1',
        initialBalance: 0,
        currentBalance: 500,
      }),
    ]);
    txRepo.seed([
      makeTransaction({
        id: 't1',
        userId: 'user-1',
        accountId: 'a1',
        nature: 'income',
        amount: 200,
      }),
    ]);

    await useCase.execute('t1', 'user-1');

    const account = await accountRepo.findById('a1');
    expect(account?.getCurrentBalance().getValue()).toBe(300);
  });

  it('should throw CannotDeleteTransactionException when reversal would overdraw the account', async () => {
    accountRepo.seed([
      makeAccount({
        id: 'a1',
        userId: 'user-1',
        initialBalance: 0,
        currentBalance: 50,
      }),
    ]);
    txRepo.seed([
      makeTransaction({
        id: 't1',
        userId: 'user-1',
        accountId: 'a1',
        nature: 'income',
        amount: 200,
      }),
    ]);

    await expect(useCase.execute('t1', 'user-1')).rejects.toThrow(
      CannotDeleteTransactionException,
    );

    expect(txRepo.size()).toBe(1);
    expect(uow.rollbacks()).toBe(1);
  });

  it('should throw TransactionNotFoundException when the transaction is missing', async () => {
    await expect(useCase.execute('ghost', 'user-1')).rejects.toThrow(
      TransactionNotFoundException,
    );
  });
});
