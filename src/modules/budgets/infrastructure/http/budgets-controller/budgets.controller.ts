import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../../auth/infrastructure/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../../auth/infrastructure/decorators/current-user.decorator';
import { CreateBudgetUseCase } from '../../../application/use-cases/create-budget.use-case';
import { GetBudgetByIdUseCase } from '../../../application/use-cases/get-budget-by-id.use-case';
import { GetBudgetsByUserIdUseCase } from '../../../application/use-cases/get-budgets-by-user-id.use-case';
import { UpdateBudgetLimitUseCase } from '../../../application/use-cases/update-budget-limit.use-case';
import { DeleteBudgetUseCase } from '../../../application/use-cases/delete-budget.use-case';
import { CreateBudgetDto } from '../dto/create-budget.dto';
import { UpdateBudgetLimitDto } from '../dto/update-budget-limit.dto';
import { BudgetResponseDto } from '../dto/budget-response.dto';
import { Budget } from '../../../domain/budget.entity';
import {
  BudgetAlreadyExistsException,
  BudgetCategoryMustBeExpenseException,
  BudgetNotFoundException,
  BudgetHasTransactionsInPeriodException,
  InvalidAmountLimitException,
  InvalidBudgetMonthException,
  InvalidBudgetYearException,
} from '../../../domain/exceptions/budget.exceptions';
import { CategoryNotFoundException } from '../../../../categories/domain/exceptions/category.exceptions';
import { ResourceOwnershipException } from '../../../../../shared/domain/exceptions/resource-ownership.exception';
import { GetBudgetsQueryDto } from '../dto/get-budgets-query.dto';

@ApiTags('budgets')
@ApiBearerAuth('access-token')
@Controller('budgets')
export class BudgetsController {
  constructor(
    private readonly createBudgetUseCase: CreateBudgetUseCase,
    private readonly getBudgetByIdUseCase: GetBudgetByIdUseCase,
    private readonly getBudgetsByUserIdUseCase: GetBudgetsByUserIdUseCase,
    private readonly updateBudgetLimitUseCase: UpdateBudgetLimitUseCase,
    private readonly deleteBudgetUseCase: DeleteBudgetUseCase,
  ) {}

  private toResponse(budget: Budget): BudgetResponseDto {
    const dto = new BudgetResponseDto();
    dto.id = budget.id;
    dto.userId = budget.userId;
    dto.categoryId = budget.categoryId;
    dto.month = budget.month;
    dto.year = budget.year;
    dto.limit = budget.getLimit().getValue();
    dto.createdAt = budget.createdAt;
    dto.updatedAt = budget.getUpdatedAt();
    return dto;
  }

  @Post()
  async create(
    @Body() dto: CreateBudgetDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<BudgetResponseDto> {
    try {
      const budget = await this.createBudgetUseCase.execute({
        userId: user.userId,
        categoryId: dto.categoryId,
        month: dto.month,
        year: dto.year,
        limit: dto.limit,
      });
      return this.toResponse(budget);
    } catch (e) {
      if (e instanceof CategoryNotFoundException) {
        throw new NotFoundException(e.message);
      }
      if (
        e instanceof InvalidAmountLimitException ||
        e instanceof InvalidBudgetMonthException ||
        e instanceof InvalidBudgetYearException
      ) {
        throw new BadRequestException(e.message);
      }
      if (
        e instanceof BudgetAlreadyExistsException ||
        e instanceof BudgetCategoryMustBeExpenseException ||
        e instanceof ResourceOwnershipException
      ) {
        throw new ConflictException(e.message);
      }
      throw e;
    }
  }

  @Get()
  async findByUserId(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GetBudgetsQueryDto,
  ): Promise<BudgetResponseDto[]> {
    const budgets = await this.getBudgetsByUserIdUseCase.execute(user.userId, {
      month: query.month,
      year: query.year,
    });
    return budgets.map((budget) => this.toResponse(budget));
  }

  @Get(':id')
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<BudgetResponseDto> {
    try {
      const budget = await this.getBudgetByIdUseCase.execute(id, user.userId);
      return this.toResponse(budget);
    } catch (e) {
      if (e instanceof BudgetNotFoundException) {
        throw new NotFoundException(e.message);
      }
      if (e instanceof ResourceOwnershipException) {
        throw new ForbiddenException(e.message);
      }
      throw e;
    }
  }

  @Patch(':id/limit')
  async updateLimit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBudgetLimitDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<BudgetResponseDto> {
    try {
      const budget = await this.updateBudgetLimitUseCase.execute({
        id,
        limit: dto.limit,
        requestUserId: user.userId,
      });
      return this.toResponse(budget);
    } catch (e) {
      if (e instanceof BudgetNotFoundException) {
        throw new NotFoundException(e.message);
      }
      if (e instanceof ResourceOwnershipException) {
        throw new ForbiddenException(e.message);
      }
      if (e instanceof InvalidAmountLimitException) {
        throw new BadRequestException(e.message);
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
      await this.deleteBudgetUseCase.execute(id, user.userId);
    } catch (e) {
      if (e instanceof BudgetNotFoundException) {
        throw new NotFoundException(e.message);
      }
      if (e instanceof ResourceOwnershipException) {
        throw new ForbiddenException(e.message);
      }
      if (e instanceof BudgetHasTransactionsInPeriodException) {
        throw new ConflictException(e.message);
      }
      throw e;
    }
  }
}
