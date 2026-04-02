import { AmountLimit } from './amountlimit.vo';
import {
  InvalidBudgetMonthException,
  InvalidBudgetYearException,
} from './exceptions/budget.exceptions';

interface CreateBudgetProps {
  id: string;
  userId: string;
  categoryId: string;
  month: number;
  year: number;
  limit: AmountLimit;
}

interface ReconstituteBudgetProps extends CreateBudgetProps {
  createdAt: Date;
  updatedAt: Date;
}

export class Budget {
  private constructor(
    public readonly id: string,
    public readonly userId: string,
    public readonly categoryId: string,
    public readonly month: number,
    public readonly year: number,
    private limit: AmountLimit,
    public readonly createdAt: Date,
    private updatedAt: Date,
  ) {}

  static create(props: CreateBudgetProps): Budget {
    Budget.assertValidPeriod(props.month, props.year);

    const now = new Date();
    return new Budget(
      props.id,
      props.userId,
      props.categoryId,
      props.month,
      props.year,
      props.limit,
      now,
      now,
    );
  }

  static reconstitute(props: ReconstituteBudgetProps): Budget {
    return new Budget(
      props.id,
      props.userId,
      props.categoryId,
      props.month,
      props.year,
      props.limit,
      props.createdAt,
      props.updatedAt,
    );
  }

  updateLimit(limit: AmountLimit): void {
    this.limit = limit;
    this.updatedAt = new Date();
  }

  getLimit(): AmountLimit {
    return this.limit;
  }

  getUpdatedAt(): Date {
    return this.updatedAt;
  }

  isForPeriod(month: number, year: number): boolean {
    return this.month === month && this.year === year;
  }

  private static assertValidPeriod(month: number, year: number): void {
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new InvalidBudgetMonthException(month);
    }

    if (!Number.isInteger(year) || year <= 0) {
      throw new InvalidBudgetYearException(year);
    }
  }
}
