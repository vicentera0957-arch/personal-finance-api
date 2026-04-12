import { GetTransactionByIdUseCase } from './get-transaction-by-id.use-case';
import { InMemoryTransactionRepository } from '../../infrastructure/persistence/__fakes__/in-memory-transaction.repository';
import { TransactionNotFoundException } from '../../domain/exceptions/transaction.exceptions';
import { ResourceOwnershipException } from '../../../../shared/domain/exceptions/resource-ownership.exception';
import { makeTransaction } from '../../../../test-support/factories';

describe('GetTransactionByIdUseCase', () => {
  let repo: InMemoryTransactionRepository;
  let useCase: GetTransactionByIdUseCase;

  beforeEach(() => {
    repo = new InMemoryTransactionRepository();
    useCase = new GetTransactionByIdUseCase(repo);
  });

  it('should return the transaction when owned by requester', async () => {
    repo.seed([makeTransaction({ id: 't1', userId: 'user-1' })]);

    const result = await useCase.execute('t1', 'user-1');

    expect(result.id).toBe('t1');
  });

  it('should throw TransactionNotFoundException when missing', async () => {
    await expect(useCase.execute('ghost', 'user-1')).rejects.toThrow(
      TransactionNotFoundException,
    );
  });

  it('should throw ResourceOwnershipException when owned by another user', async () => {
    repo.seed([makeTransaction({ id: 't1', userId: 'user-1' })]);

    await expect(useCase.execute('t1', 'user-2')).rejects.toThrow(
      ResourceOwnershipException,
    );
  });
});
