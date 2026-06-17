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
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
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
  CategoryNotFoundException,
  CategoryInUseException,
  DuplicateCategoryException,
  InvalidCategoryNameException,
  InvalidCategoryColorException,
  InvalidCategoryIconException,
} from '../../../domain/exceptions/category.exceptions';
import { ResourceOwnershipException } from '../../../../../shared/domain/exceptions/resource-ownership.exception';

@ApiTags('categories')
@ApiBearerAuth('access-token')
@Controller('categories')
export class CategoriesController {
  constructor(
    private readonly createCategoryUseCase: CreateCategoryUseCase,
    private readonly getCategoryByIdUseCase: GetCategoryByIdUseCase,
    private readonly getCategoriesByUserIdUseCase: GetCategoriesByUserIdUseCase,
    private readonly updateCategoryUseCase: UpdateCategoryUseCase,
    private readonly deleteCategoryUseCase: DeleteCategoryUseCase,
  ) {}

  private toResponse(category: Category): CategoryResponseDto {
    const dto = new CategoryResponseDto();
    dto.id = category.id;
    dto.userId = category.userId;
    dto.name = category.getName();
    dto.nature = category.nature.getValue();
    dto.color = category.getColor();
    dto.icon = category.getIcon();
    dto.createdAt = category.createdAt;
    dto.updatedAt = category.getUpdatedAt();
    return dto;
  }

  @Post()
  @ApiOperation({ summary: 'Crear categoría' })
  @ApiBody({ type: CreateCategoryDto })
  @ApiResponse({
    status: 201,
    description: 'Categoría creada',
    type: CategoryResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Nombre, color o icono inválido' })
  @ApiResponse({
    status: 409,
    description: 'Categoría duplicada (mismo nombre y naturaleza)',
  })
  async create(
    @Body() dto: CreateCategoryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CategoryResponseDto> {
    try {
      const category = await this.createCategoryUseCase.execute({
        userId: user.userId,
        name: dto.name,
        nature: dto.nature,
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
  @ApiOperation({ summary: 'Listar categorías del usuario autenticado' })
  @ApiResponse({
    status: 200,
    description: 'Lista de categorías',
    type: [CategoryResponseDto],
  })
  async findByUserId(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CategoryResponseDto[]> {
    const categories = await this.getCategoriesByUserIdUseCase.execute(
      user.userId,
    );
    return categories.map((c) => this.toResponse(c));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener categoría por ID' })
  @ApiParam({ name: 'id', description: 'UUID de la categoría' })
  @ApiResponse({
    status: 200,
    description: 'Categoría encontrada',
    type: CategoryResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Categoría no encontrada' })
  @ApiResponse({
    status: 403,
    description: 'No autorizado para ver esta categoría',
  })
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
  @ApiOperation({ summary: 'Actualizar categoría (nombre, color, icono)' })
  @ApiParam({ name: 'id', description: 'UUID de la categoría' })
  @ApiBody({ type: UpdateCategoryDto })
  @ApiResponse({
    status: 200,
    description: 'Categoría actualizada',
    type: CategoryResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Nombre, color o icono inválido' })
  @ApiResponse({ status: 404, description: 'Categoría no encontrada' })
  @ApiResponse({ status: 403, description: 'No autorizado' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CategoryResponseDto> {
    try {
      const category = await this.updateCategoryUseCase.execute({
        id,
        name: dto.name,
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
      throw e;
    }
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar categoría' })
  @ApiParam({ name: 'id', description: 'UUID de la categoría' })
  @ApiResponse({ status: 204, description: 'Categoría eliminada' })
  @ApiResponse({ status: 404, description: 'Categoría no encontrada' })
  @ApiResponse({ status: 403, description: 'No autorizado' })
  @ApiResponse({
    status: 409,
    description: 'Categoría en uso por presupuestos o transacciones',
  })
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
