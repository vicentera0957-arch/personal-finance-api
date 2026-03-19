Notas para distinguir entre el value object y entity. Segun mi criterio:

| Atributo         | Dónde          | Por qué                                         |
| ---------------- | -------------- | ----------------------------------------------- |
| `id`             | Entity         | Identidad única                                 |
| `userId`         | Entity         | Invariante — toda cuenta pertenece a un usuario |
| `name`           | Entity         | Atributo simple, validación básica              |
| `type`           | VO             | Conjunto cerrado de valores válidos             |
| `initialBalance` | VO → `Balance` | Siempre positivo, reglas propias, readonly      |
| `currentBalance` | VO → `Balance` | Siempre positivo, reglas propias, mutable       |
| `isArchived`     | Entity         | Atributo simple, comportamiento pendiente       |
| `createdAt`      | Entity         | Readonly, se genera al crear                    |
| `updatedAt`      | Entity         | Se actualiza en cada cambio                     |
