import { Injectable } from '@nestjs/common';
import { IAccountRepository } from '../domain/repository/accounts.repository';
import { Account } from '../domain/entities/account.entity';
import { AccountNotFoundException } from '../domain/exceptions/account.exceptions';

interface GetAccountByIdDto {
  id: string;
}

@Injectable()
export class GetAccountByIdUseCase {
  constructor(private readonly accountRepository: IAccountRepository) {}

  async execute(dto: GetAccountByIdDto): Promise<Account> {
    const account = await this.accountRepository.findById(dto.id);
    if (!account) throw new AccountNotFoundException(dto.id);
    return account;
  }
}
