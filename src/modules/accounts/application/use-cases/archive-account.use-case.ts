import { Injectable } from '@nestjs/common';
import { IAccountUnitOfWork } from '../../domain/IAccountUnitOfWork';
import { Account } from '../../domain/entities/account.entity';
import { AccountNotFoundException } from '../../domain/exceptions/account.exceptions';
import { ResourceOwnershipException } from '../../../../shared/domain/exceptions/resource-ownership.exception';

interface ArchiveAccountDto {
  id: string;
  requestUserId: string;
}

@Injectable()
export class ArchiveAccountUseCase {
  constructor(private readonly uow: IAccountUnitOfWork) {}

  async execute(dto: ArchiveAccountDto): Promise<Account> {
    // Open the transaction: grabs a dedicated connection (QueryRunner) for this request.
    await this.uow.begin();
    try {
      const accountRepo = this.uow.getAccountRepository();

      // LOCK (FOR UPDATE): account row. The lock lives inside the scoped repo's findById().
      // Competes for the same row lock as CreateTransaction/DeleteTransaction (Race 2),
      // so a balance mutation and this state change can't interleave.
      const account = await accountRepo.findById(dto.id);
      if (!account) throw new AccountNotFoundException(dto.id);
      if (account.userId !== dto.requestUserId)
        throw new ResourceOwnershipException(dto.id);

      account.archive();
      const saved = await accountRepo.save(account);
      await this.uow.commit();
      return saved;
    } catch (error) {
      await this.uow.rollback();
      throw error;
    } finally {
      await this.uow.release();
    }
  }
}
