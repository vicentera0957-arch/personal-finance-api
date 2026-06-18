import { Injectable } from '@nestjs/common';
import { IBudgetUnitOfWork } from '../../domain/IBudgetUnitOfWork';
import { IBudgetsCache } from '../../domain/ports/cache/budgets-cache.port';
import { Budget } from '../../domain/budget.entity';
import { AmountLimit } from '../../domain/amountlimit.vo';
import {
  BudgetNotFoundException,
  BudgetLimitBelowSpentException,
} from '../../domain/exceptions/budget.exceptions';
import { ResourceOwnershipException } from '../../../../shared/domain/exceptions/resource-ownership.exception';

interface UpdateBudgetLimitCommand {
  id: string;
  limit: number;
  requestUserId: string;
}

@Injectable()
export class UpdateBudgetLimitUseCase {
  constructor(
    private readonly uow: IBudgetUnitOfWork,
    private readonly cache: IBudgetsCache,
  ) {}

  async execute(command: UpdateBudgetLimitCommand): Promise<Budget> {
    // Open the transaction: grabs a dedicated connection (QueryRunner) for this request.
    await this.uow.begin();
    try {
      const budgetRepo = this.uow.getScopedBudgetRepository();

      // LOCK (FOR UPDATE): budget row. The lock lives inside the scoped repo's findById().
      // It is the serialization gate for the period invariant: holding it blocks concurrent
      // expense creates until this limit change commits (closes the B4 write-skew).
      const budget = await budgetRepo.findById(command.id);
      if (!budget) throw new BudgetNotFoundException(command.id);
      if (budget.userId !== command.requestUserId)
        throw new ResourceOwnershipException(command.id);

      const limit = AmountLimit.create(command.limit);
      // NO LOCK: aggregate read (Postgres forbids FOR UPDATE on SUM). Consistent only
      // because the budget row above is locked, which serializes concurrent expense creates.
      const spentInPeriod = await this.uow
        .getScopedExpenseChecker()
        .sumExpenseAmountInPeriod(
          budget.userId,
          budget.categoryId,
          budget.month,
          budget.year,
        );

      if (limit.getValue() < spentInPeriod) {
        throw new BudgetLimitBelowSpentException(
          budget.id,
          budget.month,
          budget.year,
          limit.getValue(),
          spentInPeriod,
        );
      }
      budget.updateLimit(limit);

      const updated = await budgetRepo.save(budget);
      await this.uow.commit();

      await Promise.all([
        this.cache.invalidateUser(updated.userId),
        this.cache.invalidateById(updated.id),
      ]);
      return updated;
    } catch (error) {
      await this.uow.rollback();
      throw error;
    } finally {
      await this.uow.release();
    }
  }
}
