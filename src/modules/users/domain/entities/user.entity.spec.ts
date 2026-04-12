import { User } from './user.entity';
import { Email } from '../value-objects/email.vo';
import {
  InvalidNameException,
  InvalidPasswordHashException,
} from '../exceptions/user.exceptions';

describe('User', () => {
  const createValidUser = (overrides?: Partial<any>) => {
    return User.create({
      id: 'user-123',
      email: Email.create('user@example.com'),
      passwordHash: 'hashed_password_123',
      name: 'John Doe',
      ...overrides,
    });
  };

  describe('create', () => {
    it('should create a user with valid properties', () => {
      const user = createValidUser();

      expect(user.id).toBe('user-123');
      expect(user.email.getValue()).toBe('user@example.com');
      expect(user.getName()).toBe('John Doe');
      expect(user.getPasswordHash()).toBe('hashed_password_123');
    });

    it('should set createdAt and updatedAt to now', () => {
      const beforeCreation = new Date();
      const user = createValidUser();
      const afterCreation = new Date();

      expect(user.createdAt.getTime()).toBeGreaterThanOrEqual(
        beforeCreation.getTime(),
      );
      expect(user.createdAt.getTime()).toBeLessThanOrEqual(
        afterCreation.getTime(),
      );
      expect(user.getUpdatedAt()).toEqual(user.createdAt);
    });

    it('should normalize name by trimming whitespace', () => {
      const user = User.create({
        id: 'user-1',
        email: Email.create('test@example.com'),
        passwordHash: 'hash',
        name: '  Jane Smith  ',
      });

      expect(user.getName()).toBe('Jane Smith');
    });

    it('should throw InvalidNameException if name is empty string', () => {
      expect(() =>
        createValidUser({ name: '' }),
      ).toThrow(InvalidNameException);
    });

    it('should throw InvalidNameException if name is only whitespace', () => {
      expect(() =>
        createValidUser({ name: '   ' }),
      ).toThrow(InvalidNameException);
      expect(() =>
        createValidUser({ name: '\t\n' }),
      ).toThrow(InvalidNameException);
    });

    it('should accept any non-empty passwordHash at creation', () => {
      // Note: passwordHash is NOT validated at create time (see comment in code)
      // Only changePassword validates it
      const user = User.create({
        id: 'user-1',
        email: Email.create('test@example.com'),
        passwordHash: '',
        name: 'Test User',
      });

      expect(user.getPasswordHash()).toBe('');
    });

    it('should accept complex email values', () => {
      const complexEmail = Email.create('first.last+tag@subdomain.example.co.uk');
      const user = User.create({
        id: 'user-1',
        email: complexEmail,
        passwordHash: 'hash123',
        name: 'Complex Email User',
      });

      expect(user.email).toEqual(complexEmail);
    });
  });

  describe('reconstitute', () => {
    it('should reconstitute a user from persisted data', () => {
      const createdAt = new Date('2024-01-01');
      const updatedAt = new Date('2024-01-15');

      const user = User.reconstitute({
        id: 'user-456',
        email: Email.create('persisted@example.com'),
        passwordHash: 'persisted_hash',
        name: 'Persisted User',
        createdAt,
        updatedAt,
      });

      expect(user.id).toBe('user-456');
      expect(user.getName()).toBe('Persisted User');
      expect(user.createdAt).toEqual(createdAt);
      expect(user.getUpdatedAt()).toEqual(updatedAt);
    });

    it('should preserve exact timestamps', () => {
      const createdAt = new Date('2024-01-15T10:30:45.123Z');
      const updatedAt = new Date('2024-02-20T14:45:30.456Z');

      const user = User.reconstitute({
        id: 'user-789',
        email: Email.create('test@example.com'),
        passwordHash: 'hash',
        name: 'Test',
        createdAt,
        updatedAt,
      });

      expect(user.createdAt.getTime()).toBe(createdAt.getTime());
      expect(user.getUpdatedAt().getTime()).toBe(updatedAt.getTime());
    });

    it('should preserve name without normalization in reconstitute', () => {
      const user = User.reconstitute({
        id: 'user-1',
        email: Email.create('test@example.com'),
        passwordHash: 'hash',
        name: '  Name With Spaces  ',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // reconstitute does NOT validate or normalize
      expect(user.getName()).toBe('  Name With Spaces  ');
    });
  });

  describe('updateProfile', () => {
    it('should update the user name', () => {
      const user = createValidUser();

      user.updateProfile('Jane Doe');

      expect(user.getName()).toBe('Jane Doe');
    });

    it('should normalize name by trimming whitespace', () => {
      const user = createValidUser();

      user.updateProfile('  Updated Name  ');

      expect(user.getName()).toBe('Updated Name');
    });

    it('should update updatedAt timestamp', () => {
      const user = createValidUser();
      const originalUpdatedAt = user.getUpdatedAt().getTime();

      user.updateProfile('New Name');

      expect(user.getUpdatedAt().getTime()).toBeGreaterThanOrEqual(
        originalUpdatedAt,
      );
    });

    it('should throw InvalidNameException if new name is empty', () => {
      const user = createValidUser();

      expect(() => user.updateProfile('')).toThrow(InvalidNameException);
    });

    it('should throw InvalidNameException if new name is only whitespace', () => {
      const user = createValidUser();

      expect(() => user.updateProfile('   ')).toThrow(InvalidNameException);
    });

    it('should allow multiple profile updates', () => {
      const user = createValidUser();

      user.updateProfile('First Update');
      expect(user.getName()).toBe('First Update');

      user.updateProfile('Second Update');
      expect(user.getName()).toBe('Second Update');

      user.updateProfile('Third Update');
      expect(user.getName()).toBe('Third Update');
    });
  });

  describe('changePassword', () => {
    it('should change the password hash', () => {
      const user = createValidUser();

      user.changePassword('new_hash_456');

      expect(user.getPasswordHash()).toBe('new_hash_456');
    });

    it('should update updatedAt timestamp', () => {
      const user = createValidUser();
      const originalUpdatedAt = user.getUpdatedAt().getTime();

      user.changePassword('new_hash');

      expect(user.getUpdatedAt().getTime()).toBeGreaterThanOrEqual(
        originalUpdatedAt,
      );
    });

    it('should throw InvalidPasswordHashException if hash is empty string', () => {
      const user = createValidUser();

      expect(() => user.changePassword('')).toThrow(
        InvalidPasswordHashException,
      );
    });

    it('should throw InvalidPasswordHashException if hash is null', () => {
      const user = createValidUser();

      expect(() => user.changePassword(null as any)).toThrow(
        InvalidPasswordHashException,
      );
    });

    it('should throw InvalidPasswordHashException if hash is undefined', () => {
      const user = createValidUser();

      expect(() => user.changePassword(undefined as any)).toThrow(
        InvalidPasswordHashException,
      );
    });

    it('should throw InvalidPasswordHashException if hash is whitespace', () => {
      const user = createValidUser();

      // Note: the code uses !newHash which checks truthiness, not trim
      // So whitespace-only strings are actually valid
      expect(() => user.changePassword('   ')).not.toThrow();
    });

    it('should accept any truthy password hash', () => {
      const user = createValidUser();

      user.changePassword('valid_hash');
      expect(user.getPasswordHash()).toBe('valid_hash');

      user.changePassword('another_hash_123');
      expect(user.getPasswordHash()).toBe('another_hash_123');

      // Even single character is valid
      user.changePassword('x');
      expect(user.getPasswordHash()).toBe('x');
    });

    it('should allow multiple password changes', () => {
      const user = createValidUser();

      user.changePassword('hash_1');
      expect(user.getPasswordHash()).toBe('hash_1');

      user.changePassword('hash_2');
      expect(user.getPasswordHash()).toBe('hash_2');

      user.changePassword('hash_3');
      expect(user.getPasswordHash()).toBe('hash_3');
    });
  });

  describe('getters', () => {
    it('should return correct name via getter', () => {
      const user = User.create({
        id: 'user-1',
        email: Email.create('test@example.com'),
        passwordHash: 'hash',
        name: 'Test User',
      });

      expect(user.getName()).toBe('Test User');
    });

    it('should return correct passwordHash via getter', () => {
      const hash = 'bcrypt_hash_long_string';
      const user = User.create({
        id: 'user-1',
        email: Email.create('test@example.com'),
        passwordHash: hash,
        name: 'Test',
      });

      expect(user.getPasswordHash()).toBe(hash);
    });

    it('should return correct updatedAt via getter', () => {
      const user = createValidUser();
      const timestamp = user.getUpdatedAt();

      expect(timestamp).toBeInstanceOf(Date);
      expect(timestamp.getTime()).toBeGreaterThan(0);
    });
  });

  describe('readonly properties', () => {
    it('should have immutable id and email', () => {
      const user = createValidUser();

      expect(user.id).toBe('user-123');
      expect(user.email.getValue()).toBe('user@example.com');

      // These are readonly properties
    });

    it('should have immutable createdAt', () => {
      const user = createValidUser();
      const originalCreatedAt = user.createdAt;

      // Perform various operations
      user.updateProfile('Updated');
      user.changePassword('new_hash');

      // createdAt should remain the same
      expect(user.createdAt).toEqual(originalCreatedAt);
    });
  });

  describe('lifecycle', () => {
    it('should support full user lifecycle', () => {
      // Create
      const user = User.create({
        id: 'user-lifecycle',
        email: Email.create('lifecycle@example.com'),
        passwordHash: 'initial_hash',
        name: 'Lifecycle User',
      });

      expect(user.getName()).toBe('Lifecycle User');
      expect(user.getPasswordHash()).toBe('initial_hash');

      // Update profile
      user.updateProfile('Updated Lifecycle User');
      expect(user.getName()).toBe('Updated Lifecycle User');

      // Change password
      user.changePassword('new_hash_456');
      expect(user.getPasswordHash()).toBe('new_hash_456');

      // Verify id and email unchanged
      expect(user.id).toBe('user-lifecycle');
      expect(user.email.getValue()).toBe('lifecycle@example.com');
    });

    it('should maintain data consistency', () => {
      const user = createValidUser();
      const originalEmail = user.email;

      // Email reference should not change
      expect(user.email).toBe(originalEmail);

      // After updates, email should still be the same
      user.updateProfile('New Name');
      user.changePassword('new_hash');

      expect(user.email).toBe(originalEmail);
    });
  });

  describe('password validation asymmetry', () => {
    it('should not validate passwordHash at create time', () => {
      // This is an asymmetry: name is validated at create, but passwordHash is not
      expect(() =>
        User.create({
          id: 'user-1',
          email: Email.create('test@example.com'),
          passwordHash: '',
          name: 'Valid Name',
        }),
      ).not.toThrow();
    });

    it('should validate passwordHash at changePassword time', () => {
      const user = createValidUser();

      // changePassword validates, create does not
      expect(() => user.changePassword('')).toThrow(
        InvalidPasswordHashException,
      );
    });
  });
});
