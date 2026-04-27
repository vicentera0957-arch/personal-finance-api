// DTO de respuesta — representa la categoría tal como el cliente la recibe.
// No expone nada de la implementación interna (VOs, ORM entity, etc.).
export class CategoryResponseDto {
  id: string;
  userId: string;
  name: string;
  nature: string;
  color: string | null;
  icon: string | null;
  createdAt: Date;
  updatedAt: Date;
}
