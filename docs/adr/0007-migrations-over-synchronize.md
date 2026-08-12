# ADR-0007: Schema via migrations, never `synchronize`

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Vicente Cristobal Rivas Avello

## Context and problem statement

TypeORM can auto-create the schema from entities (`synchronize: true`). It is
convenient in dev but destructive and non-deterministic for production data.

> Fact from the code: `synchronize` is opt-in only when `DB_SYNCHRONIZE=true` **and**
> `NODE_ENV !== 'production'`; the default is `false`. The schema is owned by
> migrations (consolidated `InitialSchema`), applied at release time by
> `docker-entrypoint.sh` before the app starts. CI runs a `migration-smoke` job that
> applies migrations from scratch and re-runs to assert idempotency.

## Decision

Schema changes go through TypeORM migrations. `synchronize` is never enabled in
production and is an explicit dev-only escape hatch.

## Why this option

`synchronize` computes a diff between the entities and the live schema and applies it,
silently. That is fine when the schema is disposable. The moment it isn't, the mechanism
has no vocabulary for the thing that matters: **a column rename and a
drop-then-add are indistinguishable to a differ, and one of them destroys data.** There
is no place to write "backfill this before dropping that", and no artefact to review —
the change is computed at boot from whatever the entities happen to say at that moment.

A migration is a file. It gets reviewed in the PR alongside the code that needs it, runs
in the same order everywhere, and can be reverted. That is the whole argument, and it is
worth one extra command.

**Why the default is `false` rather than "on in dev, off in prod".** Two reasons, both
concrete in this repo:

1. The gate is `DB_SYNCHRONIZE=true` **and** `NODE_ENV !== 'production'` — two conditions,
   because a single one is a single mistake away from running against prod data.
2. `synchronize` only creates tables from entities. It does **not** create
   `v_period_expenses`, because that view has no entity — it lives in a hand-written
   migration. A dev database built with `synchronize` is therefore missing the view, and
   every budget-enforcement query and `GET /reports/summary` breaks on it. Making
   `synchronize` the default would hand new contributors a broken database that looks
   correct. `migration:run` is the only path that produces a complete schema.

That second point also produces a standing rule: `migration:generate` cannot see the
view (TypeORM only tracks views registered in `typeorm_metadata`), so a generated
migration proposing to `DROP` or recreate it must never be accepted.

## Alternatives considered

- **`synchronize: true` everywhere.** Rejected: data-loss risk, no reviewable artefact,
  entity↔DB drift, and — specific to this schema — it silently omits the
  `v_period_expenses` view.
- **A separate migration tool (Flyway, Liquibase, node-pg-migrate) with raw SQL.**
  Rejected: it would mean two sources of schema truth, since the entities still describe
  tables. TypeORM migrations already accept raw SQL when the ORM can't express something
  — `v_period_expenses` and the partial-index sketch in
  [`period-sum-index-decision.md`](../period-sum-index-decision.md) both are raw SQL — so
  the escape hatch exists without adding a tool.
- **Migrations at container boot instead of at release.** Rejected: it couples schema
  changes to instance startup, so N replicas racing to migrate is a real scenario. The
  entrypoint runs them as a distinct release step, and `RUN_MIGRATIONS=false` hands the
  job to a separate Job/initContainer where the platform supports it.

## Consequences

**Positive**

- Deterministic, reviewable, reversible schema; safe production releases.
- CI proves it: the `migration-smoke` job applies migrations to an empty database and
  re-runs them to assert idempotency, so a broken migration fails before merge rather
  than during a deploy.

**Negative / trade-offs**

- Must author/generate a migration for every entity change; TypeORM 0.3 cannot model
  some constructs (e.g. partial indexes) — see
  [`period-sum-index-decision.md`](../period-sum-index-decision.md).
- Anything written as raw SQL (the view) is invisible to `migration:generate`, so
  generated migrations must be read before being committed, not trusted.
- `data-source.ts` has to detect compiled (`dist/`) vs ts-node (`src/`) so one file
  serves both dev and the production image. Careless edits there break migrations in
  exactly one of the two environments.

**Follow-ups**

- None. The model is in place and CI-verified.
