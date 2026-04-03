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
  NotFoundException,
  ConflictException,
  BadRequestException,
  ParseUUIDPipe,
} from '@nestjs/common';
// Use cases
import { CreateAccountUseCase } from '../../../application/use-cases/create-account.use-case';
import { GetAccountByIdUseCase } from '../../../application/use-cases/get-account-by-id.use-case';
import { GetAccountsByUserIdUseCase } from '../../../application/use-cases/get-accounts-by-user-id.use-case';
import { RenameAccountUseCase } from '../../../application/use-cases/rename-account.use-case';
import { ArchiveAccountUseCase } from '../../../application/use-cases/archive-account.use-case';
import { UnarchiveAccountUseCase } from '../../../application/use-cases/unarchive-account.use-case';
import { DeleteAccountUseCase } from '../../../application/use-cases/delete-account.use-case';
// DTOs
import { CreateAccountDto } from '../dto/create-account.dto';
import { RenameAccountDto } from '../dto/rename-account.dto';
import { AccountResponseDto } from '../dto/account-response.dto';
// Domain
import { Account } from '../../../domain/entities/account.entity';
import {
  AccountNotFoundException,
  AccountAlreadyArchivedDomainException,
  AccountNotArchivedDomainException,
  CannotOperateOnArchivedAccountException,
  NoTypeProvidedException,
  InvalidAccountTypeException,
  InvalidBalanceException,
  AccountInUseException,
} from '../../../domain/exceptions/account.exceptions';

@Controller('accounts')
export class AccountsController {
  constructor(
    private readonly createAccountUseCase: CreateAccountUseCase,
    private readonly getAccountByIdUseCase: GetAccountByIdUseCase,
    private readonly getAccountsByUserIdUseCase: GetAccountsByUserIdUseCase,
    private readonly renameAccountUseCase: RenameAccountUseCase,
    private readonly archiveAccountUseCase: ArchiveAccountUseCase,
    private readonly unarchiveAccountUseCase: UnarchiveAccountUseCase,
    private readonly deleteAccountUseCase: DeleteAccountUseCase,
  ) {}

  private toResponse(account: Account): AccountResponseDto {
    const dto = new AccountResponseDto();
    dto.id = account.id;
    dto.userId = account.userId;
    dto.name = account.getName();
    dto.type = account.type.getType();
    dto.initialBalance = account.getInitialBalance().getValue();
    dto.currentBalance = account.getCurrentBalance().getValue();
    dto.isArchived = account.getIsArchived();
    dto.createdAt = account.createdAt;
    dto.updatedAt = account.getUpdatedAt();
    return dto;
  }

  @Post()
  async create(@Body() dto: CreateAccountDto): Promise<AccountResponseDto> {
    try {
      const account = await this.createAccountUseCase.execute({
        userId: dto.userId,
        name: dto.name,
        type: dto.type,
        initialBalance: dto.initialBalance,
      });
      return this.toResponse(account);
    } catch (e) {
      if (
        e instanceof NoTypeProvidedException ||
        e instanceof InvalidAccountTypeException ||
        e instanceof InvalidBalanceException
      ) {
        throw new BadRequestException(e.message);
      }
      throw e;
    }
  }

  @Get(':id')
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AccountResponseDto> {
    try {
      const account = await this.getAccountByIdUseCase.execute({ id });
      return this.toResponse(account);
    } catch (e) {
      if (e instanceof AccountNotFoundException) {
        throw new NotFoundException(e.message);
      }
      throw e;
    }
  }

  @Get('user/:userId')
  async findByUserId(
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<AccountResponseDto[]> {
    const accounts = await this.getAccountsByUserIdUseCase.execute({ userId });
    return accounts.map((a) => this.toResponse(a));
  }

  @Patch(':id/name')
  async rename(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenameAccountDto,
  ): Promise<AccountResponseDto> {
    try {
      const account = await this.renameAccountUseCase.execute({
        id,
        name: dto.name,
      });
      return this.toResponse(account);
    } catch (e) {
      if (e instanceof AccountNotFoundException) {
        throw new NotFoundException(e.message);
      }
      if (e instanceof CannotOperateOnArchivedAccountException) {
        throw new ConflictException(e.message);
      }
      throw e;
    }
  }

  @Patch(':id/archive')
  async archive(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AccountResponseDto> {
    try {
      const account = await this.archiveAccountUseCase.execute({ id });
      return this.toResponse(account);
    } catch (e) {
      if (e instanceof AccountNotFoundException) {
        throw new NotFoundException(e.message);
      }
      if (e instanceof AccountAlreadyArchivedDomainException) {
        throw new ConflictException(e.message);
      }
      throw e;
    }
  }

  @Patch(':id/unarchive')
  async unarchive(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AccountResponseDto> {
    try {
      const account = await this.unarchiveAccountUseCase.execute({ id });
      return this.toResponse(account);
    } catch (e) {
      if (e instanceof AccountNotFoundException) {
        throw new NotFoundException(e.message);
      }
      if (e instanceof AccountNotArchivedDomainException) {
        throw new ConflictException(e.message);
      }
      throw e;
    }
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    try {
      await this.deleteAccountUseCase.execute({ id });
    } catch (e) {
      if (e instanceof AccountNotFoundException) {
        throw new NotFoundException(e.message);
      }
      if (e instanceof AccountInUseException) {
        throw new ConflictException(e.message);
      }
      throw e;
    }
  }
}
