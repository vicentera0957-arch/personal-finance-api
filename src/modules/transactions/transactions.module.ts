import { Module, Scope, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

// ORM Entity
import { TransactionOrmEntity } from './infrastructure/persistence/transaction.orm.entity';

// Infrastructure
import { TransactionRepositoryImpl } from './infrastructure/persistence/transaction.repo.implement';
import { TransactionMapper } from './infrastructure/persistence/transaction.mapper';
import { TransactionsController } from './infrastructure/http/transactions-controller/transactions.controller';
import { TypeOrmUnitOfWorkImpl } from './infrastructure/persistence/unit-of-work.impl';
// Domain
import { ITransactionRepository } from './domain/repository/transaction.repository';
import { IExpenseChecker } from '../budgets/domain/repository/expense-checker.port';
import { ExpenseCheckerImpl } from './infrastructure/persistence/expense-checker.implement';
import { ITransactionUnitOfWork } from './domain/ITransactionUnitOfWork';
import { IBudgetUnitOfWork } from '../budgets/domain/IBudgetUnitOfWork';
// Use Cases
import { CreateTransactionUseCase } from './application/use-cases/create-transaction.use-case';
import { GetTransactionByIdUseCase } from './application/use-cases/get-transaction-by-id.use-case';
import { GetTransactionsByAccountIdUseCase } from './application/use-cases/get-transactions-by-account-id.use-case';
import { GetTransactionsByUserIdUseCase } from './application/use-cases/get-transactions-by-user-id.use-case';
import { DeleteTransactionUseCase } from './application/use-cases/delete-transaction.use-case';

// Módulos vecinos — transactions necesita operar sobre cuentas y validar categorías
import { AccountsModule } from '../accounts/accounts.module';
import { CategoriesModule } from '../categories/categories.module';
import { BudgetsModule } from '../budgets/budgets.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TransactionOrmEntity]),
    AccountsModule, // provee GetAccountByIdUseCase + IAccountRepository
    CategoriesModule, // provee GetCategoryByIdUseCase
    forwardRef(() => BudgetsModule), // provee GetBudgetByUserCategoryPeriodUseCase
  ],
  controllers: [TransactionsController],
  providers: [
    // Mapper
    TransactionMapper,

    // Use Cases
    CreateTransactionUseCase,
    GetTransactionByIdUseCase,
    GetTransactionsByAccountIdUseCase,
    GetTransactionsByUserIdUseCase,
    DeleteTransactionUseCase,

    // Vincula la interfaz abstracta con su implementación concreta
    {
      provide: ITransactionRepository,
      useClass: TransactionRepositoryImpl,
    },
    {
      provide: IExpenseChecker,
      useClass: ExpenseCheckerImpl,
    },
    // The concrete UoW is provided once as request-scoped, then aliased
    // to each module-specific port via `useExisting` so all consumers share
    // the SAME instance (and therefore the same QueryRunner) per request.
    {
      provide: TypeOrmUnitOfWorkImpl,
      useClass: TypeOrmUnitOfWorkImpl,
      scope: Scope.REQUEST,
    },
    {
      provide: ITransactionUnitOfWork,
      useExisting: TypeOrmUnitOfWorkImpl,
    },
    {
      provide: IBudgetUnitOfWork,
      useExisting: TypeOrmUnitOfWorkImpl,
    },
  ],
  exports: [IExpenseChecker, ITransactionUnitOfWork, IBudgetUnitOfWork],
})
export class TransactionsModule {}
