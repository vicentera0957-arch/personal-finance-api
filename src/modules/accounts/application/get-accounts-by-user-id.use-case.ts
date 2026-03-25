import { Injectable } from '@nestjs/common';
import { IAccountRepository } from '../domain/repository/accounts.repository';
import { Account } from '../domain/entities/account.entity';

interface GetAccountsByUserIdDto {
  userId: string;
}

@Injectable()
export class GetAccountsByUserIdUseCase {
  constructor(private readonly accountRepository: IAccountRepository) {}

  async execute(dto: GetAccountsByUserIdDto): Promise<Account[]> {
    return this.accountRepository.findByUserId(dto.userId);
  }
}
