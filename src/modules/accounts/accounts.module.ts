import { Module, Scope } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

// ORM Entity
import { AccountOrmEntity } from './infrastructure/persistence/account.orm.entity';

// Infrastructure
import { AccountRepositoryImpl } from './infrastructure/persistence/account.repo.implement';
import { AccountMapper } from './infrastructure/persistence/account.mapper';
import { AccountUnitOfWorkImpl } from './infrastructure/persistence/account-unit-of-work.impl';
import { AccountsController } from './infrastructure/http/accounts-controller/accounts.controller';

// Domain
import { IAccountRepository } from './domain/repository/accounts.repository';
import { IAccountUnitOfWork } from './domain/IAccountUnitOfWork';

// Use Cases
import { CreateAccountUseCase } from './application/use-cases/create-account.use-case';
import { GetAccountByIdUseCase } from './application/use-cases/get-account-by-id.use-case';
import { GetAccountsByUserIdUseCase } from './application/use-cases/get-accounts-by-user-id.use-case';
import { RenameAccountUseCase } from './application/use-cases/rename-account.use-case';
import { ArchiveAccountUseCase } from './application/use-cases/archive-account.use-case';
import { UnarchiveAccountUseCase } from './application/use-cases/unarchive-account.use-case';
import { DeleteAccountUseCase } from './application/use-cases/delete-account.use-case';

@Module({
  imports: [TypeOrmModule.forFeature([AccountOrmEntity])],
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
    // Repos
    {
      provide: IAccountRepository,
      useClass: AccountRepositoryImpl,
    },
    {
      provide: IAccountUnitOfWork,
      useClass: AccountUnitOfWorkImpl,
      scope: Scope.REQUEST,
    },
  ],
  exports: [AccountMapper, GetAccountByIdUseCase],
})
export class AccountsModule {}
