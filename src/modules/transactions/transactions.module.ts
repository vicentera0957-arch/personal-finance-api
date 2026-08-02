import { Module, Scope } from '@nestjs/common';
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
    AccountsModule, // provee AccountMapper y GetAccountByIdUseCase
    CategoriesModule, // provee GetCategoryByIdUseCase
    BudgetsModule, // provee GetBudgetByUserCategoryPeriodUseCase — direct import now: budgets no longer imports transactions, so the DI cycle that used to require deferred resolution is gone
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
    // The concrete UoW is provided as request-scoped, then aliased to its
    // port via `useExisting`. It used to also alias IBudgetUnitOfWork here
    // (via a second `useExisting`, sharing this same instance/QueryRunner
    // with UpdateBudgetLimit/DeleteBudget) — that alias is gone now that
    // budgets owns its own BudgetUnitOfWorkImpl. This impl serves only
    // ITransactionUnitOfWork; CreateTransaction/DeleteTransaction are the
    // only flows that need its multi-aggregate QueryRunner.
    {
      provide: TypeOrmUnitOfWorkImpl, //This token is never used directly — only the module-specific interface (ITransactionUnitOfWork) is injected into the use cases.
      useClass: TypeOrmUnitOfWorkImpl, //But we still need to provide the concrete class itself here so Nest can instantiate it and manage its lifecycle.
      scope: Scope.REQUEST,
    },
    // This token is the one
    // actually injected into the use cases
    {
      provide: ITransactionUnitOfWork,
      useExisting: TypeOrmUnitOfWorkImpl,
    },
  ],
})
export class TransactionsModule {}
