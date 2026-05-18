import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

// Todos los campos son opcionales — el cliente solo envía lo que quiere cambiar.
// Nota: 'nature' intencionalmente excluida — no se puede cambiar la naturaleza
// de una categoría existente (ver notas.md para la justificación).
export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  color?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  icon?: string;
}
