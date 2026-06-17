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
import { ResourceOwnershipException } from '../../../../../shared/domain/exceptions/resource-ownership.exception';

@ApiTags('accounts')
@ApiBearerAuth('access-token')
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
  @ApiOperation({ summary: 'Crear cuenta financiera' })
  @ApiBody({ type: CreateAccountDto })
  @ApiResponse({
    status: 201,
    description: 'Cuenta creada',
    type: AccountResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Tipo de cuenta o balance inválido',
  })
  @ApiResponse({ status: 403, description: 'No autorizado' })
  async create(
    @Body() dto: CreateAccountDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AccountResponseDto> {
    try {
      const account = await this.createAccountUseCase.execute({
        userId: user.userId,
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
      if (e instanceof ResourceOwnershipException) {
        throw new ForbiddenException(e.message);
      }
      throw e;
    }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener cuenta por ID' })
  @ApiParam({ name: 'id', description: 'UUID de la cuenta' })
  @ApiResponse({
    status: 200,
    description: 'Cuenta encontrada',
    type: AccountResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Cuenta no encontrada' })
  @ApiResponse({
    status: 403,
    description: 'No autorizado para ver esta cuenta',
  })
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AccountResponseDto> {
    try {
      const account = await this.getAccountByIdUseCase.execute({
        id,
        requestUserId: user.userId,
      });
      return this.toResponse(account);
    } catch (e) {
      if (e instanceof AccountNotFoundException) {
        throw new NotFoundException(e.message);
      }
      if (e instanceof ResourceOwnershipException) {
        throw new ForbiddenException(e.message);
      }
      throw e;
    }
  }

  @Get()
  @ApiOperation({ summary: 'Listar cuentas del usuario autenticado' })
  @ApiResponse({
    status: 200,
    description: 'Lista de cuentas',
    type: [AccountResponseDto],
  })
  async findByUserId(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AccountResponseDto[]> {
    const accounts = await this.getAccountsByUserIdUseCase.execute({
      userId: user.userId,
    });
    return accounts.map((a) => this.toResponse(a));
  }

  @Patch(':id/name')
  @ApiOperation({ summary: 'Renombrar cuenta' })
  @ApiParam({ name: 'id', description: 'UUID de la cuenta' })
  @ApiBody({ type: RenameAccountDto })
  @ApiResponse({
    status: 200,
    description: 'Cuenta renombrada',
    type: AccountResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Cuenta no encontrada' })
  @ApiResponse({ status: 403, description: 'No autorizado' })
  @ApiResponse({
    status: 409,
    description: 'Cuenta archivada — no se puede renombrar',
  })
  async rename(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenameAccountDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AccountResponseDto> {
    try {
      const account = await this.renameAccountUseCase.execute({
        id,
        name: dto.name,
        requestUserId: user.userId,
      });
      return this.toResponse(account);
    } catch (e) {
      if (e instanceof AccountNotFoundException) {
        throw new NotFoundException(e.message);
      }
      if (e instanceof ResourceOwnershipException) {
        throw new ForbiddenException(e.message);
      }
      if (e instanceof CannotOperateOnArchivedAccountException) {
        throw new ConflictException(e.message);
      }
      throw e;
    }
  }

  @Patch(':id/archive')
  @ApiOperation({ summary: 'Archivar cuenta' })
  @ApiParam({ name: 'id', description: 'UUID de la cuenta' })
  @ApiResponse({
    status: 200,
    description: 'Cuenta archivada',
    type: AccountResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Cuenta no encontrada' })
  @ApiResponse({ status: 403, description: 'No autorizado' })
  @ApiResponse({ status: 409, description: 'La cuenta ya está archivada' })
  async archive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AccountResponseDto> {
    try {
      const account = await this.archiveAccountUseCase.execute({
        id,
        requestUserId: user.userId,
      });
      return this.toResponse(account);
    } catch (e) {
      if (e instanceof AccountNotFoundException) {
        throw new NotFoundException(e.message);
      }
      if (e instanceof ResourceOwnershipException) {
        throw new ForbiddenException(e.message);
      }
      if (e instanceof AccountAlreadyArchivedDomainException) {
        throw new ConflictException(e.message);
      }
      throw e;
    }
  }

  @Patch(':id/unarchive')
  @ApiOperation({ summary: 'Desarchivar cuenta' })
  @ApiParam({ name: 'id', description: 'UUID de la cuenta' })
  @ApiResponse({
    status: 200,
    description: 'Cuenta desarchivada',
    type: AccountResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Cuenta no encontrada' })
  @ApiResponse({ status: 403, description: 'No autorizado' })
  @ApiResponse({ status: 409, description: 'La cuenta no está archivada' })
  async unarchive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AccountResponseDto> {
    try {
      const account = await this.unarchiveAccountUseCase.execute({
        id,
        requestUserId: user.userId,
      });
      return this.toResponse(account);
    } catch (e) {
      if (e instanceof AccountNotFoundException) {
        throw new NotFoundException(e.message);
      }
      if (e instanceof ResourceOwnershipException) {
        throw new ForbiddenException(e.message);
      }
      if (e instanceof AccountNotArchivedDomainException) {
        throw new ConflictException(e.message);
      }
      throw e;
    }
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar cuenta' })
  @ApiParam({ name: 'id', description: 'UUID de la cuenta' })
  @ApiResponse({ status: 204, description: 'Cuenta eliminada' })
  @ApiResponse({ status: 404, description: 'Cuenta no encontrada' })
  @ApiResponse({ status: 403, description: 'No autorizado' })
  @ApiResponse({
    status: 409,
    description: 'Cuenta tiene transacciones asociadas',
  })
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    try {
      await this.deleteAccountUseCase.execute({
        id,
        requestUserId: user.userId,
      });
    } catch (e) {
      if (e instanceof AccountNotFoundException) {
        throw new NotFoundException(e.message);
      }
      if (e instanceof ResourceOwnershipException) {
        throw new ForbiddenException(e.message);
      }
      if (e instanceof AccountInUseException) {
        throw new ConflictException(e.message);
      }
      throw e;
    }
  }
}
