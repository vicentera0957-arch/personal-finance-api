# Documentation

- **Last updated:** 2026-08-30

Start here. This is the index for everything under `docs/`.

## Living reference

| You want… | Read |
| --- | --- |
| Run the project locally | [`../README.md`](../README.md) |
| The architecture, module graph & request flow (diagrams) | [`architecture.md`](./architecture.md) |
| Why decisions were made (ADRs) | [`adr/`](./adr/README.md) |
| The concurrency model & lock map | [`concurrency-model.md`](./concurrency-model.md) |
| Testing approach & conventions | [`testing.md`](./testing.md) |
| Observability (logs, metrics, tracing) | [`observability.md`](./observability.md) |
| Deploy (build → release → run) | [`deployment.md`](./deployment.md) |
| The PostgreSQL performance lab | [`../performance.md`](../performance.md) · [`perf/`](./perf/README.md) |
| Cache design (composition vs inheritance) | [ADR-0008](./adr/0008-redis-cache-ports.md) · [ADR-0011](./adr/0011-cache-strategy.md) · [`cache-decision.md`](../src/shared/domain/cache-decision.md) |
| Unit of Work port hierarchy | [ADR-0012](./adr/0012-uow-port-hierarchy.md) · [`uow-decision.md`](../src/shared/domain/uow-decision.md) |
| Per-module design notes (co-located) | [`../src/modules/`](../src/modules/README.md) |
| The exhaustive reference (patterns, rules, anti-patterns) | [`conventions.md`](./conventions.md) |

Diagrams are **Mermaid, inline** in [`architecture.md`](./architecture.md), so they
render on GitHub and can't silently drift from the text around them.

Where a row lists an ADR **and** a longer document, the ADR is the entry point and the
document is the detail. Change both in the same PR or they drift.

## History — point-in-time records, not living guidance

These document work that is **finished**. They exist so the analysis isn't redone, not
as instructions to follow. Where they describe a rule that is still in force, the live
version of that rule is in `CLAUDE.md`, [`conventions.md`](./conventions.md) or
[`concurrency-model.md`](./concurrency-model.md).

**Index and reading order: [`history/README.md`](./history/README.md).**

| Doc | Period | What it records |
| --- | --- | --- |
| [`history/closed-race-conditions.md`](./history/closed-race-conditions.md) | 2026-04 → 2026-05 | The seven races (Bug A/B/E, Race 1/2/3, B4) and the lock that closed each |
| [`history/hardening-audit-2026-04.md`](./history/hardening-audit-2026-04.md) | 2026-04 | Security/robustness audit and the roadmap it produced |
| [`history/race-conditions-fix-2026-05.md`](./history/race-conditions-fix-2026-05.md) | 2026-05 | Post-mortems for Race 1 and Race 2, with the TOCTOU diagrams |
| [`history/production-readiness-2026-06-16.md`](./history/production-readiness-2026-06-16.md) | 2026-06-16 | The changes that made the first deploy possible |
| [`history/structural-refactors.md`](./history/structural-refactors.md) | 2026-08-01 → 2026-08-06 | P1–P7: the module cycles, the stateless UoW runner, port narrowing |

## Conventions for these documents

- **Dates are ISO 8601** — `YYYY-MM-DD`, or `YYYY-MM` where only the month is known.
  One format everywhere, including inside prose.
- **Point-in-time documents** ([ADRs](./adr/README.md), [history](./history/README.md))
  carry a `**Date:**` — when the decision was taken or the work happened. It never
  changes afterwards.
- **Living documents** under `docs/` — and [`performance.md`](../performance.md) —
  carry a `**Last updated:**`. Bump it in the PR that changes the document. The root
  [`README.md`](../README.md) is the project's front page and carries neither.
- Spanish-language documents use the same ISO dates under Spanish labels
  (`Fecha`, `Última actualización`). The format is uniform; the label follows the
  document's language.
- **When the code and a doc disagree, the code wins** — open a PR to fix the doc in the
  same change.
