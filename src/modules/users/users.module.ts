import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

// ORM Entity
import { UserOrmEntity } from './infrastructure/persistence/user.orm.entity';

// Infrastructure
import { UserRepositoryImpl } from './infrastructure/persistence/user.repo.implement';
import { UserMapper } from './infrastructure/persistence/user.mapper';
import { UsersController } from './infrastructure/http/user-controller/user.controller';

// Domain
import { IUserRepository } from './domain/repository/user.repository';

// Use Cases
import { CreateUserUseCase } from './application/use-cases/create-user.use-case';
import { GetUserByIdUseCase } from './application/use-cases/get-user-by-id.use-case';
import { GetUserByEmailUseCase } from './application/use-cases/get-user-by-email.use-case';
import { UpdateUserProfileUseCase } from './application/use-cases/update-user-profile.use-case';
import { DeleteUserUseCase } from './application/use-cases/delete-user.use-case';

@Module({
  imports: [TypeOrmModule.forFeature([UserOrmEntity])],
  controllers: [UsersController],
  providers: [
    // Mapper
    UserMapper,

    // Use Cases
    CreateUserUseCase,
    GetUserByIdUseCase,
    GetUserByEmailUseCase,
    UpdateUserProfileUseCase,
    DeleteUserUseCase,

    // Vincula la interfaz con su implementación
    {
      provide: IUserRepository,
      useClass: UserRepositoryImpl,
    },
  ],
  exports: [GetUserByEmailUseCase],
})
export class UsersModule {}
