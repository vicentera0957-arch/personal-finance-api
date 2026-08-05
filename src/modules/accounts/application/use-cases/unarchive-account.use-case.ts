import { Injectable } from '@nestjs/common';
import { IAccountUnitOfWork } from '../../domain/IAccountUnitOfWork';
import { Account } from '../../domain/entities/account.entity';
import { AccountNotFoundException } from '../../domain/exceptions/account.exceptions';
import { ResourceOwnershipException } from '../../../../shared/domain/exceptions/resource-ownership.exception';

interface UnarchiveAccountDto {
  id: string;
  requestUserId: string;
}

@Injectable()
export class UnarchiveAccountUseCase {
  constructor(private readonly uow: IAccountUnitOfWork) {}

  async execute(dto: UnarchiveAccountDto): Promise<Account> {
    return this.uow.run(async (ctx) => {
      // LOCK (FOR UPDATE): account row. The lock lives inside the scoped repo's findByIdWithLock().
      // Competes for the same row lock as CreateTransaction/DeleteTransaction (Race 2),
      // so a balance mutation and this state change can't interleave.
      const account = await ctx.accounts.findByIdWithLock(dto.id);
      if (!account) throw new AccountNotFoundException(dto.id);
      if (account.userId !== dto.requestUserId)
        throw new ResourceOwnershipException(dto.id);

      account.unarchive();
      const saved = await ctx.accounts.save(account);
      return saved;
    });
  }
}
