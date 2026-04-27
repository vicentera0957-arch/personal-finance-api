# Reglas de Dominio

## Categorías

### Presupuestabilidad Derivada de Naturaleza

**Regla:** Solo las categorías de naturaleza `expense` pueden asociarse a presupuestos (`Budget`) y a transacciones de gasto que requieren presupuesto.

Las categorías `income` **nunca** son presupuestables.

**Implementación:** Esta invariante se deriva directamente de `category.nature.getValue() === 'expense'` y **no requiere un campo adicional `isBudgetable`**.

**Razón:** El campo `isBudgetable` era redundante con `nature`. Duplicaba información y obligaba a mantener dos invariantes sincronizados a través de excepciones de dominio (`CategoryBudgetableImmutableException`). Al eliminar el campo, el modelo es más simple: la naturaleza es la única fuente de verdad sobre presupuestabilidad.

### Validaciones en Presupuestos

En `CreateBudgetUseCase`:
- Valida que `nature === 'expense'` (rechaza `income` con `BudgetCategoryMustBeExpenseException`).
- Si llegó aquí, la categoría es presupuestable por definición.

En `CreateTransactionUseCase` (para transacciones de gasto):
- Valida que `nature === 'expense'` (rechaza incompatibilidad con `IncompatibleCategoryNatureException`).
- Requiere un presupuesto existente (rechaza ausencia con `BudgetRequiredForExpenseTransactionException`).
- Si pasó el check de naturaleza, la categoría es presupuestable.
