import { Injectable } from '@nestjs/common';
import { ITransactionRepository } from '../../domain/repository/transaction.repository';
import { GetTransactionByIdUseCase } from './get-transaction-by-id.use-case';
import { CannotDeleteTransactionException } from '../../domain/exceptions/transaction.exceptions';
import { GetAccountByIdUseCase } from '../../../accounts/application/use-cases/get-account-by-id.use-case';
import { IAccountRepository } from '../../../accounts/domain/repository/accounts.repository';
import { Balance } from '../../../accounts/domain/value-objects/balance.vo';

@Injectable()
export class DeleteTransactionUseCase {
  constructor(
    private readonly transactionRepository: ITransactionRepository,
    private readonly getTransactionByIdUseCase: GetTransactionByIdUseCase,
    private readonly getAccountByIdUseCase: GetAccountByIdUseCase,
    private readonly accountRepository: IAccountRepository,
  ) {}

  async execute(id: string): Promise<void> {
    // 1. Verifica que la transacción existe
    const transaction = await this.getTransactionByIdUseCase.execute(id);

    // 2. Recupera la cuenta para revertir el efecto en el balance
    const account = await this.getAccountByIdUseCase.execute({
      id: transaction.accountId,
    });

    const balanceAmount = Balance.create(transaction.amount.getValue());

    // 3. Revierte el efecto según la naturaleza:
    //    - income → se revierte con outflow (quitar lo que se añadió)
    //    - expense → se revierte con inflow (devolver lo que se restó)
    try {
      if (transaction.nature.isIncome()) {
        // Puede fallar si el saldo actual es menor que el monto del ingreso original
        account.outflow(balanceAmount);
      } else {
        // inflow siempre funciona — sumar nunca produce balance negativo
        account.inflow(balanceAmount);
      }
    } catch {
      // El outflow lanzó error de balance negativo — no se puede eliminar
      throw new CannotDeleteTransactionException(id);
    }

    // 4. Persiste la cuenta con el balance revertido
    await this.accountRepository.save(account);

    // 5. Elimina la transacción
    await this.transactionRepository.delete(id);
  }
}
