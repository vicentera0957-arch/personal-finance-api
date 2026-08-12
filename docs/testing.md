# Testing

How this project is tested and the conventions to follow. Consolidates the former
`testing-conventions.md` and `unit-testing-guide.md`.

## Philosophy

```
        /\
       /  \   Integration → real Postgres + real HTTP + real locks.
      /----\               Tests the WIRING and what only the DB can prove.
     /      \
    /  Unit  \  Unit → no DB, no HTTP, with test doubles. Milliseconds.
   /----------\          Tests YOUR logic in isolation.
```

**Golden rule:** a unit test exercises *a decision you wrote*. If it needs a database,
it's misplaced. If it only proves "the framework does its job" (the ORM persists), it's
noise — integration covers that. **Cover by risk, not by method**: write tests where
logic can break silently, not one per public method.

## What each layer tests

| Layer | What | Doubles | Example spec |
| --- | --- | --- | --- |
| **Domain** (entities, VOs) | invariants, pure logic | **none** | `amount.vo.spec.ts`, `transaction.entity.spec.ts` |
| **Application** (use cases) | orchestration: read → decide → write → commit | **InMemory fakes** (+ `jest.fn` for thin adapters) | `create-account.use-case.spec.ts`, `refresh-token.use-case.spec.ts` |
| **Infrastructure** | mappers, repo error translation, controller exception→HTTP mapping | `jest.fn` or direct construction | `account.mapper.spec.ts`, `accounts.controller.spec.ts` |

## Test doubles — the key decision

| Collaborator | Double | Why |
| --- | --- | --- |
| Repos / stateful ports (`IXRepository`, `IUnitOfWork`, `IExpenseChecker`) | **InMemory fake** | has memory: `save` then `find` returns it; the test reads like a story |
| Thin one-call adapters (`IPasswordHasher`, `ITokenProvider`) | **`jest.fn`** | faking a whole implementation would be over-engineering |
| When the point *is* the interaction (idempotency, fail-fast) | **`jest.spyOn` on the fake** | keeps the fake's state and asserts "called / not called" |

**Why fakes over mocks.** A `jest.fn` has no memory: for a multi-step use case
(find → modify → save → maybe find again) you'd script each return and assert call order
— brittle, and it tests *implementation*, not *behavior*. An InMemory fake extends the
same port as the real impl, backed by a `Map`, so the test asserts **state** ("the old
token is revoked", "there are 2 tokens") and **choreography** (`uow.commits() === 1`),
not "save was called".

Fakes live in each module's `__fakes__/`: `InMemoryAccountRepository`,
`InMemoryBudgetRepository`, `InMemoryCategoryRepository`, `InMemoryTransactionRepository`,
`InMemoryUserRepository`, `InMemoryUnitOfWork`, `InMemoryRefreshTokenRepository`,
`InMemoryAuthUnitOfWork`. Domain factories in `src/test-support/factories`
(`makeAccount`, `makeUser`, …) build valid entities in one line.

## Conventions

- **Language:** English in `describe` / `it` / comments. (Domain values like `'expense'`
  stay as-is — they're data, not labels.)
- **Naming:** `describe('<Subject>')` = the class/VO/endpoint under test; nested
  `describe('<method>')` for VOs/entities; `it('<observable behavior>')` —
  `'rejects an expense over the budget limit'`, not `'calls findById'`.
- **One behavior per `it`.** If the title has an "and", it's probably two cases.
- **AAA** (Arrange · Act · Assert) — label with comments only when the test is long
  enough to need it.
- **No conditional logic in tests** (`if`/`for` that change assertions), except the
  documented race pattern with two valid outcomes.

### Integration template (`test/integration/**/*.integration.spec.ts`)

Reference shape is `transactions.integration.spec.ts`: real app via `createTestApp`,
`cleanDatabase` in `beforeEach`, supertest, one `// ===` banner per endpoint/rule with a
one-line *why it's integration*. For concurrency: `Promise.all` + assert on the **derived
final state** (not just status) + `not.toBe(500)` (a 500 means a real inconsistency).

## What unit tests do NOT cover (→ integration)

- Pessimistic locks / concurrency — fakes have no `FOR UPDATE`; the fake UoW only counts
  commits. Races run against real Postgres.
- FKs, unique constraints, real `catch 23505/23503` — unit tests the *translation* of the
  error; that the error *happens* is proven by the DB.
- Migrations / schema, real HTTP wiring, the global guard, prefix, end-to-end DTO validation.

## Commands

```bash
npm test                                  # all unit tests (no DB)
npm test -- --testPathPattern "accounts"  # only specs whose path matches
npm test -- -t "rotates correctly"        # only tests whose name matches
npm run test:cov                          # coverage (gated in CI)
npm run test:integration                  # integration (needs Postgres + Redis)
```

Unit uses the Jest config in `package.json` (rootDir `src`). Integration uses
`test/jest-integration.json`. Coverage thresholds are enforced in CI — the domain layer
is gated at **95% lines / 90% functions**.

## Current state

**635 unit tests across 78 suites** and **107 integration tests across 12 specs**, all
green (verified 2026-08-10). The integration specs:

| Spec | Proves |
| --- | --- |
| `auth`, `users`, `accounts`, `categories`, `budgets`, `transactions` | Real HTTP wiring, guards, DTO validation, FK and unique constraints, exception→status mapping |
| `concurrency/concurrency` | The seven closed races, against real row locks. Treat as the oracle — these must keep passing **unmodified** |
| `concurrency/rollback-guard` | Real TypeORM transaction-flag semantics that a mocked `QueryRunner` can't reproduce — `commitTransaction()` flips `isTransactionActive`, a second `rollbackTransaction()` throws — and that all four UoW impls honour `run()`'s lifecycle against a real DB |
| `di-scope` | No provider in the graph is request-scoped; the seven domain controllers resolve once per process |
| `reports/reports` | `GET /reports/summary`, including the empty period returning zeros with a 200 |
| `reports/summary-enforcement-equivalence` | The reporting path and the budget-enforcement path agree on "what counts as an expense" — both read `v_period_expenses` |
| `metrics/metrics` | `/metrics` is exposed, public, and records the HTTP histogram |
