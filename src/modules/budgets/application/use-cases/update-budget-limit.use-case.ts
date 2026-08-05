import { Injectable, Logger } from '@nestjs/common';
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
  private readonly logger = new Logger(UpdateBudgetLimitUseCase.name);

  constructor(
    private readonly uow: IBudgetUnitOfWork,
    private readonly cache: IBudgetsCache,
  ) {}

  async execute(command: UpdateBudgetLimitCommand): Promise<Budget> {
    // Todo lo transaccional adentro. El commit lo hace el runner al salir sin excepción.
    const updated = await this.uow.run(async (ctx) => {
      // LOCK (FOR UPDATE): budget row. The lock lives inside the scoped repo's findByIdWithLock().
      // It is the serialization gate for the period invariant: holding it blocks concurrent
      // expense creates until this limit change commits (closes the B4 write-skew).
      const budget = await ctx.budgets.findByIdWithLock(command.id);
      if (!budget) throw new BudgetNotFoundException(command.id);
      if (budget.userId !== command.requestUserId)
        throw new ResourceOwnershipException(command.id);

      const limit = AmountLimit.create(command.limit);
      // NO LOCK: aggregate read (Postgres forbids FOR UPDATE on SUM). Consistent only
      // because the budget row above is locked, which serializes concurrent expense creates.
      const spentInPeriod = await ctx.expenses.sumExpenseAmountInPeriod(
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

      const saved = await ctx.budgets.save(budget);
      return saved;
    });

    // POST-COMMIT: ver el comentario equivalente en delete-budget.use-case.ts.
    // Fuera de run() no hay ningún alcance de rollback que un fallo de Redis dispare.
    try {
      await Promise.all([
        this.cache.invalidateUser(updated.userId),
        this.cache.invalidateById(updated.id),
      ]);
    } catch (cacheError) {
      this.logger.warn(
        `Budget ${updated.id} actualizado y commiteado, pero falló la invalidación ` +
          `de caché (user ${updated.userId}). Las lecturas pueden quedar stale hasta ` +
          `el TTL. Causa: ${(cacheError as Error).message}`,
      );
    }
    return updated;
  }
}
