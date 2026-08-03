# Unit of Work — design decisions

Level 1 - Generic contract (shared/domain/IUnitOfWork.ts)
Defines only the transactional lifecycle (begin, commit, rollback, release, isConnected). It knows nothing about repos. It lives in shared because "having a DB transaction" is cross-cutting; it belongs to no bounded context.

Level 2 - Per-module port (<module>/domain/I<Module>UnitOfWork.ts)
Each module that needs atomicity defines its own port that extends IUnitOfWork and adds getters for the repos that flow needs - including repos of other modules it consumes (not just its own).

Example: ITransactionUnitOfWork exposes getTransactionRepository() + getAccountRepository() + getBudgetRepository() because CreateTransaction maintains invariants that touch all three tables in a single PostgreSQL transaction.

This port lives in the consumer module's domain/ ("port owned by consumer" pattern), even though it returns repo interfaces of other modules. Those repo interfaces are those of their owning module's domain (e.g. IAccountRepository still belongs to accounts/domain); the UoW merely exposes them grouped according to what the use case needs.

Level 3 - One implementation per transactional boundary
There is no single global impl. Each impl serves the ports whose flows share one boundary. As of the IBudgetUnitOfWork split, that is a 1:1 mapping across all four module-specific ports:

- TypeOrmUnitOfWorkImpl (transactions/infrastructure/persistence/unit-of-work.impl.ts) - serves ITransactionUnitOfWork only. It used to also serve IBudgetUnitOfWork (wired with useExisting so both pointed at the same request-scoped provider -> same instance, same QueryRunner, same DB transaction within a request) - that sharing was only ever required by CreateTransaction, the one flow that takes several scoped repos at once, and UpdateBudgetLimit/DeleteBudget never needed it. It still composes the account and budget scoped repos internally (via the accounts and budgets factories) because CreateTransaction/DeleteTransaction are genuinely multi-aggregate.
- BudgetUnitOfWorkImpl (budgets/infrastructure/persistence/budget-unit-of-work.impl.ts) - serves IBudgetUnitOfWork. UpdateBudgetLimit/DeleteBudget touch only the budget aggregate (+ one aggregate expense read), so budgets owns its boundary and imports nothing beyond categories.
- AccountUnitOfWorkImpl (accounts/infrastructure/persistence/account-unit-of-work.impl.ts) - serves IAccountUnitOfWork. Archive/Unarchive/Rename touch only the account aggregate, so accounts owns its boundary and imports nothing.
- AuthUnitOfWorkImpl (auth/infrastructure/persistence/auth-unit-of-work.impl.ts) - serves IAuthUnitOfWork. Refresh-token rotation touches only refresh_tokens.

The rule: a module whose transactional flows touch only its own aggregate owns its impl. Serving another module's UoW token from your own module is what created the accounts <-> transactions cycle and, later, the budgets <-> transactions cycle - both now removed. There are zero forwardRef() calls left in the module graph.

Note what useExisting does NOT buy. Scope.REQUEST already means one instance per request, so two concurrent requests always had distinct QueryRunners. Cross-request serialization comes from the Postgres row lock, not from a shared instance - which is exactly why splitting the impl costs no concurrency guarantee.

Scoped repos needed by more than one impl (ScopedAccountRepository) stay unexported and are reached through a factory that takes a QueryRunner, not an EntityManager, so passing dataSource.manager does not compile.

How the use case consumes it (reference: create-transaction.use-case.ts:30)

It injects its own module's port (ITransactionUnitOfWork), never the generic IUnitOfWork nor the concrete impl.
begin() -> asks the UoW for the repos (which are ScopedXRepository sharing the QueryRunner's EntityManager) -> operates -> commit() / rollback() in try/catch -> release() in finally.
The pessimistic locks (FOR UPDATE) live inside the scoped repos, not in the use case - the use case only trusts that findById under the UoW serializes per aggregate.

Additional notes (why this decision matters)

- Avoids coupling the use cases to TypeORM or DataSource; the domain knows only ports.
- Enables consistent transactions in flows that cross modules without breaking the dependency rule.
- Keeps a single QueryRunner per request, avoiding nested transactions and partial states.
- Makes the combination of repos each use case requires explicit, easing testing and reasoning.
