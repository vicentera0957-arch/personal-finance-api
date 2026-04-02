import { Injectable } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import { IAccountRepository } from '../../domain/repository/accounts.repository';
import { Balance } from '../../domain/value-objects/balance.vo';
import { Account } from '../../domain/entities/account.entity';
import { AccountNotFoundException } from '../../domain/exceptions/account.exceptions';

@Injectable()
export class UpdateAccountBalanceUseCase {
  constructor(private readonly accountRepository: IAccountRepository) {}

  async execute(
    accountId: string,
    amount: number,
    type: 'inflow' | 'outflow',
    queryRunner?: QueryRunner,
  ): Promise<Account> {
    const account = await this.accountRepository.findById(accountId);

    if (!account) {
      throw new AccountNotFoundException(accountId);
    }

    const balance = Balance.create(amount);

    // Pasa por los métodos de la entidad — aplicar TODAS las validaciones
    if (type === 'inflow') {
      account.inflow(balance);
    } else if (type === 'outflow') {
      account.outflow(balance);
    }

    return this.accountRepository.save(account, queryRunner);
  }
}
