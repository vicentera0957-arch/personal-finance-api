import { Injectable, Logger } from '@nestjs/common';
import { IBudgetUnitOfWork } from '../../domain/IBudgetUnitOfWork';
import { IBudgetsCache } from '../../domain/ports/cache/budgets-cache.port';
import {
  BudgetNotFoundException,
  BudgetHasTransactionsInPeriodException,
} from '../../domain/exceptions/budget.exceptions';
import { ResourceOwnershipException } from '../../../../shared/domain/exceptions/resource-ownership.exception';

@Injectable()
export class DeleteBudgetUseCase {
  private readonly logger = new Logger(DeleteBudgetUseCase.name);

  constructor(
    private readonly uow: IBudgetUnitOfWork,
    private readonly cache: IBudgetsCache,
  ) {}

  async execute(id: string, requestUserId: string): Promise<void> {
    // Todo lo transaccional adentro. El commit lo hace el runner al salir sin excepción.
    const ownerId = await this.uow.run(async (ctx) => {
      // LOCK (FOR UPDATE): budget row. The lock lives inside the scoped repo's findById().
      // It is the serialization gate for the period invariant: holding it blocks concurrent
      // expense creates until this deletion commits (closes Race 1).
      const budget = await ctx.budgets.findById(id);
      if (!budget) throw new BudgetNotFoundException(id);
      if (budget.userId !== requestUserId)
        throw new ResourceOwnershipException(id);

      // NO LOCK: aggregate read (Postgres forbids FOR UPDATE on COUNT). Consistent only
      // because the budget row above is locked, which serializes concurrent expense creates.
      const hasExpenses = await ctx.expenses.hasExpensesInPeriod(
        budget.userId,
        budget.categoryId,
        budget.month,
        budget.year,
      );

      if (hasExpenses) {
        throw new BudgetHasTransactionsInPeriodException(
          id,
          budget.month,
          budget.year,
        );
      }

      await ctx.budgets.delete(id);
      return budget.userId;
    });

    // POST-COMMIT por construcción: fuera de run() no hay ningún alcance de rollback.
    // La invalidación de caché es una reacción secundaria y va en su PROPIO try/catch:
    // si lanzara acá no hay ningún rollback que la capture y convierta un borrado
    // exitoso en un 500. La caché stale es tolerable (TTL 600 s, budgets-cache.impl.ts:8)
    // y no participa de ningún invariante.
    try {
      await Promise.all([
        this.cache.invalidateUser(ownerId),
        this.cache.invalidateById(id),
      ]);
    } catch (cacheError) {
      this.logger.warn(
        `Budget ${id} borrado y commiteado, pero falló la invalidación de caché ` +
          `(user ${ownerId}). Las lecturas pueden quedar stale hasta el TTL. ` +
          `Causa: ${(cacheError as Error).message}`,
      );
    }
  }
}
