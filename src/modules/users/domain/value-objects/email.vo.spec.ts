import { Email } from './email.vo';
import {
  EmptyEmailException,
  InvalidEmailFormatException,
} from '../exceptions/user.exceptions';

describe('Email', () => {
  describe('create', () => {
    it('should create a valid email', () => {
      const email = Email.create('user@example.com');
      expect(email.getValue()).toBe('user@example.com');
    });

    it('should normalize email to lowercase', () => {
      const email = Email.create('USER@EXAMPLE.COM');
      expect(email.getValue()).toBe('user@example.com');

      const mixedCase = Email.create('User.Name@Domain.CO');
      expect(mixedCase.getValue()).toBe('user.name@domain.co');
    });

    it('should trim whitespace', () => {
      const email = Email.create('  user@example.com  ');
      expect(email.getValue()).toBe('user@example.com');

      const leadingSpace = Email.create('  user@domain.com');
      expect(leadingSpace.getValue()).toBe('user@domain.com');

      const trailingSpace = Email.create('user@domain.com  ');
      expect(trailingSpace.getValue()).toBe('user@domain.com');
    });

    it('should throw EmptyEmailException if email is empty string', () => {
      expect(() => Email.create('')).toThrow(EmptyEmailException);
    });

    it('should throw EmptyEmailException if email is only whitespace', () => {
      expect(() => Email.create('   ')).toThrow(EmptyEmailException);
      expect(() => Email.create('\t')).toThrow(EmptyEmailException);
      expect(() => Email.create('\n')).toThrow(EmptyEmailException);
    });

    it('should throw EmptyEmailException if email is null or undefined', () => {
      expect(() => Email.create(null as unknown as string)).toThrow(
        EmptyEmailException,
      );
      expect(() => Email.create(undefined as unknown as string)).toThrow(
        EmptyEmailException,
      );
    });

    it('should throw InvalidEmailFormatException for invalid format', () => {
      expect(() => Email.create('notanemail')).toThrow(
        InvalidEmailFormatException,
      );

      expect(() => Email.create('user@')).toThrow(InvalidEmailFormatException);

      expect(() => Email.create('@example.com')).toThrow(
        InvalidEmailFormatException,
      );

      expect(() => Email.create('user@example')).toThrow(
        InvalidEmailFormatException,
      );

      expect(() => Email.create('user @example.com')).toThrow(
        InvalidEmailFormatException,
      );

      expect(() => Email.create('user@exam ple.com')).toThrow(
        InvalidEmailFormatException,
      );
    });

    it('should accept valid email formats', () => {
      const validEmails = [
        'john@gmail.com',
        'user.name@example.org',
        'first+tag@domain.co.uk',
        'a@b.c',
        'test123@test-domain.info',
      ];

      validEmails.forEach((validEmail) => {
        expect(() => Email.create(validEmail)).not.toThrow();
        expect(Email.create(validEmail).getValue()).toBeTruthy();
      });
    });

    it('should validate format AFTER trimming and before storing', () => {
      // This confirms: empty check -> trim -> format check -> store (lowercased + trimmed)
      const email = Email.create('  USER@EXAMPLE.COM  ');
      expect(email.getValue()).toBe('user@example.com');
    });

    it('should check empty BEFORE checking format', () => {
      // Empty string throws EmptyEmailException, not InvalidEmailFormatException
      expect(() => Email.create('')).toThrow(EmptyEmailException);
      expect(() => Email.create('   ')).toThrow(EmptyEmailException);

      // Invalid format (not empty) throws InvalidEmailFormatException
      expect(() => Email.create('notanemail')).toThrow(
        InvalidEmailFormatException,
      );
    });
  });

  describe('getValue', () => {
    it('should return the normalized email value', () => {
      const email = Email.create('USER@EXAMPLE.COM');
      expect(email.getValue()).toBe('user@example.com');
    });

    it('should return trimmed and lowercased email', () => {
      const email = Email.create('  John.Doe@GMAIL.COM  ');
      expect(email.getValue()).toBe('john.doe@gmail.com');
    });
  });

  describe('getDomain', () => {
    it('should extract domain from email', () => {
      const email = Email.create('user@example.com');
      expect(email.getDomain()).toBe('example.com');
    });

    it('should extract domain correctly for various email formats', () => {
      expect(Email.create('john@gmail.com').getDomain()).toBe('gmail.com');
      expect(Email.create('user.name@company.co.uk').getDomain()).toBe(
        'company.co.uk',
      );
      expect(Email.create('test+tag@domain.org').getDomain()).toBe(
        'domain.org',
      );
    });

    it('should extract domain from normalized email', () => {
      const email = Email.create('  USER@EXAMPLE.COM  ');
      expect(email.getDomain()).toBe('example.com');
    });

    it('should work with subdomains', () => {
      const email = Email.create('user@mail.example.co.uk');
      expect(email.getDomain()).toBe('mail.example.co.uk');
    });
  });

  describe('equals', () => {
    it('should return true when emails are identical', () => {
      const email1 = Email.create('user@example.com');
      const email2 = Email.create('user@example.com');

      expect(email1.equals(email2)).toBe(true);
    });

    it('should return true when emails are same but with different input cases', () => {
      const email1 = Email.create('USER@EXAMPLE.COM');
      const email2 = Email.create('user@example.com');

      expect(email1.equals(email2)).toBe(true);
    });

    it('should return true when emails are same but with whitespace differences in input', () => {
      const email1 = Email.create('  user@example.com  ');
      const email2 = Email.create('user@example.com');

      expect(email1.equals(email2)).toBe(true);
    });

    it('should return false when emails are different', () => {
      const email1 = Email.create('user1@example.com');
      const email2 = Email.create('user2@example.com');

      expect(email1.equals(email2)).toBe(false);
    });

    it('should return false for different domains', () => {
      const email1 = Email.create('user@example.com');
      const email2 = Email.create('user@example.org');

      expect(email1.equals(email2)).toBe(false);
    });

    it('should be case-insensitive after normalization', () => {
      const email1 = Email.create('John@Gmail.Com');
      const email2 = Email.create('john@gmail.com');

      expect(email1.equals(email2)).toBe(true);
    });
  });

  describe('email format regex', () => {
    it('should require at least one character before @', () => {
      expect(() => Email.create('@example.com')).toThrow(
        InvalidEmailFormatException,
      );
    });

    it('should require at least one character after @ and before .', () => {
      expect(() => Email.create('user@.com')).toThrow(
        InvalidEmailFormatException,
      );
    });

    it('should require at least one character after the last .', () => {
      expect(() => Email.create('user@example.')).toThrow(
        InvalidEmailFormatException,
      );
    });

    it('should not allow spaces', () => {
      expect(() => Email.create('user name@example.com')).toThrow(
        InvalidEmailFormatException,
      );
      expect(() => Email.create('user@exam ple.com')).toThrow(
        InvalidEmailFormatException,
      );
    });

    it('should allow dots in local part', () => {
      expect(() => Email.create('user.name@example.com')).not.toThrow();
      expect(() => Email.create('first.last.name@example.com')).not.toThrow();
    });

    it('should allow plus signs in local part', () => {
      expect(() => Email.create('user+tag@example.com')).not.toThrow();
    });

    it('should allow hyphens in domain', () => {
      expect(() => Email.create('user@my-domain.com')).not.toThrow();
    });

    it('should allow multiple dots in domain', () => {
      expect(() => Email.create('user@mail.example.co.uk')).not.toThrow();
    });
  });

  describe('lifecycle', () => {
    it('should maintain immutability after creation', () => {
      const email = Email.create('user@example.com');

      // Verify no setters exist
      expect((email as Record<string, unknown>).setValue).toBeUndefined();
      expect((email as Record<string, unknown>).changeDomain).toBeUndefined();

      // Value should remain constant
      expect(email.getValue()).toBe('user@example.com');
      expect(email.getDomain()).toBe('example.com');
    });

    it('should support comparison operations', () => {
      const email1 = Email.create('user@example.com');
      const email2 = Email.create('user@example.com');
      const email3 = Email.create('other@example.com');

      expect(email1.equals(email2)).toBe(true);
      expect(email1.equals(email3)).toBe(false);
    });
  });
});
