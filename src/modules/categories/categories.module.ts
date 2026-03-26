import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

// ORM Entity
import { CategoryOrmEntity } from './infrastructure/persistence/category.orm.entity';

// Infrastructure
import { CategoryRepositoryImpl } from './infrastructure/persistence/category.repo.implement';
import { CategoryMapper } from './infrastructure/persistence/category.mapper';
import { CategoriesController } from './infrastructure/http/categories-controller/categories.controller';

// Domain
import { ICategoryRepository } from './domain/repository/category.repository';

// Use Cases
import { CreateCategoryUseCase } from './application/use-cases/create-category.use-case';
import { GetCategoryByIdUseCase } from './application/use-cases/get-category-by-id.use-case';
import { GetCategoriesByUserIdUseCase } from './application/use-cases/get-categories-by-user-id.use-case';
import { UpdateCategoryUseCase } from './application/use-cases/update-category.use-case';
import { DeleteCategoryUseCase } from './application/use-cases/delete-category.use-case';

@Module({
  imports: [TypeOrmModule.forFeature([CategoryOrmEntity])],
  controllers: [CategoriesController],
  providers: [
    // Mapper
    CategoryMapper,

    // Use Cases
    CreateCategoryUseCase,
    GetCategoryByIdUseCase,
    GetCategoriesByUserIdUseCase,
    UpdateCategoryUseCase,
    DeleteCategoryUseCase,

    // Vincula la interfaz abstracta con su implementación concreta
    {
      provide: ICategoryRepository,
      useClass: CategoryRepositoryImpl,
    },
  ],
  // Exportado para que TransactionsModule pueda validar existencia y naturaleza (R7)
  exports: [GetCategoryByIdUseCase],
})
export class CategoriesModule {}
