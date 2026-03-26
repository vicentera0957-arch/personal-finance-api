import { Injectable } from '@nestjs/common';
import { Category } from '../../domain/entities/category.entity';
import { CategoryNature } from '../../domain/value-objects/category-nature.vo';
import { CategoryOrmEntity } from './category.orm.entity';

// El mapper es el único lugar que conoce tanto el dominio como la persistencia.
// Ni el controlador ni los use cases tocan el ORM entity directamente.
@Injectable()
export class CategoryMapper {
  toDomain(orm: CategoryOrmEntity): Category {
    // Reconstituye el VO de naturaleza desde el string guardado en la DB
    const nature = CategoryNature.create(orm.nature);

    return Category.reconstitute({
      id: orm.id,
      userId: orm.userId,
      name: orm.name,
      nature,
      isBudgetable: orm.isBudgetable,
      color: orm.color ?? undefined,
      icon: orm.icon ?? undefined,
      createdAt: orm.createdAt,
      updatedAt: orm.updatedAt,
    });
  }

  toOrm(domain: Category): CategoryOrmEntity {
    const orm = new CategoryOrmEntity();
    orm.id = domain.id;
    orm.userId = domain.userId;
    orm.name = domain.getName();
    orm.nature = domain.nature.getValue();
    orm.isBudgetable = domain.getIsBudgetable();
    orm.color = domain.getColor();
    orm.icon = domain.getIcon();
    orm.createdAt = domain.createdAt;
    orm.updatedAt = domain.getUpdatedAt();
    return orm;
  }
}
