import { AccountType } from './type.vo';
import {
  InvalidAccountTypeException,
  NoTypeProvidedException,
} from '../exceptions/account.exceptions';

describe('AccountType', () => {
  describe('create', () => {
    it('should create a valid account type', () => {
      const type = AccountType.create('ahorro');
      expect(type.getType()).toBe('ahorro');
    });

    it('should normalize input to lowercase', () => {
      const type = AccountType.create('AHORRO');
      expect(type.getType()).toBe('ahorro');

      const type2 = AccountType.create('Corriente');
      expect(type2.getType()).toBe('corriente');
    });

    it('should trim whitespace before validating', () => {
      const type = AccountType.create('  ahorro  ');
      expect(type.getType()).toBe('ahorro');

      const type2 = AccountType.create('  VISTA  ');
      expect(type2.getType()).toBe('vista');
    });

    it('should throw NoTypeProvidedException if tipo is empty string', () => {
      expect(() => AccountType.create('')).toThrow(NoTypeProvidedException);
    });

    it('should throw NoTypeProvidedException if tipo is only whitespace', () => {
      expect(() => AccountType.create('   ')).toThrow(NoTypeProvidedException);
      expect(() => AccountType.create('\t')).toThrow(NoTypeProvidedException);
    });

    it('should throw InvalidAccountTypeException for invalid type after normalization', () => {
      expect(() => AccountType.create('invalido')).toThrow(
        InvalidAccountTypeException,
      );
      expect(() => AccountType.create('INVALID')).toThrow(
        InvalidAccountTypeException,
      );
    });

    it('should accept all valid account types', () => {
      const validTypes = ['ahorro', 'corriente', 'vista', 'ruta', 'otros'];

      validTypes.forEach((tipo) => {
        const accountType = AccountType.create(tipo);
        expect(accountType.getType()).toBe(tipo);
      });
    });
  });

  describe('reconstitute', () => {
    it('should reconstitute a valid account type from database', () => {
      const type = AccountType.reconstitute('ahorro');
      expect(type.getType()).toBe('ahorro');
    });

    it('should throw InvalidAccountTypeException if type is invalid in reconstitute', () => {
      // Note: reconstitute does NOT normalize - it expects the type as stored in DB
      expect(() => AccountType.reconstitute('invalido')).toThrow(
        InvalidAccountTypeException,
      );
    });

    it('should throw InvalidAccountTypeException for uppercase in reconstitute (no normalization)', () => {
      // Unlike create(), reconstitute() does not normalize - it validates as-is
      expect(() => AccountType.reconstitute('AHORRO')).toThrow(
        InvalidAccountTypeException,
      );
    });

    it('should accept all stored valid types in reconstitute', () => {
      const validTypes = ['ahorro', 'corriente', 'vista', 'ruta', 'otros'];

      validTypes.forEach((tipo) => {
        const accountType = AccountType.reconstitute(tipo);
        expect(accountType.getType()).toBe(tipo);
      });
    });
  });

  describe('equals', () => {
    it('should return true when account types are equal', () => {
      const type1 = AccountType.create('ahorro');
      const type2 = AccountType.create('AHORRO');

      expect(type1.equals(type2)).toBe(true);
    });

    it('should return false when account types are different', () => {
      const type1 = AccountType.create('ahorro');
      const type2 = AccountType.create('corriente');

      expect(type1.equals(type2)).toBe(false);
    });
  });

  describe('getType', () => {
    it('should return the normalized type', () => {
      const type = AccountType.create('AHORRO');
      expect(type.getType()).toBe('ahorro');
    });

    it('should return the stored type', () => {
      const type = AccountType.reconstitute('vista');
      expect(type.getType()).toBe('vista');
    });
  });
});
