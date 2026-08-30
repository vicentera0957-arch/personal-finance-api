# Documentation

Start here. This is the index for everything under `docs/`.

## Living reference

| You want… | Read |
| --- | --- |
| Run the project locally | [`../README.md`](../README.md) |
| The architecture, module graph & request flow (diagrams) | [`architecture.md`](./architecture.md) |
| Why decisions were made (ADRs) | [`adr/`](./adr/) |
| The concurrency model & lock map | [`concurrency-model.md`](./concurrency-model.md) |
| Testing approach & conventions | [`testing.md`](./testing.md) |
| Observability (logs, metrics, tracing) | [`observability.md`](./observability.md) |
| Deploy (build → release → run) | [`deployment.md`](./deployment.md) |
| The PostgreSQL performance lab | [`../PERFORMANCE.md`](../PERFORMANCE.md) · [`perf/`](./perf/) |
| Cache design (composition vs inheritance) | [`../src/shared/domain/cache-decision.md`](../src/shared/domain/cache-decision.md) |
| Unit of Work port hierarchy | [`../src/shared/domain/uow-decision.md`](../src/shared/domain/uow-decision.md) |
| Per-module design notes (co-located) | [`../src/modules/`](../src/modules/README.md) |
| The exhaustive reference (patterns, rules, anti-patterns) | [`conventions.md`](./conventions.md) |

Diagrams are **Mermaid, inline** in [`architecture.md`](./architecture.md), so they
render on GitHub and can't silently drift from the text around them.

## History — point-in-time records, not living guidance

These document work that is **finished**. They exist so the analysis isn't redone, not
as instructions to follow. Where they describe a rule that is still in force, the live
version of that rule is in `CLAUDE.md` or `concurrency-model.md`.

| Doc | What it records |
| --- | --- |
| [`history/closed-race-conditions.md`](./history/closed-race-conditions.md) | The seven races (Bug A/B/E, Race 1/2/3, B4) and the lock that closed each |
| [`history/structural-refactors.md`](./history/structural-refactors.md) | P1–P7: the module cycles, the stateless UoW runner, port narrowing (Aug 2026) |
| [`history/race-conditions-fix-2026-05.md`](./history/race-conditions-fix-2026-05.md) | Post-mortems for Race 1 and Race 2, with the TOCTOU diagrams |
| [`history/hardening-audit-2026-04.md`](./history/hardening-audit-2026-04.md) | Security/robustness audit and the roadmap it produced |
| [`history/production-readiness-2026-06-16.md`](./history/production-readiness-2026-06-16.md) | The changes that made the first deploy possible |
| [`period-sum-index-decision.md`](./period-sum-index-decision.md) | Benchmark that closed the "missing partial index" question — the index already existed |

> Convention: when the code and a doc disagree, the code wins — open a PR to fix the doc
> in the same change.
