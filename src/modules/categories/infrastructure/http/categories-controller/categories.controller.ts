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
  ParseUUIDPipe,
} from '@nestjs/common';
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
  CategoryNotFoundException,
  CategoryInUseException,
  DuplicateCategoryException,
  InvalidCategoryNameException,
  InvalidCategoryColorException,
  InvalidCategoryIconException,
} from '../../../domain/exceptions/category.exceptions';

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
  async create(@Body() dto: CreateCategoryDto): Promise<CategoryResponseDto> {
    try {
      const category = await this.createCategoryUseCase.execute({
        userId: dto.userId,
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

  @Get('user/:userId')
  async findByUserId(
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<CategoryResponseDto[]> {
    const categories =
      await this.getCategoriesByUserIdUseCase.execute(userId);
    return categories.map((c) => this.toResponse(c));
  }

  @Get(':id')
  async findById(@Param('id', ParseUUIDPipe) id: string): Promise<CategoryResponseDto> {
    try {
      const category = await this.getCategoryByIdUseCase.execute(id);
      return this.toResponse(category);
    } catch (e) {
      if (e instanceof CategoryNotFoundException) {
        throw new NotFoundException(e.message);
      }
      throw e;
    }
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ): Promise<CategoryResponseDto> {
    try {
      const category = await this.updateCategoryUseCase.execute({
        id,
        name: dto.name,
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
      if (e instanceof CategoryNotFoundException) {
        throw new NotFoundException(e.message);
      }
      throw e;
    }
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    try {
      await this.deleteCategoryUseCase.execute(id);
    } catch (e) {
      if (e instanceof CategoryNotFoundException) {
        throw new NotFoundException(e.message);
      }
      if (e instanceof CategoryInUseException) {
        throw new ConflictException(e.message);
      }
      throw e;
    }
  }
}
