import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BudgetOrmEntity } from './infrastructure/persistence/budget.orm.entity';
import { BudgetRepositoryImpl } from './infrastructure/persistence/budget.repo.implement';
import { BudgetMapper } from './infrastructure/persistence/budget.mapper';
import { BudgetUnitOfWorkImpl } from './infrastructure/persistence/budget-unit-of-work.impl';
import { BudgetsController } from './infrastructure/http/budgets-controller/budgets.controller';
import { BudgetsCacheImpl } from './infrastructure/cache/budgets-cache.impl';
import { IBudgetRepository } from './domain/repository/budgets.repository';
import { IBudgetUnitOfWork } from './domain/IBudgetUnitOfWork';
import { IBudgetsCache } from './domain/ports/cache/budgets-cache.port';
import { CreateBudgetUseCase } from './application/use-cases/create-budget.use-case';
import { GetBudgetByIdUseCase } from './application/use-cases/get-budget-by-id.use-case';
import { GetBudgetsByUserIdUseCase } from './application/use-cases/get-budgets-by-user-id.use-case';
import { UpdateBudgetLimitUseCase } from './application/use-cases/update-budget-limit.use-case';
import { DeleteBudgetUseCase } from './application/use-cases/delete-budget.use-case';
import { GetBudgetByUserCategoryPeriodUseCase } from './application/use-cases/get-budget-by-user-category-period.use-case';
import { CategoriesModule } from '../categories/categories.module';

@Module({
  imports: [TypeOrmModule.forFeature([BudgetOrmEntity]), CategoriesModule],
  controllers: [BudgetsController],
  providers: [
    BudgetMapper,
    CreateBudgetUseCase,
    GetBudgetByIdUseCase,
    GetBudgetsByUserIdUseCase,
    GetBudgetByUserCategoryPeriodUseCase,
    UpdateBudgetLimitUseCase,
    DeleteBudgetUseCase,
    { provide: IBudgetRepository, useClass: BudgetRepositoryImpl },
    // budgets now owns its transactional boundary: UpdateBudgetLimit and
    // DeleteBudget touch only the budget aggregate (+ the aggregate expense
    // read), so there is no reason to share a QueryRunner with the
    // multi-aggregate UoW owned by the module that creates money movements.
    // Same reasoning that already gave accounts and auth their own impls —
    // see CLAUDE.md, "Why IBudgetUnitOfWork is separate". No request scoping:
    // BudgetUnitOfWorkImpl has no QueryRunner field (it lives on run()'s call
    // stack), so the provider is a plain singleton.
    { provide: IBudgetUnitOfWork, useClass: BudgetUnitOfWorkImpl },
    BudgetsCacheImpl,
    { provide: IBudgetsCache, useExisting: BudgetsCacheImpl },
  ],
  exports: [GetBudgetByUserCategoryPeriodUseCase, BudgetMapper],
})
export class BudgetsModule {}
