// Base abstracta para todas las excepciones del dominio de categorías.
// Extienden Error, NO HttpException — el mapeo a HTTP ocurre en el controlador.
export abstract class CategoryException extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

// Se lanza cuando no se encuentra una categoría por su id.
export class CategoryNotFoundException extends CategoryException {
  constructor(id: string) {
    super(`Categoría no encontrada: ${id}`);
  }
}

// Se lanza cuando ya existe una categoría con el mismo nombre y naturaleza para ese usuario.
// Regla de negocio: evitar duplicados semánticos (ej: dos "Supermercado" expense).
export class DuplicateCategoryException extends CategoryException {
  constructor(name: string, nature: string) {
    super(
      `Ya existe una categoría con el nombre "${name}" y naturaleza "${nature}" para este usuario`,
    );
  }
}
export class InvalidCategoryNameException extends CategoryException {
  constructor(name: string) {
    super(`El nombre "${name}" no es valido`);
  }
}

export class InvalidCategoryColorException extends CategoryException {
  constructor(color: string) {
    super(`El color "${color}" no es válido`);
  }
}

export class InvalidCategoryIconException extends CategoryException {
  constructor(icon: string) {
    super(`El ícono "${icon}" no es válido`);
  }
}

// Se lanza cuando se intenta eliminar una categoría que tiene transacciones asociadas.
// El FK constraint de la DB lanza error 23503 — se captura en el repositorio.
export class CategoryInUseException extends CategoryException {
  constructor(id: string) {
    super(
      `No se puede eliminar la categoría ${id} porque tiene transacciones asociadas`,
    );
  }
}

// Se lanza cuando la naturaleza no es "income" ni "expense".
export class InvalidCategoryNatureException extends CategoryException {
  constructor(value: string) {
    super(
      `La naturaleza de la categoría debe ser "income" o "expense". Recibido: "${value}"`,
    );
  }
}

// Se lanza cuando se intenta cambiar isBudgetable despues de crear la categoria.
export class CategoryBudgetableImmutableException extends CategoryException {
  constructor(id: string) {
    super(
      `No se puede modificar isBudgetable para la categoria ${id} despues de su creacion`,
    );
  }
}
