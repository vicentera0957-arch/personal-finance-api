import { GetTransactionsByUserIdUseCase } from './get-transactions-by-user-id.use-case';
import { InMemoryTransactionRepository } from '../../infrastructure/persistence/__fakes__/in-memory-transaction.repository';
import { makeTransaction } from '../../../../test-support/factories';

describe('GetTransactionsByUserIdUseCase', () => {
  let repo: InMemoryTransactionRepository;
  let useCase: GetTransactionsByUserIdUseCase;

  beforeEach(() => {
    repo = new InMemoryTransactionRepository();
    useCase = new GetTransactionsByUserIdUseCase(repo);
  });

  it('should return only transactions of the user', async () => {
    repo.seed([
      makeTransaction({ id: 't1', userId: 'user-1' }),
      makeTransaction({ id: 't2', userId: 'user-1' }),
      makeTransaction({ id: 't3', userId: 'user-2' }),
    ]);

    const result = await useCase.execute('user-1');

    expect(result.map((t) => t.id).sort()).toEqual(['t1', 't2']);
  });

  it('should filter by date range', async () => {
    repo.seed([
      makeTransaction({
        id: 't1',
        userId: 'user-1',
        transactionDate: new Date('2026-01-10'),
      }),
      makeTransaction({
        id: 't2',
        userId: 'user-1',
        transactionDate: new Date('2026-02-15'),
      }),
      makeTransaction({
        id: 't3',
        userId: 'user-1',
        transactionDate: new Date('2026-03-20'),
      }),
    ]);

    const result = await useCase.execute('user-1', {
      from: new Date('2026-02-01'),
      to: new Date('2026-02-28'),
    });

    expect(result.map((t) => t.id)).toEqual(['t2']);
  });

  it('should return empty array when user has no transactions', async () => {
    const result = await useCase.execute('ghost');

    expect(result).toEqual([]);
  });
});
