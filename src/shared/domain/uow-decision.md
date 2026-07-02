# Unit of Work — design decisions

Level 1 - Generic contract (shared/domain/IUnitOfWork.ts)
Defines only the transactional lifecycle (begin, commit, rollback, release, isActive). It knows nothing about repos. It lives in shared because "having a DB transaction" is cross-cutting; it belongs to no bounded context.

Level 2 - Per-module port (<module>/domain/I<Module>UnitOfWork.ts)
Each module that needs atomicity defines its own port that extends IUnitOfWork and adds getters for the repos that flow needs - including repos of other modules it consumes (not just its own).

Example: ITransactionUnitOfWork exposes getTransactionRepository() + getAccountRepository() + getBudgetRepository() because CreateTransaction maintains invariants that touch all three tables in a single PostgreSQL transaction.

This port lives in the consumer module's domain/ ("port owned by consumer" pattern), even though it returns repo interfaces of other modules. Those repo interfaces are those of their owning module's domain (e.g. IAccountRepository still belongs to accounts/domain); the UoW merely exposes them grouped according to what the use case needs.

Level 3 - Single implementation (infrastructure/persistence/unit-of-work.impl.ts)
A single class TypeOrmUnitOfWorkImpl that satisfies every UoW port whose getters it knows how to serve. It is wired in NestJS with useExisting, pointing all the ports to the same request-scoped provider -> same instance, same QueryRunner, same DB transaction within a request.

How the use case consumes it (reference: create-transaction.use-case.ts:30)

It injects its own module's port (ITransactionUnitOfWork), never the generic IUnitOfWork nor the concrete impl.
begin() -> asks the UoW for the repos (which are ScopedXRepository sharing the QueryRunner's EntityManager) -> operates -> commit() / rollback() in try/catch -> release() in finally.
The pessimistic locks (FOR UPDATE) live inside the scoped repos, not in the use case - the use case only trusts that findById under the UoW serializes per aggregate.

Additional notes (why this decision matters)

- Avoids coupling the use cases to TypeORM or DataSource; the domain knows only ports.
- Enables consistent transactions in flows that cross modules without breaking the dependency rule.
- Keeps a single QueryRunner per request, avoiding nested transactions and partial states.
- Makes the combination of repos each use case requires explicit, easing testing and reasoning.
