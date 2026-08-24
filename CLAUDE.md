# CLAUDE.md

Operating brief for AI agents working in this repo. It is deliberately short: the
full reference lives in [`docs/conventions.md`](docs/conventions.md), and this file
only carries what an agent should have loaded on every turn.

**Read before writing code:**

| Doc | What it gives you |
| --- | --- |
| [`docs/conventions.md`](docs/conventions.md) | Patterns, rules, anti-patterns, exception→HTTP table, module summaries — the exhaustive reference |
| [`docs/architecture.md`](docs/architecture.md) | Layering, module graph, request flow (diagrams) |
| [`docs/concurrency-model.md`](docs/concurrency-model.md) | Unit of Work, lock map, serialization |
| [`docs/adr/`](docs/adr/) | Why each decision was taken |
| [`src/modules/`](src/modules/README.md) | Per-module design notes, co-located with the code |

> Older pointers in code comments and docs that name a **section of `CLAUDE.md`**
> (`"Locking & serialization map"`, `"Anti-patterns"`, `"Why IBudgetUnitOfWork is
> separate"`, …) refer to that section in `docs/conventions.md`, where the content
> now lives.

**When the code and a doc disagree, the code wins** — but open a PR to fix the doc in
the same change.

---

## Two traps that bite on day one

- **Local DB is on port 5433**, not 5432 (`docker-compose`; pgAdmin on 5051). Use
  `DB_PORT=5433` in `.env`. `test/.env.test` points there too — if the compose stack
  isn't up, every integration suite fails at bootstrap with an unrelated-looking error.
- **Schema comes from migrations.** `synchronize` is off by default and only creates
  tables from entities — **not** the `v_period_expenses` view, which has no entity and
  lives in a hand-written migration. Run `npm run migration:run`, and never accept a
  generated migration that drops or recreates that view.

## The rules that are never bent

One line each; the rationale, the exceptions and the history are in
[`docs/conventions.md`](docs/conventions.md) — that file is the authority.

- **Ports are `abstract class`, never `interface`.** They double as type and DI token;
  an `interface` is erased at compile time and breaks the DI graph.
- **`domain/` is pure.** No NestJS, no TypeORM, no HTTP imports. That prohibition is the
  whole point of the layer.
- **`userId` always comes from `@CurrentUser()`**, never from the body or the URL. This
  is a security rule, not a style preference.
- **Domain throws domain exceptions**, never `HttpException`; controllers map them. If
  you change a mapping, update the exception→HTTP table in the same PR
  ([`conventions.md`](docs/conventions.md#exception--http-mapping)).
- **Never inject `DataSource` in a use case.** Use the module's UoW port and extend its
  `TCtx` if it doesn't expose what you need.
- **Never read inside an open UoW with the global repository.** It runs on another
  connection, so the locks you think protect the invariant don't apply.
- **Never call `VO.create()` in a mapper.** Use `reconstitute()` so persisted data isn't
  re-validated.
- **Never declare a provider for another module's UoW token.** That is what created the
  module cycles that were removed; the graph has zero `forwardRef()` today.
- **Never reintroduce `isBudgetable` on `Category`.** Budgetability is derived from
  `nature === 'expense'`.
- **Never enable `synchronize` in production**, and never store refresh tokens in
  plaintext (always `sha256`).
- **Don't modify `test/integration/concurrency/concurrency.integration.spec.ts`.** It is
  the regression net for seven closed races; those scenarios must keep passing unmodified.

The full anti-pattern list, with the reasoning behind each one, is in
[`docs/conventions.md`](docs/conventions.md#anti-patterns--do-not-do).
