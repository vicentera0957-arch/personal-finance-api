# Auditoria de Value Objects — reconstitute()

Fecha: 2026-04-03

## VOs CON `reconstitute()`

| VO | Modulo | Firma | Archivo |
|---|---|---|---|
| Balance | accounts | `reconstitute(value: number)` | `src/modules/accounts/domain/value-objects/balance.vo.ts` |
| AccountType | accounts | `reconstitute(tipo: string)` | `src/modules/accounts/domain/value-objects/type.vo.ts` |
| CategoryNature | categories | `reconstitute(value: string)` | `src/modules/categories/domain/value-objects/category-nature.vo.ts` |
| AmountLimit | budgets | `reconstitute(value: number)` | `src/modules/budgets/domain/amountlimit.vo.ts` |
| Amount | transactions | `reconstitute(value: number)` | `src/modules/transactions/domain/value-objects/amount.vo.ts` |
| TransactionNature | transactions | `reconstitute(value: string)` | `src/modules/transactions/domain/value-objects/transaction-nature.vo.ts` |

## VOs SIN `reconstitute()`

| VO | Modulo | Motivo | Archivo |
|---|---|---|---|
| Email | users | Intencional — re-validar en cada hidratacion es aceptable y barato | `src/modules/users/domain/value-objects/email.vo.ts` |

## Notas

- `reconstitute()` omite validacion para hidratar desde la DB sin penalizacion ni riesgo de romper datos existentes ante cambios de reglas.
- `Email` no lo necesita porque la re-validacion con regex es barata y garantiza integridad.
