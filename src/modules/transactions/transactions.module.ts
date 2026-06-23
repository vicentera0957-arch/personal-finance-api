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
import { ITransactionUnitOfWork } from './domain/ITransactionUnitOfWork';
import { IBudgetUnitOfWork } from '../budgets/domain/IBudgetUnitOfWork';
import { IAccountUnitOfWork } from '../accounts/domain/IAccountUnitOfWork';
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
    forwardRef(() => AccountsModule), // provee GetAccountByIdUseCase + IAccountRepository
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
    // The concrete UoW is provided once as request-scoped, then aliased
    // to each module-specific port via `useExisting` so all consumers share
    // the SAME instance (and therefore the same QueryRunner) per request.
    {
      provide: TypeOrmUnitOfWorkImpl, //This token is never used directly — only the module-specific interfaces (ITransactionUnitOfWork, IAccountUnitOfWork, IBudgetUnitOfWork) are injected into the use cases.
      useClass: TypeOrmUnitOfWorkImpl, //But we still need to provide the concrete class itself here so Nest can instantiate it and manage its lifecycle.
      scope: Scope.REQUEST,
    },
    // This tokens are the ones
    // actually injected into the use cases
    {
      provide: ITransactionUnitOfWork,
      useExisting: TypeOrmUnitOfWorkImpl,
    },
    {
      provide: IBudgetUnitOfWork,
      useExisting: TypeOrmUnitOfWorkImpl,
    },
    {
      provide: IAccountUnitOfWork,
      useExisting: TypeOrmUnitOfWorkImpl,
    },
  ],
  exports: [
    ITransactionUnitOfWork,
    IBudgetUnitOfWork,
    IAccountUnitOfWork,
  ],
})
export class TransactionsModule {}
