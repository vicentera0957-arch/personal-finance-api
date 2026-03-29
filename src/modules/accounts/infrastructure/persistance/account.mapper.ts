import { Injectable } from '@nestjs/common';
//domain
import { Account } from '../../domain/entities/account.entity';
import { Balance } from '../../domain/value-objects/balance.vo';
import { AccountType } from '../../domain/value-objects/type.vo';
//orm
import { AccountOrmEntity } from './account.orm.entity';

@Injectable()
export class AccountMapper {
  toDomain(orm: AccountOrmEntity): Account {
    const type = AccountType.create(orm.type);
    //usamos reconstitute para evitar validaciones innecesarias
    // y tambien para flexibilizarnos a posibles cambios de dominio a futuro.
    const initialBalance = Balance.reconstitute(orm.initialBalance);
    const currentBalance = Balance.reconstitute(orm.currentBalance);
    return Account.reconstitute({
      id: orm.id,
      userId: orm.userId,
      name: orm.name,
      type: type,
      initialBalance: initialBalance,
      currentBalance: currentBalance,
      isArchived: orm.isArchived,
      createdAt: orm.createdAt,
      updatedAt: orm.updatedAt,
    });
  }
  toOrm(domain: Account): AccountOrmEntity {
    const orm = new AccountOrmEntity();
    orm.id = domain.id;
    orm.userId = domain.userId;
    orm.name = domain.getName();
    orm.type = domain.type.getType();
    orm.initialBalance = domain.getInitialBalance().getValue();
    orm.currentBalance = domain.getCurrentBalance().getValue();
    orm.isArchived = domain.getIsArchived();
    orm.createdAt = domain.createdAt;
    orm.updatedAt = domain.getUpdatedAt();
    return orm;
  }
}
