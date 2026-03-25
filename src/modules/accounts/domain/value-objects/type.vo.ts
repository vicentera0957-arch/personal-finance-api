// esto es un vo, debe ser:
// Inmutable: una vez creado, no se puede cambiar su estado interno.
// Validado: el valor debe ser validado en el momento de la creación para asegurar que siempre esté en un estado válido.
// Comparable: debe ser posible comparar dos instancias del Value Object para determinar si son iguales o no.

export class AccountType {
  private readonly tipo: string;

  private constructor(tipo: string) {
    //inmutable
    this.tipo = tipo;
  }
  // eligo aca un array en vez de un set, incluso usando o(n) en vez de o(1)
  // Los arrays ocupan bloques de memoria contiguos, lo que puede mejorar la localización de datos y el rendimiento en algunos casos. Además, para un número pequeño de elementos, la diferencia de rendimiento entre un array y un set es insignificante.
  private static readonly tiposValidos = [
    'ahorro',
    'corriente',
    'vista',
    'ruta',
    'otros',
  ];

  static create(tipo: string): AccountType {
    if (!tipo || tipo.trim().length === 0) {
      throw new Error('El tipo de cuenta no puede estar vacío');
    }

    const tipoNormalizado = tipo.trim().toLowerCase();
    //verificacion si el tipo esta dentro de los validos
    if (!this.tiposValidos.includes(tipoNormalizado)) {
      throw new Error('El tipo de cuenta no es válido');
    }

    return new AccountType(tipoNormalizado);
  }

  getType(): string {
    return this.tipo;
  }
  equals(other: AccountType): boolean {
    return this.tipo === other.tipo;
  }
}
