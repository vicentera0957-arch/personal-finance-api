import { Injectable } from '@nestjs/common';
import { IAccountRepository } from '../../domain/repository/accounts.repository';
import { GetAccountByIdUseCase } from './get-account-by-id.use-case';

interface DeleteAccountDto {
  id: string;
  requestUserId: string;
}

@Injectable()
export class DeleteAccountUseCase {
  constructor(
    private readonly accountRepository: IAccountRepository,
    private readonly getAccountByIdUseCase: GetAccountByIdUseCase,
  ) {}

  async execute(dto: DeleteAccountDto): Promise<void> {
    await this.getAccountByIdUseCase.execute({
      id: dto.id,
      requestUserId: dto.requestUserId,
    }); // verifica que existe
    await this.accountRepository.delete(dto.id);
  }
}
