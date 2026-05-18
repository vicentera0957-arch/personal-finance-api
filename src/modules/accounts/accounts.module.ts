import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

// ORM Entity
import { AccountOrmEntity } from './infrastructure/persistence/account.orm.entity';

// Infrastructure
import { AccountRepositoryImpl } from './infrastructure/persistence/account.repo.implement';
import { AccountMapper } from './infrastructure/persistence/account.mapper';
import { AccountsController } from './infrastructure/http/accounts-controller/accounts.controller';

// Domain
import { IAccountRepository } from './domain/repository/accounts.repository';
// Módulos vecinos
import { TransactionsModule } from '../transactions/transactions.module';

// Use Cases
import { CreateAccountUseCase } from './application/use-cases/create-account.use-case';
import { GetAccountByIdUseCase } from './application/use-cases/get-account-by-id.use-case';
import { GetAccountsByUserIdUseCase } from './application/use-cases/get-accounts-by-user-id.use-case';
import { RenameAccountUseCase } from './application/use-cases/rename-account.use-case';
import { ArchiveAccountUseCase } from './application/use-cases/archive-account.use-case';
import { UnarchiveAccountUseCase } from './application/use-cases/unarchive-account.use-case';
import { DeleteAccountUseCase } from './application/use-cases/delete-account.use-case';
import { UpdateAccountBalanceUseCase } from './application/use-cases/update-account-balance.use-case';

@Module({
  imports: [
    TypeOrmModule.forFeature([AccountOrmEntity]),
    forwardRef(() => TransactionsModule),
  ],
  controllers: [AccountsController],
  providers: [
    // Mapper
    AccountMapper,

    // Use Cases
    CreateAccountUseCase,
    GetAccountByIdUseCase,
    GetAccountsByUserIdUseCase,
    RenameAccountUseCase,
    ArchiveAccountUseCase,
    UnarchiveAccountUseCase,
    DeleteAccountUseCase,
    UpdateAccountBalanceUseCase,

    // Vincula la interfaz con su implementación
    {
      provide: IAccountRepository,
      useClass: AccountRepositoryImpl,
    },
  ],
  exports: [
    AccountMapper,
    GetAccountByIdUseCase,
    GetAccountsByUserIdUseCase,
    UpdateAccountBalanceUseCase,
  ],
})
export class AccountsModule {}
