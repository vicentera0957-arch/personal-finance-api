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
    await this.uow.begin();
    try {
      const accountRepo = this.uow.getAccountRepository();

      const account = await accountRepo.findById(dto.id);
      if (!account) throw new AccountNotFoundException(dto.id);
      if (account.userId !== dto.requestUserId) throw new ResourceOwnershipException(dto.id);

      account.unarchive();
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
