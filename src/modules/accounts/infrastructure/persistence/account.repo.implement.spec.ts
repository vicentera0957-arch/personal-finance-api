import { Repository } from 'typeorm';
import { AccountRepositoryImpl } from './account.repo.implement';
import { AccountMapper } from './account.mapper';
import { AccountOrmEntity } from './account.orm.entity';
import { AccountInUseException } from '../../domain/exceptions/account.exceptions';
import { makeAccount } from '../../../../test-support/factories';

type OrmMock = jest.Mocked<
  Pick<Repository<AccountOrmEntity>, 'findOne' | 'find' | 'save' | 'delete'>
>;

describe('AccountRepositoryImpl', () => {
  let ormRepo: OrmMock;
  let repo: AccountRepositoryImpl;

  const buildOrm = (
    overrides: Partial<AccountOrmEntity> = {},
  ): AccountOrmEntity => {
    const orm = new AccountOrmEntity();
    orm.id = overrides.id ?? 'a1';
    orm.userId = overrides.userId ?? 'user-1';
    orm.name = overrides.name ?? 'Main';
    orm.type = overrides.type ?? 'corriente';
    orm.initialBalance = overrides.initialBalance ?? 1000;
    orm.currentBalance = overrides.currentBalance ?? 1000;
    orm.isArchived = overrides.isArchived ?? false;
    orm.createdAt = overrides.createdAt ?? new Date('2026-01-01T00:00:00Z');
    orm.updatedAt = overrides.updatedAt ?? new Date('2026-01-01T00:00:00Z');
    return orm;
  };

  beforeEach(() => {
    ormRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
    };
    repo = new AccountRepositoryImpl(
      ormRepo as unknown as Repository<AccountOrmEntity>,
      new AccountMapper(),
    );
  });

  describe('findById', () => {
    it('should return domain Account when found', async () => {
      ormRepo.findOne.mockResolvedValue(buildOrm());

      const account = await repo.findById('a1');

      expect(ormRepo.findOne).toHaveBeenCalledWith({ where: { id: 'a1' } });
      expect(account?.id).toBe('a1');
    });

    it('should return null when not found', async () => {
      ormRepo.findOne.mockResolvedValue(null);
      expect(await repo.findById('missing')).toBeNull();
    });
  });

  describe('findByUserId', () => {
    it('should map all rows to domain accounts', async () => {
      ormRepo.find.mockResolvedValue([
        buildOrm({ id: 'a1' }),
        buildOrm({ id: 'a2' }),
      ]);

      const accounts = await repo.findByUserId('user-1');

      expect(ormRepo.find).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
      expect(accounts.map((a) => a.id)).toEqual(['a1', 'a2']);
    });
  });

  describe('save', () => {
    it('should save using ormRepository', async () => {
      ormRepo.save.mockImplementation(async (orm) => orm as AccountOrmEntity);

      const saved = await repo.save(makeAccount({ id: 'a1' }));

      expect(ormRepo.save).toHaveBeenCalledTimes(1);
      expect(saved.id).toBe('a1');
    });
  });

  describe('delete', () => {
    it('should delegate to ormRepository.delete(id)', async () => {
      ormRepo.delete.mockResolvedValue({ affected: 1, raw: [] } as never);

      await repo.delete('a1');

      expect(ormRepo.delete).toHaveBeenCalledWith('a1');
    });

    it('should translate Postgres FK violation (23503) into AccountInUseException', async () => {
      ormRepo.delete.mockRejectedValue({ code: '23503' });

      await expect(repo.delete('a1')).rejects.toThrow(AccountInUseException);
    });

    // PG nuevos reportan restrict_violation (23001) para FKs ON DELETE
    // RESTRICT — descubierto en prod (mismo bug que categories).
    it('should translate restrict violation (23001) into AccountInUseException', async () => {
      ormRepo.delete.mockRejectedValue({ code: '23001' });

      await expect(repo.delete('a1')).rejects.toThrow(AccountInUseException);
    });

    it('should rethrow unrelated errors untouched', async () => {
      const err = new Error('boom');
      ormRepo.delete.mockRejectedValue(err);

      await expect(repo.delete('a1')).rejects.toThrow('boom');
    });
  });
});
