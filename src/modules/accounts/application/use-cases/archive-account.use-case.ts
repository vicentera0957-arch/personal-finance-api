import { Injectable } from '@nestjs/common';
import { IAccountRepository } from '../../domain/repository/accounts.repository';
import { Account } from '../../domain/entities/account.entity';
import { GetAccountByIdUseCase } from './get-account-by-id.use-case';

interface ArchiveAccountDto {
  id: string;
  requestUserId: string;
}

@Injectable()
export class ArchiveAccountUseCase {
  constructor(
    private readonly accountRepository: IAccountRepository,
    private readonly getAccountByIdUseCase: GetAccountByIdUseCase,
  ) {}

  async execute(dto: ArchiveAccountDto): Promise<Account> {
    const account = await this.getAccountByIdUseCase.execute({
      id: dto.id,
      requestUserId: dto.requestUserId,
    });
    account.archive(); // la entidad lanza error si ya está archivada
    return this.accountRepository.save(account);
  }
}
