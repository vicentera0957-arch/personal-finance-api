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
