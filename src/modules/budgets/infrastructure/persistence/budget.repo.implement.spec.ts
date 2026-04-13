import { Repository } from 'typeorm';
import { BudgetRepositoryImpl } from './budget.repo.implement';
import { BudgetMapper } from './budget.mapper';
import { BudgetOrmEntity } from './budget.orm.entity';
import { BudgetAlreadyExistsException } from '../../domain/exceptions/budget.exceptions';
import { makeBudget } from '../../../../test-support/factories';

type OrmMock = jest.Mocked<
  Pick<Repository<BudgetOrmEntity>, 'findOne' | 'find' | 'save' | 'delete'>
>;

describe('BudgetRepositoryImpl', () => {
  let ormRepo: OrmMock;
  let repo: BudgetRepositoryImpl;

  const buildOrm = (o: Partial<BudgetOrmEntity> = {}): BudgetOrmEntity => {
    const orm = new BudgetOrmEntity();
    orm.id = o.id ?? 'b1';
    orm.userId = o.userId ?? 'user-1';
    orm.categoryId = o.categoryId ?? 'c1';
    orm.month = o.month ?? 3;
    orm.year = o.year ?? 2026;
    orm.limit = o.limit ?? 500;
    orm.createdAt = new Date();
    orm.updatedAt = new Date();
    return orm;
  };

  beforeEach(() => {
    ormRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
    };
    repo = new BudgetRepositoryImpl(
      ormRepo as unknown as Repository<BudgetOrmEntity>,
      new BudgetMapper(),
    );
  });

  describe('findById', () => {
    it('should return domain Budget when found', async () => {
      ormRepo.findOne.mockResolvedValue(buildOrm());

      const budget = await repo.findById('b1');

      expect(ormRepo.findOne).toHaveBeenCalledWith({ where: { id: 'b1' } });
      expect(budget?.id).toBe('b1');
    });

    it('should return null when not found', async () => {
      ormRepo.findOne.mockResolvedValue(null);
      expect(await repo.findById('missing')).toBeNull();
    });
  });

  describe('findByUserId', () => {
    it('should query without filters when no options given', async () => {
      ormRepo.find.mockResolvedValue([buildOrm()]);

      await repo.findByUserId('user-1');

      expect(ormRepo.find).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        order: { year: 'DESC', month: 'DESC' },
      });
    });

    it('should include month + year filters in where clause when provided', async () => {
      ormRepo.find.mockResolvedValue([]);

      await repo.findByUserId('user-1', { month: 3, year: 2026 });

      expect(ormRepo.find).toHaveBeenCalledWith({
        where: { userId: 'user-1', month: 3, year: 2026 },
        order: { year: 'DESC', month: 'DESC' },
      });
    });
  });

  describe('findByUserIdAndCategoryIdAndPeriod', () => {
    it('should query by composite key', async () => {
      ormRepo.findOne.mockResolvedValue(buildOrm());

      const budget = await repo.findByUserIdAndCategoryIdAndPeriod(
        'user-1',
        'c1',
        3,
        2026,
      );

      expect(ormRepo.findOne).toHaveBeenCalledWith({
        where: { userId: 'user-1', categoryId: 'c1', month: 3, year: 2026 },
      });
      expect(budget?.id).toBe('b1');
    });
  });

  describe('save', () => {
    it('should persist and return domain Budget', async () => {
      ormRepo.save.mockImplementation(async (orm) => orm as BudgetOrmEntity);

      const saved = await repo.save(makeBudget({ id: 'b1' }));

      expect(saved.id).toBe('b1');
    });

    it('should translate unique violation (23505) into BudgetAlreadyExistsException', async () => {
      ormRepo.save.mockRejectedValue({ code: '23505' });

      await expect(repo.save(makeBudget())).rejects.toThrow(BudgetAlreadyExistsException);
    });

    it('should rethrow unrelated errors', async () => {
      ormRepo.save.mockRejectedValue(new Error('boom'));
      await expect(repo.save(makeBudget())).rejects.toThrow('boom');
    });
  });

  describe('delete', () => {
    it('should delegate to ormRepository.delete(id)', async () => {
      ormRepo.delete.mockResolvedValue({ affected: 1, raw: [] } as never);

      await repo.delete('b1');

      expect(ormRepo.delete).toHaveBeenCalledWith('b1');
    });
  });
});
