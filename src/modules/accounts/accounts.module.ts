import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

// ORM Entity
import { AccountOrmEntity } from './infrastructure/persistance/account.orm.entity';

// Infrastructure
import { AccountRepositoryImpl } from './infrastructure/persistance/account.repo.implement';
import { AccountMapper } from './infrastructure/persistance/account.mapper';
import { AccountsController } from './infrastructure/http/accounts-controller/accounts.controller';

// Domain
import { IAccountRepository } from './domain/repository/accounts.repository';

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

    // Vincula la interfaz con su implementación
    {
      provide: IAccountRepository,
      useClass: AccountRepositoryImpl,
    },
  ],
  // GetAccountByIdUseCase: para que transactions pueda buscar la cuenta
  // IAccountRepository: para que transactions pueda guardar el balance actualizado
  exports: [GetAccountByIdUseCase, IAccountRepository],
})
export class AccountsModule {}
