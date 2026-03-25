import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { IAccountRepository } from '../domain/repository/accounts.repository';
import { Account } from '../domain/entities/account.entity';
import { Balance } from '../domain/value-objects/balance.vo';
import { AccountType } from '../domain/value-objects/type.vo';

interface CreateAccountDto {
  userId: string;
  name: string;
  type: string;
  initialBalance: number;
}

@Injectable()
export class CreateAccountUseCase {
  constructor(private readonly accountRepository: IAccountRepository) {}

  async execute(dto: CreateAccountDto): Promise<Account> {
    const type = AccountType.create(dto.type);
    const initialBalance = Balance.create(dto.initialBalance);

    const account = Account.create({
      id: randomUUID(),
      userId: dto.userId,
      name: dto.name,
      type,
      initialBalance,
    });

    return this.accountRepository.save(account);
  }
}
