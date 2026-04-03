import { Injectable } from '@nestjs/common';
import { Budget } from '../../domain/budget.entity';
import { AmountLimit } from '../../domain/amountlimit.vo';
import { BudgetOrmEntity } from './budget.orm.entity';

@Injectable()
export class BudgetMapper {
  toDomain(orm: BudgetOrmEntity): Budget {
    const limit = AmountLimit.reconstitute(orm.limit);

    return Budget.reconstitute({
      id: orm.id,
      userId: orm.userId,
      categoryId: orm.categoryId,
      month: orm.month,
      year: orm.year,
      limit,
      createdAt: orm.createdAt,
      updatedAt: orm.updatedAt,
    });
  }

  toOrm(domain: Budget): BudgetOrmEntity {
    const orm = new BudgetOrmEntity();
    orm.id = domain.id;
    orm.userId = domain.userId;
    orm.categoryId = domain.categoryId;
    orm.month = domain.month;
    orm.year = domain.year;
    orm.limit = domain.getLimit().getValue();
    orm.createdAt = domain.createdAt;
    orm.updatedAt = domain.getUpdatedAt();
    return orm;
  }
}
