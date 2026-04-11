import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  ParseUUIDPipe,
} from '@nestjs/common';
import { CurrentUser } from '../../../../auth/infrastructure/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../../auth/infrastructure/decorators/current-user.decorator';
// Use cases
import { CreateCategoryUseCase } from '../../../application/use-cases/create-category.use-case';
import { GetCategoryByIdUseCase } from '../../../application/use-cases/get-category-by-id.use-case';
import { GetCategoriesByUserIdUseCase } from '../../../application/use-cases/get-categories-by-user-id.use-case';
import { UpdateCategoryUseCase } from '../../../application/use-cases/update-category.use-case';
import { DeleteCategoryUseCase } from '../../../application/use-cases/delete-category.use-case';
// DTOs
import { CreateCategoryDto } from '../dto/create-category.dto';
import { UpdateCategoryDto } from '../dto/update-category.dto';
import { CategoryResponseDto } from '../dto/category-response.dto';
// Dominio
import { Category } from '../../../domain/entities/category.entity';
import {
  CategoryBudgetableImmutableException,
  CategoryNotFoundException,
  CategoryInUseException,
  DuplicateCategoryException,
  InvalidCategoryNameException,
  InvalidCategoryColorException,
  InvalidCategoryIconException,
} from '../../../domain/exceptions/category.exceptions';
import { ResourceOwnershipException } from '../../../../../shared/domain/exceptions/resource-ownership.exception';

@Controller('categories')
export class CategoriesController {
  constructor(
    private readonly createCategoryUseCase: CreateCategoryUseCase,
    private readonly getCategoryByIdUseCase: GetCategoryByIdUseCase,
    private readonly getCategoriesByUserIdUseCase: GetCategoriesByUserIdUseCase,
    private readonly updateCategoryUseCase: UpdateCategoryUseCase,
    private readonly deleteCategoryUseCase: DeleteCategoryUseCase,
  ) {}

  // Convierte la entidad de dominio al DTO de respuesta HTTP
  private toResponse(category: Category): CategoryResponseDto {
    const dto = new CategoryResponseDto();
    dto.id = category.id;
    dto.userId = category.userId;
    dto.name = category.getName();
    dto.nature = category.nature.getValue();
    dto.isBudgetable = category.getIsBudgetable();
    dto.color = category.getColor();
    dto.icon = category.getIcon();
    dto.createdAt = category.createdAt;
    dto.updatedAt = category.getUpdatedAt();
    return dto;
  }

  @Post()
  async create(
    @Body() dto: CreateCategoryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CategoryResponseDto> {
    try {
      const category = await this.createCategoryUseCase.execute({
        userId: user.userId,
        name: dto.name,
        nature: dto.nature,
        isBudgetable: dto.isBudgetable,
        color: dto.color,
        icon: dto.icon,
      });
      return this.toResponse(category);
    } catch (e) {
      if (
        e instanceof InvalidCategoryNameException ||
        e instanceof InvalidCategoryColorException ||
        e instanceof InvalidCategoryIconException
      ) {
        throw new BadRequestException(e.message);
      }
      if (e instanceof DuplicateCategoryException) {
        throw new ConflictException(e.message);
      }
      throw e;
    }
  }

  @Get()
  async findByUserId(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CategoryResponseDto[]> {
    const categories = await this.getCategoriesByUserIdUseCase.execute(
      user.userId,
    );
    return categories.map((c) => this.toResponse(c));
  }

  @Get(':id')
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CategoryResponseDto> {
    try {
      const category = await this.getCategoryByIdUseCase.execute(
        id,
        user.userId,
      );
      return this.toResponse(category);
    } catch (e) {
      if (e instanceof CategoryNotFoundException) {
        throw new NotFoundException(e.message);
      }
      if (e instanceof ResourceOwnershipException) {
        throw new ForbiddenException(e.message);
      }
      throw e;
    }
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CategoryResponseDto> {
    try {
      const category = await this.updateCategoryUseCase.execute({
        id,
        name: dto.name,
        isBudgetable: dto.isBudgetable,
        color: dto.color,
        icon: dto.icon,
        requestUserId: user.userId,
      });
      return this.toResponse(category);
    } catch (e) {
      if (
        e instanceof InvalidCategoryNameException ||
        e instanceof InvalidCategoryColorException ||
        e instanceof InvalidCategoryIconException
      ) {
        throw new BadRequestException(e.message);
      }
      if (e instanceof CategoryNotFoundException) {
        throw new NotFoundException(e.message);
      }
      if (e instanceof ResourceOwnershipException) {
        throw new ForbiddenException(e.message);
      }
      if (e instanceof CategoryBudgetableImmutableException) {
        throw new ConflictException(e.message);
      }
      throw e;
    }
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    try {
      await this.deleteCategoryUseCase.execute(id, user.userId);
    } catch (e) {
      if (e instanceof CategoryNotFoundException) {
        throw new NotFoundException(e.message);
      }
      if (e instanceof ResourceOwnershipException) {
        throw new ForbiddenException(e.message);
      }
      if (e instanceof CategoryInUseException) {
        throw new ConflictException(e.message);
      }
      throw e;
    }
  }
}
