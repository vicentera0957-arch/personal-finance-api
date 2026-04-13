import { Between, LessThanOrEqual, MoreThanOrEqual, QueryRunner, Repository } from 'typeorm';
import { TransactionRepositoryImpl } from './transaction.repo.implement';
import { TransactionMapper } from './transaction.mapper';
import { TransactionOrmEntity } from './transaction.orm.entity';
import { makeTransaction } from '../../../../test-support/factories';

type OrmMock = jest.Mocked<
  Pick<
    Repository<TransactionOrmEntity>,
    'findOne' | 'find' | 'save' | 'delete' | 'createQueryBuilder'
  >
>;

describe('TransactionRepositoryImpl', () => {
  let ormRepo: OrmMock;
  let repo: TransactionRepositoryImpl;

  const buildOrm = (o: Partial<TransactionOrmEntity> = {}): TransactionOrmEntity => {
    const orm = new TransactionOrmEntity();
    orm.id = o.id ?? 't1';
    orm.userId = o.userId ?? 'user-1';
    orm.accountId = o.accountId ?? 'a1';
    orm.categoryId = o.categoryId ?? 'c1';
    orm.nature = o.nature ?? 'expense';
    orm.amount = o.amount ?? 100;
    orm.description = o.description ?? undefined;
    orm.transactionDate = o.transactionDate ?? new Date('2026-03-15T12:00:00Z');
    orm.createdAt = o.createdAt ?? new Date('2026-03-15T12:00:00Z');
    return orm;
  };

  beforeEach(() => {
    ormRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    repo = new TransactionRepositoryImpl(
      ormRepo as unknown as Repository<TransactionOrmEntity>,
      new TransactionMapper(),
    );
  });

  describe('findById', () => {
    it('should return domain Transaction when found', async () => {
      ormRepo.findOne.mockResolvedValue(buildOrm());

      const tx = await repo.findById('t1');

      expect(ormRepo.findOne).toHaveBeenCalledWith({ where: { id: 't1' } });
      expect(tx?.id).toBe('t1');
    });

    it('should return null when not found', async () => {
      ormRepo.findOne.mockResolvedValue(null);
      expect(await repo.findById('missing')).toBeNull();
    });
  });

  describe('findByUserId / findByAccountId', () => {
    it('should apply Between when both from and to are provided', async () => {
      ormRepo.find.mockResolvedValue([]);
      const from = new Date('2026-03-01');
      const to = new Date('2026-03-31');

      await repo.findByUserId('user-1', { from, to, limit: 10, offset: 20 });

      expect(ormRepo.find).toHaveBeenCalledWith({
        where: { userId: 'user-1', transactionDate: Between(from, to) },
        skip: 20,
        take: 10,
        order: { transactionDate: 'DESC' },
      });
    });

    it('should apply MoreThanOrEqual when only from is provided', async () => {
      ormRepo.find.mockResolvedValue([]);
      const from = new Date('2026-03-01');

      await repo.findByUserId('user-1', { from });

      expect(ormRepo.find).toHaveBeenCalledWith({
        where: { userId: 'user-1', transactionDate: MoreThanOrEqual(from) },
        skip: undefined,
        take: undefined,
        order: { transactionDate: 'DESC' },
      });
    });

    it('should apply LessThanOrEqual when only to is provided', async () => {
      ormRepo.find.mockResolvedValue([]);
      const to = new Date('2026-03-31');

      await repo.findByAccountId('a1', { to });

      expect(ormRepo.find).toHaveBeenCalledWith({
        where: { accountId: 'a1', transactionDate: LessThanOrEqual(to) },
        skip: undefined,
        take: undefined,
        order: { transactionDate: 'DESC' },
      });
    });

    it('should map all rows through the mapper', async () => {
      ormRepo.find.mockResolvedValue([buildOrm({ id: 't1' }), buildOrm({ id: 't2' })]);

      const txs = await repo.findByAccountId('a1');

      expect(txs).toHaveLength(2);
      expect(txs[0].id).toBe('t1');
    });
  });

  describe('save', () => {
    it('should use ormRepository.save when no queryRunner', async () => {
      ormRepo.save.mockImplementation(async (orm) => orm as TransactionOrmEntity);

      const saved = await repo.save(makeTransaction({ id: 't1' }));

      expect(ormRepo.save).toHaveBeenCalledTimes(1);
      expect(saved.id).toBe('t1');
    });

    it('should use queryRunner.manager.save when provided', async () => {
      const qrSave = jest.fn(async (_e, orm) => orm as TransactionOrmEntity);
      const queryRunner = { manager: { save: qrSave } } as unknown as QueryRunner;

      await repo.save(makeTransaction({ id: 't1' }), queryRunner);

      expect(qrSave).toHaveBeenCalledWith(TransactionOrmEntity, expect.any(TransactionOrmEntity));
      expect(ormRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('sumExpenseAmountByUserCategoryAndPeriod', () => {
    it('should build a query with user+category+nature+date filters and return the sum', async () => {
      const getRawOne = jest.fn().mockResolvedValue({ total: '250' });
      const setLock = jest.fn().mockReturnThis();
      const andWhere = jest.fn().mockReturnThis();
      const where = jest.fn().mockReturnThis();
      const select = jest.fn().mockReturnThis();

      const qb: any = { select, where, andWhere, setLock, getRawOne };
      ormRepo.createQueryBuilder.mockReturnValue(qb);

      const total = await repo.sumExpenseAmountByUserCategoryAndPeriod(
        'user-1',
        'c1',
        3,
        2026,
      );

      expect(ormRepo.createQueryBuilder).toHaveBeenCalledWith('transaction');
      expect(andWhere).toHaveBeenCalledWith('transaction.categoryId = :categoryId', {
        categoryId: 'c1',
      });
      expect(andWhere).toHaveBeenCalledWith('transaction.nature = :nature', {
        nature: 'expense',
      });
      expect(setLock).not.toHaveBeenCalled();
      expect(total).toBe(250);
    });

    it('should apply pessimistic_write lock when queryRunner is provided', async () => {
      const getRawOne = jest.fn().mockResolvedValue({ total: '0' });
      const setLock = jest.fn().mockReturnThis();
      const andWhere = jest.fn().mockReturnThis();
      const where = jest.fn().mockReturnThis();
      const select = jest.fn().mockReturnThis();

      const qb: any = { select, where, andWhere, setLock, getRawOne };
      const qrRepoCreateQb = jest.fn().mockReturnValue(qb);
      const qrRepo = { createQueryBuilder: qrRepoCreateQb };
      const queryRunner = {
        manager: { getRepository: jest.fn().mockReturnValue(qrRepo) },
      } as unknown as QueryRunner;

      const total = await repo.sumExpenseAmountByUserCategoryAndPeriod(
        'user-1',
        'c1',
        3,
        2026,
        queryRunner,
      );

      expect(qrRepoCreateQb).toHaveBeenCalled();
      expect(setLock).toHaveBeenCalledWith('pessimistic_write');
      expect(total).toBe(0);
    });
  });

  describe('delete', () => {
    it('should delegate to ormRepository.delete when no queryRunner', async () => {
      ormRepo.delete.mockResolvedValue({ affected: 1, raw: [] } as never);

      await repo.delete('t1');

      expect(ormRepo.delete).toHaveBeenCalledWith('t1');
    });

    it('should use queryRunner.manager.delete when provided', async () => {
      const qrDelete = jest.fn().mockResolvedValue({ affected: 1 });
      const queryRunner = {
        manager: { delete: qrDelete },
      } as unknown as QueryRunner;

      await repo.delete('t1', queryRunner);

      expect(qrDelete).toHaveBeenCalledWith(TransactionOrmEntity, 't1');
      expect(ormRepo.delete).not.toHaveBeenCalled();
    });
  });
});
