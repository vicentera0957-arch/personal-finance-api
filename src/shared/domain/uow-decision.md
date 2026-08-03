# Unit of Work — design decisions

> **Updated after PLAN-P3P4-transactional-runner.md (P3+P4).** The UoW used to be a stateful
> object: `begin`/`commit`/`rollback`/`release`/`isConnected`, a mutable `QueryRunner` field, and
> `Scope.REQUEST` on every provider to keep that field from leaking across requests. It is now a
> stateless runner: one method, `run<T>(work)`, with the `QueryRunner` living on the call stack of
> that single call instead of in a field. Every UoW provider is a plain singleton. The three
> "levels" below still describe the right mental model — only the shape of Level 1 and the
> "getters" language in Level 2 changed.

Level 1 - Generic contract (shared/domain/IUnitOfWork.ts)
Defines only `run<T>(work: (ctx: TCtx) => Promise<T>): Promise<T>`. It knows nothing about repos — `TCtx` is a type parameter, supplied by each module's port. It lives in shared because "having a DB transaction" is cross-cutting; it belongs to no bounded context. The lifecycle itself (connect → start transaction → `work(ctx)` → commit/rollback → release) lives in exactly one place, `TypeOrmTransactionRunner` (shared/infrastructure/persistence/typeorm-transaction-runner.ts), which every concrete impl extends.

Level 2 - Per-module port (<module>/domain/I<Module>UnitOfWork.ts)
Each module that needs atomicity defines its own port that extends IUnitOfWork<TCtx> for its own `TCtx` — a plain interface (not a DI token; see the docblock on IUnitOfWork for why that's fine) listing the repos that module's flows need as **properties**, not getters — including repos of other modules it consumes (not just its own). The port itself declares no members beyond the inherited `run()`; the module-specific surface lives entirely in `TCtx`.

Example: `TransactionTxContext` (the `TCtx` for `ITransactionUnitOfWork`) exposes `transactions` + `accounts` + `budgets` as read-only properties, because CreateTransaction maintains invariants that touch all three tables in a single PostgreSQL transaction.

`TCtx` lives in the consumer module's domain/ ("port owned by consumer" pattern), even though its properties are repo interfaces of other modules. Those repo interfaces are those of their owning module's domain (e.g. IAccountRepository still belongs to accounts/domain); the UoW's `createContext()` merely groups them according to what the use case needs.

Level 3 - One implementation per transactional boundary
There is no single global impl. Each impl serves the port whose flows share one boundary, `extends TypeOrmTransactionRunner<TCtx>` for its own `TCtx`, and `implements I<Module>UnitOfWork` (valid because that port has no members beyond `run()`). That is a 1:1 mapping across all four module-specific ports:

- TypeOrmUnitOfWorkImpl (transactions/infrastructure/persistence/unit-of-work.impl.ts) - serves ITransactionUnitOfWork only. It used to also serve IBudgetUnitOfWork (wired with useExisting so both pointed at the same request-scoped provider -> same instance, same QueryRunner, same DB transaction within a request) - that sharing was only ever required by CreateTransaction, the one flow that takes several scoped repos at once, and UpdateBudgetLimit/DeleteBudget never needed it. It still composes the account and budget scoped repos internally (via the accounts and budgets factories, inside `createContext()`) because CreateTransaction/DeleteTransaction are genuinely multi-aggregate.
- BudgetUnitOfWorkImpl (budgets/infrastructure/persistence/budget-unit-of-work.impl.ts) - serves IBudgetUnitOfWork. UpdateBudgetLimit/DeleteBudget touch only the budget aggregate (+ one aggregate expense read), so budgets owns its boundary and imports nothing beyond categories.
- AccountUnitOfWorkImpl (accounts/infrastructure/persistence/account-unit-of-work.impl.ts) - serves IAccountUnitOfWork. Archive/Unarchive/Rename touch only the account aggregate, so accounts owns its boundary and imports nothing.
- AuthUnitOfWorkImpl (auth/infrastructure/persistence/auth-unit-of-work.impl.ts) - serves IAuthUnitOfWork. Refresh-token rotation touches only refresh_tokens.

The rule: a module whose transactional flows touch only its own aggregate owns its impl. Serving another module's UoW token from your own module is what created the accounts <-> transactions cycle and, later, the budgets <-> transactions cycle - both now removed. There are zero forwardRef() calls left in the module graph.

Note what useExisting used to buy, and what it never bought. `Scope.REQUEST` used to mean one instance per request, so two concurrent requests always had distinct QueryRunners regardless of instance sharing. Cross-request serialization comes from the Postgres row lock, not from a shared instance - which is exactly why splitting the impl cost no concurrency guarantee, and why later removing `Scope.REQUEST` entirely (P3+P4) cost none either: every provider is now a singleton, and `run()` opens a fresh `QueryRunner` per call regardless of how many concurrent callers share the same singleton instance.

Scoped repos needed by more than one impl (ScopedAccountRepository) stay unexported and are reached through a factory that takes a QueryRunner, not an EntityManager, so passing dataSource.manager does not compile.

How the use case consumes it (reference: create-transaction.use-case.ts)

It injects its own module's port (ITransactionUnitOfWork), never the generic IUnitOfWork nor the concrete impl, and calls `uow.run(async (ctx) => { ... })`. Inside the callback it reads the repos off `ctx` (properties like `ctx.accounts`, sharing the active QueryRunner's EntityManager), operates, and returns a value or throws. `TypeOrmTransactionRunner.run()` commits on a clean return and rolls back on a thrown error, always releasing in a `finally` — the use case never calls `commit()`/`rollback()`/`release()` itself; there is nothing left to call.
The pessimistic locks (FOR UPDATE) live inside the scoped repos, not in the use case - the use case only trusts that findById under the UoW serializes per aggregate.

Additional notes (why this decision matters)

- Avoids coupling the use cases to TypeORM or DataSource; the domain knows only ports.
- Enables consistent transactions in flows that cross modules without breaking the dependency rule.
- Keeps a single QueryRunner per `run()` call, avoiding nested transactions and partial states — enforced now by `activeTransaction` (an AsyncLocalStorage nesting detector), not by instance scope.
- Makes the combination of repos each use case requires explicit, easing testing and reasoning.
