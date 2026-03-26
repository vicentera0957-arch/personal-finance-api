import { Injectable } from '@nestjs/common';
import { IAccountRepository } from '../../domain/repository/accounts.repository';
import { Account } from '../../domain/entities/account.entity';
import { GetAccountByIdUseCase } from './get-account-by-id.use-case';

interface RenameAccountDto {
  id: string;
  name: string;
}

@Injectable()
export class RenameAccountUseCase {
  constructor(
    private readonly accountRepository: IAccountRepository,
    private readonly getAccountByIdUseCase: GetAccountByIdUseCase,
  ) {}

  async execute(dto: RenameAccountDto): Promise<Account> {
    const account = await this.getAccountByIdUseCase.execute({ id: dto.id });
    account.rename(dto.name); // la entidad lanza AccountArchivedException si está archivada
    return this.accountRepository.save(account);
  }
}
