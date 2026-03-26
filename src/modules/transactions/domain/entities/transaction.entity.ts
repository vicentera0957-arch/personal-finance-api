import { TransactionNature } from '../value-objects/transaction-nature.vo';
import { Amount } from '../value-objects/amount.vo';

// Props para crear una transacción nueva — sin createdAt, lo genera la entidad.
interface CreateTransactionProps {
  id: string;
  userId: string;
  accountId: string;
  categoryId: string;
  nature: TransactionNature;
  amount: Amount;
  description?: string;
  transactionDate: Date;
}

// Props para reconstituir desde persistencia — incluye createdAt.
interface ReconstituteTransactionProps extends CreateTransactionProps {
  createdAt: Date;
}

// Las transacciones son registros contables inmutables — no tienen métodos de mutación.
// Para "editarlas" se elimina y se crea una nueva (V1). Ver notas.md.
export class Transaction {
  private constructor(
    public readonly id: string,
    public readonly userId: string,
    public readonly accountId: string,
    public readonly categoryId: string,
    public readonly nature: TransactionNature,
    public readonly amount: Amount,
    public readonly description: string | null,
    public readonly transactionDate: Date,
    public readonly createdAt: Date,
  ) {}

  static create(props: CreateTransactionProps): Transaction {
    return new Transaction(
      props.id,
      props.userId,
      props.accountId,
      props.categoryId,
      props.nature,
      props.amount,
      props.description ?? null,
      props.transactionDate,
      new Date(),
    );
  }

  static reconstitute(props: ReconstituteTransactionProps): Transaction {
    return new Transaction(
      props.id,
      props.userId,
      props.accountId,
      props.categoryId,
      props.nature,
      props.amount,
      props.description ?? null,
      props.transactionDate,
      props.createdAt,
    );
  }
}
