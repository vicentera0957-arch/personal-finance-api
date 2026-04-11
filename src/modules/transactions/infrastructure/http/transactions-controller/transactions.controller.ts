import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  NotFoundException,
  ConflictException,
  UnprocessableEntityException,
  BadRequestException,
  ForbiddenException,
  ParseUUIDPipe,
} from '@nestjs/common';
import { CurrentUser } from '../../../../auth/infrastructure/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../../auth/infrastructure/decorators/current-user.decorator';
// Use cases
import { CreateTransactionUseCase } from '../../../application/use-cases/create-transaction.use-case';
import { GetTransactionByIdUseCase } from '../../../application/use-cases/get-transaction-by-id.use-case';
import { GetTransactionsByAccountIdUseCase } from '../../../application/use-cases/get-transactions-by-account-id.use-case';
import { GetTransactionsByUserIdUseCase } from '../../../application/use-cases/get-transactions-by-user-id.use-case';
import { DeleteTransactionUseCase } from '../../../application/use-cases/delete-transaction.use-case';
// DTOs
import { CreateTransactionDto } from '../dto/create-transaction.dto';
import { TransactionResponseDto } from '../dto/transaction-response.dto';
import { GetTransactionsQueryDto } from '../dto/get-transactions-query.dto';
// Dominio
import { Transaction } from '../../../domain/entities/transaction.entity';
import {
  TransactionNotFoundException,
  CannotDeleteTransactionException,
  IncompatibleCategoryNatureException,
  InvalidAmountException,
  EmptyTransactionNatureException,
  InvalidTransactionNatureException,
} from '../../../domain/exceptions/transaction.exceptions';
import {
  BudgetLimitExceededException,
  BudgetRequiredForExpenseTransactionException,
  CategoryNotBudgetableForBudgetException,
} from '../../../../budgets/domain/exceptions/budget.exceptions';
// Excepciones de módulos vecinos (mapeadas aquí)
import {
  AccountNotFoundException,
  InsufficientFundsException,
  CannotOperateOnArchivedAccountException,
} from '../../../../accounts/domain/exceptions/account.exceptions';
import { CategoryNotFoundException } from '../../../../categories/domain/exceptions/category.exceptions';
import { ResourceOwnershipException } from '../../../../../shared/domain/exceptions/resource-ownership.exception';

@Controller('transactions')
export class TransactionsController {
  constructor(
    private readonly createTransactionUseCase: CreateTransactionUseCase,
    private readonly getTransactionByIdUseCase: GetTransactionByIdUseCase,
    private readonly getTransactionsByAccountIdUseCase: GetTransactionsByAccountIdUseCase,
    private readonly getTransactionsByUserIdUseCase: GetTransactionsByUserIdUseCase,
    private readonly deleteTransactionUseCase: DeleteTransactionUseCase,
  ) {}

  // Convierte la entidad de dominio al DTO de respuesta HTTP
  private toResponse(transaction: Transaction): TransactionResponseDto {
    const dto = new TransactionResponseDto();
    dto.id = transaction.id;
    dto.userId = transaction.userId;
    dto.accountId = transaction.accountId;
    dto.categoryId = transaction.categoryId;
    dto.nature = transaction.nature.getValue();
    dto.amount = transaction.amount.getValue();
    dto.description = transaction.description;
    dto.transactionDate = transaction.transactionDate;
    dto.createdAt = transaction.createdAt;
    return dto;
  }

  @Post()
  async create(
    @Body() dto: CreateTransactionDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TransactionResponseDto> {
    try {
      const transaction = await this.createTransactionUseCase.execute({
        userId: user.userId,
        accountId: dto.accountId,
        categoryId: dto.categoryId,
        nature: dto.nature,
        amount: dto.amount,
        description: dto.description,
        transactionDate: new Date(dto.transactionDate),
      });
      return this.toResponse(transaction);
    } catch (e) {
      if (
        e instanceof AccountNotFoundException ||
        e instanceof CategoryNotFoundException
      ) {
        throw new NotFoundException(e.message);
      }
      if (
        e instanceof InvalidAmountException ||
        e instanceof EmptyTransactionNatureException ||
        e instanceof InvalidTransactionNatureException ||
        e instanceof IncompatibleCategoryNatureException
      ) {
        throw new BadRequestException(e.message);
      }
      if (
        e instanceof BudgetRequiredForExpenseTransactionException ||
        e instanceof CategoryNotBudgetableForBudgetException ||
        e instanceof CannotOperateOnArchivedAccountException ||
        e instanceof ResourceOwnershipException
      ) {
        throw new ConflictException(e.message);
      }
      if (
        e instanceof BudgetLimitExceededException ||
        e instanceof InsufficientFundsException
      ) {
        throw new UnprocessableEntityException(e.message);
      }
      throw e;
    }
  }

  @Get()
  async findByUserId(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GetTransactionsQueryDto,
  ): Promise<TransactionResponseDto[]> {
    const offset =
      query.page && query.limit ? (query.page - 1) * query.limit : undefined;
    const transactions = await this.getTransactionsByUserIdUseCase.execute(
      user.userId,
      {
        limit: query.limit,
        offset,
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
      },
    );
    return transactions.map((t) => this.toResponse(t));
  }

  @Get('account/:accountId')
  async findByAccountId(
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GetTransactionsQueryDto,
  ): Promise<TransactionResponseDto[]> {
    const offset =
      query.page && query.limit ? (query.page - 1) * query.limit : undefined;
    const transactions = await this.getTransactionsByAccountIdUseCase.execute(
      accountId,
      user.userId,
      {
        limit: query.limit,
        offset,
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
      },
    );
    return transactions.map((t) => this.toResponse(t));
  }

  @Get(':id')
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TransactionResponseDto> {
    try {
      const transaction = await this.getTransactionByIdUseCase.execute(
        id,
        user.userId,
      );
      return this.toResponse(transaction);
    } catch (e) {
      if (e instanceof TransactionNotFoundException) {
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
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    try {
      await this.deleteTransactionUseCase.execute(id, user.userId);
    } catch (e) {
      if (
        e instanceof TransactionNotFoundException ||
        e instanceof AccountNotFoundException
      ) {
        throw new NotFoundException(e.message);
      }
      if (
        e instanceof CannotDeleteTransactionException ||
        e instanceof CannotOperateOnArchivedAccountException ||
        e instanceof ResourceOwnershipException
      ) {
        throw new ConflictException(e.message);
      }
      throw e;
    }
  }
}
