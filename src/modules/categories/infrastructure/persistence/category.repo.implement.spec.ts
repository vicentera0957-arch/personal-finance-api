import { Repository } from 'typeorm';
import { CategoryRepositoryImpl } from './category.repo.implement';
import { CategoryMapper } from './category.mapper';
import { CategoryOrmEntity } from './category.orm.entity';
import {
  CategoryInUseException,
  DuplicateCategoryException,
} from '../../domain/exceptions/category.exceptions';
import { makeCategory } from '../../../../test-support/factories';

type OrmMock = jest.Mocked<
  Pick<Repository<CategoryOrmEntity>, 'findOne' | 'find' | 'save' | 'delete'>
>;

describe('CategoryRepositoryImpl', () => {
  let ormRepo: OrmMock;
  let repo: CategoryRepositoryImpl;

  const buildOrm = (overrides: Partial<CategoryOrmEntity> = {}): CategoryOrmEntity => {
    const orm = new CategoryOrmEntity();
    orm.id = overrides.id ?? 'c1';
    orm.userId = overrides.userId ?? 'user-1';
    orm.name = overrides.name ?? 'Food';
    orm.nature = overrides.nature ?? 'expense';
    orm.isBudgetable = overrides.isBudgetable ?? true;
    orm.color = overrides.color ?? null;
    orm.icon = overrides.icon ?? null;
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
    repo = new CategoryRepositoryImpl(
      ormRepo as unknown as Repository<CategoryOrmEntity>,
      new CategoryMapper(),
    );
  });

  describe('findById', () => {
    it('should return a domain Category when found', async () => {
      ormRepo.findOne.mockResolvedValue(buildOrm());

      const cat = await repo.findById('c1');

      expect(ormRepo.findOne).toHaveBeenCalledWith({ where: { id: 'c1' } });
      expect(cat?.id).toBe('c1');
    });

    it('should return null when not found', async () => {
      ormRepo.findOne.mockResolvedValue(null);
      expect(await repo.findById('missing')).toBeNull();
    });
  });

  describe('findByUserId', () => {
    it('should return all rows mapped to domain', async () => {
      ormRepo.find.mockResolvedValue([buildOrm({ id: 'c1' }), buildOrm({ id: 'c2' })]);

      const categories = await repo.findByUserId('user-1');

      expect(ormRepo.find).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
      expect(categories).toHaveLength(2);
    });
  });

  describe('save', () => {
    it('should persist and return domain Category', async () => {
      ormRepo.save.mockImplementation(async (orm) => orm as CategoryOrmEntity);

      const saved = await repo.save(makeCategory({ id: 'c1' }));

      expect(saved.id).toBe('c1');
    });

    it('should translate unique-constraint violation (23505) into DuplicateCategoryException', async () => {
      ormRepo.save.mockRejectedValue({ code: '23505' });

      await expect(repo.save(makeCategory({ name: 'Food', nature: 'expense' }))).rejects.toThrow(
        DuplicateCategoryException,
      );
    });

    it('should rethrow unrelated errors', async () => {
      ormRepo.save.mockRejectedValue(new Error('boom'));

      await expect(repo.save(makeCategory())).rejects.toThrow('boom');
    });
  });

  describe('delete', () => {
    it('should delegate to ormRepository.delete(id)', async () => {
      ormRepo.delete.mockResolvedValue({ affected: 1, raw: [] } as never);

      await repo.delete('c1');

      expect(ormRepo.delete).toHaveBeenCalledWith('c1');
    });

    it('should translate FK violation (23503) into CategoryInUseException', async () => {
      ormRepo.delete.mockRejectedValue({ code: '23503' });

      await expect(repo.delete('c1')).rejects.toThrow(CategoryInUseException);
    });
  });
});
