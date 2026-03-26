import { Category } from '../entities/category.entity';

// Puerto de salida definido como clase abstracta para que NestJS
// lo pueda usar como token de inyección de dependencias.
export abstract class ICategoryRepository {
  abstract findById(id: string): Promise<Category | null>;
  abstract findByUserId(userId: string): Promise<Category[]>;
  // Usado para validar duplicados antes de crear.
  abstract findByUserIdAndNameAndNature(
    userId: string,
    name: string,
    nature: string,
  ): Promise<Category | null>;
  abstract save(category: Category): Promise<Category>;
  abstract delete(id: string): Promise<void>;
}
