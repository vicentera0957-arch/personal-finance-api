import { Repository } from 'typeorm';
import { UserRepositoryImpl } from './user.repo.implement';
import { UserMapper } from './user.mapper';
import { UserOrmEntity } from './user.orm.entity';
import { makeUser } from '../../../../test-support/factories';

type OrmMock = jest.Mocked<Pick<Repository<UserOrmEntity>, 'findOne' | 'save' | 'delete'>>;

describe('UserRepositoryImpl', () => {
  let ormRepo: OrmMock;
  let mapper: UserMapper;
  let repo: UserRepositoryImpl;

  beforeEach(() => {
    ormRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
    };
    mapper = new UserMapper();
    repo = new UserRepositoryImpl(ormRepo as unknown as Repository<UserOrmEntity>, mapper);
  });

  const buildOrm = (): UserOrmEntity => {
    const orm = new UserOrmEntity();
    orm.id = 'user-1';
    orm.email = 'a@b.cl';
    orm.passwordHash = 'h';
    orm.name = 'Alice';
    orm.createdAt = new Date('2026-01-01T00:00:00Z');
    orm.updatedAt = new Date('2026-01-01T00:00:00Z');
    return orm;
  };

  describe('findById', () => {
    it('should return a domain User when found and call findOne with id', async () => {
      ormRepo.findOne.mockResolvedValue(buildOrm());

      const user = await repo.findById('user-1');

      expect(ormRepo.findOne).toHaveBeenCalledWith({ where: { id: 'user-1' } });
      expect(user?.id).toBe('user-1');
      expect(user?.email.getValue()).toBe('a@b.cl');
    });

    it('should return null when not found', async () => {
      ormRepo.findOne.mockResolvedValue(null);

      const user = await repo.findById('missing');

      expect(user).toBeNull();
    });
  });

  describe('findByEmail', () => {
    it('should query findOne with email filter', async () => {
      ormRepo.findOne.mockResolvedValue(buildOrm());

      const user = await repo.findByEmail('a@b.cl');

      expect(ormRepo.findOne).toHaveBeenCalledWith({ where: { email: 'a@b.cl' } });
      expect(user?.email.getValue()).toBe('a@b.cl');
    });

    it('should return null when not found', async () => {
      ormRepo.findOne.mockResolvedValue(null);

      expect(await repo.findByEmail('nope@b.cl')).toBeNull();
    });
  });

  describe('save', () => {
    it('should map domain to orm, persist and return reconstituted domain', async () => {
      const user = makeUser({ id: 'user-1', email: 'a@b.cl' });
      ormRepo.save.mockImplementation(async (orm) => orm as UserOrmEntity);

      const saved = await repo.save(user);

      expect(ormRepo.save).toHaveBeenCalledTimes(1);
      const savedArg = ormRepo.save.mock.calls[0][0] as UserOrmEntity;
      expect(savedArg).toBeInstanceOf(UserOrmEntity);
      expect(savedArg.email).toBe('a@b.cl');
      expect(saved.email.getValue()).toBe('a@b.cl');
    });
  });

  describe('delete', () => {
    it('should delegate to ormRepository.delete(id)', async () => {
      ormRepo.delete.mockResolvedValue({ affected: 1, raw: [] } as never);

      await repo.delete('user-1');

      expect(ormRepo.delete).toHaveBeenCalledWith('user-1');
    });
  });
});
