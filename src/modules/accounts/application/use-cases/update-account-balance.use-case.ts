import { IAccountRepository } from '../../domain/repository/accounts.repository';
import { Balance } from '../../domain/value-objects/balance.vo';
import { Account } from '../../domain/entities/account.entity';
import { AccountNotFoundException } from '../../domain/exceptions/account.exceptions';

// Internal collaborator — NOT a DI provider. Mutates the Account aggregate and MUST run inside a
// UoW with a scoped, row-locked repository (FOR UPDATE). Always built via `new(scopedRepo)` by
// Create/DeleteTransaction; never injected.
export class UpdateAccountBalanceUseCase {
  constructor(private readonly accountRepository: IAccountRepository) {}

  async execute(
    accountId: string,
    amount: number,
    type: 'inflow' | 'outflow',
  ): Promise<Account> {
    const account = await this.accountRepository.findById(accountId);

    if (!account) {
      throw new AccountNotFoundException(accountId);
    }

    const balance = Balance.create(amount);

    if (type === 'inflow') {
      account.inflow(balance);
    } else if (type === 'outflow') {
      account.outflow(balance);
    }

    return this.accountRepository.save(account);
  }
}
