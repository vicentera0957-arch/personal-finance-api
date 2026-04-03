import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
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
  CategoryNotBudgetableForBudgetException,
  InvalidAmountLimitException,
  InvalidBudgetMonthException,
  InvalidBudgetYearException,
} from '../../../domain/exceptions/budget.exceptions';
import { CategoryNotFoundException } from '../../../../categories/domain/exceptions/category.exceptions';
import { GetBudgetsQueryDto } from '../dto/get-budgets-query.dto';

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
  async create(@Body() dto: CreateBudgetDto): Promise<BudgetResponseDto> {
    try {
      const budget = await this.createBudgetUseCase.execute({
        userId: dto.userId,
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
        e instanceof CategoryNotBudgetableForBudgetException
      ) {
        throw new ConflictException(e.message);
      }
      throw e;
    }
  }

  @Get(':id')
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BudgetResponseDto> {
    try {
      const budget = await this.getBudgetByIdUseCase.execute(id);
      return this.toResponse(budget);
    } catch (e) {
      if (e instanceof BudgetNotFoundException) {
        throw new NotFoundException(e.message);
      }
      throw e;
    }
  }

  @Get('user/:userId')
  async findByUserId(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query() query: GetBudgetsQueryDto,
  ): Promise<BudgetResponseDto[]> {
    const budgets = await this.getBudgetsByUserIdUseCase.execute(userId, {
      month: query.month,
      year: query.year,
    });
    return budgets.map((budget) => this.toResponse(budget));
  }

  @Patch(':id/limit')
  async updateLimit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBudgetLimitDto,
  ): Promise<BudgetResponseDto> {
    try {
      const budget = await this.updateBudgetLimitUseCase.execute({
        id,
        limit: dto.limit,
      });
      return this.toResponse(budget);
    } catch (e) {
      if (e instanceof BudgetNotFoundException) {
        throw new NotFoundException(e.message);
      }
      if (e instanceof InvalidAmountLimitException) {
        throw new BadRequestException(e.message);
      }
      throw e;
    }
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    try {
      await this.deleteBudgetUseCase.execute(id);
    } catch (e) {
      if (e instanceof BudgetNotFoundException) {
        throw new NotFoundException(e.message);
      }
      if (e instanceof BudgetHasTransactionsInPeriodException) {
        throw new ConflictException(e.message);
      }
      throw e;
    }
  }
}
