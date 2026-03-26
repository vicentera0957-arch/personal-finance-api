import { CategoryNature } from '../value-objects/category-nature.vo';

// Props para crear una categoría nueva — sin fechas, las genera la entidad.
interface CreateCategoryProps {
  id: string;
  userId: string;
  name: string;
  nature: CategoryNature;
  isBudgetable: boolean;
  color?: string;
  icon?: string;
}

// Props para reconstituir desde persistencia — incluye fechas originales.
interface ReconstituteCategoryProps extends CreateCategoryProps {
  createdAt: Date;
  updatedAt: Date;
}

export class Category {
  private constructor(
    public readonly id: string,
    public readonly userId: string,
    private name: string,
    public readonly nature: CategoryNature, // inmutable — ver notas.md
    private isBudgetable: boolean,
    private color: string | null,
    private icon: string | null,
    public readonly createdAt: Date,
    private updatedAt: Date,
  ) {}

  // Factory para categorías nuevas.
  static create(props: CreateCategoryProps): Category {
    const now = new Date();
    return new Category(
      props.id,
      props.userId,
      props.name,
      props.nature,
      props.isBudgetable,
      props.color ?? null,
      props.icon ?? null,
      now,
      now,
    );
  }

  // Factory para reconstruir desde la base de datos.
  static reconstitute(props: ReconstituteCategoryProps): Category {
    return new Category(
      props.id,
      props.userId,
      props.name,
      props.nature,
      props.isBudgetable,
      props.color ?? null,
      props.icon ?? null,
      props.createdAt,
      props.updatedAt,
    );
  }

  // ============================================
  // Métodos de negocio
  // ============================================

  // Renombra la categoría. No se puede dejar vacío.
  rename(name: string): void {
    if (!name || name.trim().length === 0) {
      throw new Error('El nombre de la categoría no puede estar vacío');
    }
    this.name = name.trim();
    this.updatedAt = new Date();
  }

  // Actualiza el color visual de la categoría (para la UI).
  changeColor(color: string): void {
    this.color = color;
    this.updatedAt = new Date();
  }

  // Actualiza el ícono visual de la categoría (para la UI).
  changeIcon(icon: string): void {
    this.icon = icon;
    this.updatedAt = new Date();
  }

  // Controla si la categoría puede ser objetivo de un presupuesto.
  setBudgetable(value: boolean): void {
    this.isBudgetable = value;
    this.updatedAt = new Date();
  }

  // ============================================
  // Getters
  // ============================================

  getName(): string {
    return this.name;
  }

  getIsBudgetable(): boolean {
    return this.isBudgetable;
  }

  getColor(): string | null {
    return this.color;
  }

  getIcon(): string | null {
    return this.icon;
  }

  getUpdatedAt(): Date {
    return this.updatedAt;
  }
}
