import { Injectable } from '@nestjs/common';
import { IAccountRepository } from '../../domain/repository/accounts.repository';
import { Account } from '../../domain/entities/account.entity';
import { GetAccountByIdUseCase } from './get-account-by-id.use-case';

interface UnarchiveAccountDto {
  id: string;
  requestUserId: string;
}

@Injectable()
export class UnarchiveAccountUseCase {
  constructor(
    private readonly accountRepository: IAccountRepository,
    private readonly getAccountByIdUseCase: GetAccountByIdUseCase,
  ) {}

  async execute(dto: UnarchiveAccountDto): Promise<Account> {
    const account = await this.getAccountByIdUseCase.execute({
      id: dto.id,
      requestUserId: dto.requestUserId,
    });
    account.unarchive(); // la entidad lanza error si no está archivada
    return this.accountRepository.save(account);
  }
}
