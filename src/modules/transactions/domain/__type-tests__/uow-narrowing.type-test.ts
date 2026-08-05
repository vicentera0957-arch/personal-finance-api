// Regresión a nivel de tipos para PLAN-P5-narrow-ports.md §2 (la regla de
// estrechamiento). No emite JS — solo alias de tipo + `export {}` (requerido
// por `isolatedModules`). `tsconfig.build.json` excluye `test`/`**/*spec.ts`
// pero incluye `src/**/*.ts`, así que `npm run build` es el gate: si alguien
// vuelve a ensanchar un puerto escopado, esto deja de compilar.
//
// El punto de entrada es el tipo de las propiedades de `TCtx` (P3+P4 movió
// la superficie de "getter en el UoW" a "propiedad del contexto que run()
// entrega"), no un getter — ver PLAN-P5-narrow-ports.md §10.3.
import type { TransactionTxContext } from '../ITransactionUnitOfWork';
import type { AccountTxContext } from '../../../accounts/domain/IAccountUnitOfWork';

type Assert<T extends true> = T;
type Lacks<T, K extends string> = K extends keyof T ? false : true;

type TxBudgetReader = TransactionTxContext['budgetPeriodReader'];
type TxAccount = TransactionTxContext['accounts'];
type OwnAccount = AccountTxContext['accounts'];

// transactions no puede escribir ni borrar un budget dentro de su transacción (P5)
type _budgetNoSave = Assert<Lacks<TxBudgetReader, 'save'>>;
type _budgetNoDelete = Assert<Lacks<TxBudgetReader, 'delete'>>;
// transactions guarda la cuenta (invariante de balance) pero nunca la borra
type _accountNoDelete = Assert<Lacks<TxAccount, 'delete'>>;
// el UoW propio de accounts tampoco: DeleteAccount corre fuera del UoW
type _ownAccountNoDelete = Assert<Lacks<OwnAccount, 'delete'>>;

export {};
