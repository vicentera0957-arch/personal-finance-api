# ADR-0007: Schema via migrations, never `synchronize`

- **Status:** Draft
- **Date:** YYYY-MM-DD
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

<!--
Mostly an industry default, but say it in your words: why is deterministic,
reviewable, reversible schema change worth the extra step? Any incident or fear
that drove making the default `false`?
-->

## Alternatives considered

- **`synchronize: true` everywhere:** rejected — data loss risk, no review, drift.
- **A separate schema-management tool (e.g. raw SQL, Flyway):** <!-- Why rejected? stay in TypeORM? -->

## Consequences

**Positive**

- Deterministic, reviewable, reversible schema; safe production releases.

**Negative / trade-offs**

- Must author/generate a migration for every entity change; TypeORM 0.3 cannot model
  some constructs (e.g. partial indexes) — see `period-sum-index-decision.md`.

**Follow-ups**

-
