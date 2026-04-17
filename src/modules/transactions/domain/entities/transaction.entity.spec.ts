import { Transaction } from './transaction.entity';
import { TransactionNature } from '../value-objects/transaction-nature.vo';
import { Amount } from '../value-objects/amount.vo';

describe('Transaction Entity', () => {
  const mockProps = {
    id: 'tx-123',
    userId: 'user-456',
    accountId: 'account-789',
    categoryId: 'category-101',
    nature: TransactionNature.create('expense'),
    amount: Amount.create(50000),
    description: 'Groceries',
    transactionDate: new Date('2026-04-10'),
  };

  describe('create()', () => {
    it('debe crear una transacción con todos los campos asignados correctamente', () => {
      const tx = Transaction.create(mockProps);

      expect(tx.id).toBe(mockProps.id);
      expect(tx.userId).toBe(mockProps.userId);
      expect(tx.accountId).toBe(mockProps.accountId);
      expect(tx.categoryId).toBe(mockProps.categoryId);
      expect(tx.nature).toBe(mockProps.nature);
      expect(tx.amount).toBe(mockProps.amount);
      expect(tx.description).toBe(mockProps.description);
      expect(tx.transactionDate).toEqual(mockProps.transactionDate);
    });

    it('debe generar createdAt automáticamente cercano a Date.now()', () => {
      const beforeCreate = Date.now();
      const tx = Transaction.create(mockProps);
      const afterCreate = Date.now();

      expect(tx.createdAt.getTime()).toBeGreaterThanOrEqual(beforeCreate);
      expect(tx.createdAt.getTime()).toBeLessThanOrEqual(afterCreate);
    });

    it('debe asignar null a description cuando no se provee', () => {
      const { description, ...propsWithoutDescription } = mockProps;

      const tx = Transaction.create(propsWithoutDescription);

      expect(tx.description).toBeNull();
    });

    it('debe asignar la description cuando se provee', () => {
      const tx = Transaction.create(mockProps);

      expect(tx.description).toBe('Groceries');
    });
  });

  describe('reconstitute()', () => {
    const originalCreatedAt = new Date('2026-03-15');

    const reconstructProps = {
      ...mockProps,
      createdAt: originalCreatedAt,
    };

    it('debe reconstruir una transacción con todos los campos asignados correctamente', () => {
      const tx = Transaction.reconstitute(reconstructProps);

      expect(tx.id).toBe(reconstructProps.id);
      expect(tx.userId).toBe(reconstructProps.userId);
      expect(tx.accountId).toBe(reconstructProps.accountId);
      expect(tx.categoryId).toBe(reconstructProps.categoryId);
      expect(tx.nature).toBe(reconstructProps.nature);
      expect(tx.amount).toBe(reconstructProps.amount);
      expect(tx.description).toBe(reconstructProps.description);
      expect(tx.transactionDate).toEqual(reconstructProps.transactionDate);
    });

    it('debe preservar el createdAt original (no generar uno nuevo)', () => {
      const tx = Transaction.reconstitute(reconstructProps);

      expect(tx.createdAt).toEqual(originalCreatedAt);
    });

    it('debe asignar null a description cuando no se provee', () => {
      const { description, ...propsWithoutDescription } = reconstructProps;

      const tx = Transaction.reconstitute(propsWithoutDescription);

      expect(tx.description).toBeNull();
    });

    it('debe asignar la description cuando se provee', () => {
      const tx = Transaction.reconstitute(reconstructProps);

      expect(tx.description).toBe('Groceries');
    });
  });
});
