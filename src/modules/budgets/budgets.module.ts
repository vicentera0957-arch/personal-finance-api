import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BudgetOrmEntity } from './infrastructure/persistence/budget.orm.entity';
import { BudgetRepositoryImpl } from './infrastructure/persistence/budget.repo.implement';
import { BudgetMapper } from './infrastructure/persistence/budget.mapper';
import { BudgetsController } from './infrastructure/http/budgets-controller/budgets.controller';
import { IBudgetRepository } from './domain/repository/budgets.repository';
import { CreateBudgetUseCase } from './application/use-cases/create-budget.use-case';
import { GetBudgetByIdUseCase } from './application/use-cases/get-budget-by-id.use-case';
import { GetBudgetsByUserIdUseCase } from './application/use-cases/get-budgets-by-user-id.use-case';
import { UpdateBudgetLimitUseCase } from './application/use-cases/update-budget-limit.use-case';
import { DeleteBudgetUseCase } from './application/use-cases/delete-budget.use-case';
import { GetBudgetByUserCategoryPeriodUseCase } from './application/use-cases/get-budget-by-user-category-period.use-case';
import { CategoriesModule } from '../categories/categories.module';
import { TransactionsModule } from '../transactions/transactions.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([BudgetOrmEntity]),
    CategoriesModule,
    forwardRef(() => TransactionsModule),
  ],
  controllers: [BudgetsController],
  providers: [
    BudgetMapper,
    CreateBudgetUseCase,
    GetBudgetByIdUseCase,
    GetBudgetsByUserIdUseCase,
    GetBudgetByUserCategoryPeriodUseCase,
    UpdateBudgetLimitUseCase,
    DeleteBudgetUseCase,
    {
      provide: IBudgetRepository,
      useClass: BudgetRepositoryImpl,
    },
  ],
  exports: [GetBudgetByUserCategoryPeriodUseCase],
})
export class BudgetsModule {}
