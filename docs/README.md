# Documentation

Start here. This is the index for everything under `docs/`.

| You want… | Read |
| --- | --- |
| Run the project locally | [`../README.md`](../README.md) |
| The architecture, module graph & request flow (diagrams) | [`architecture.md`](./architecture.md) |
| Why decisions were made (ADRs) | [`adr/`](./adr/) |
| The concurrency model & lock map | [`concurrency-model.md`](./concurrency-model.md) |
| Cache design (composition vs inheritance) | [`../src/shared/domain/cache-decision.md`](../src/shared/domain/cache-decision.md) |
| Testing approach & conventions | [`testing.md`](./testing.md) |
| Observability (logs, metrics, tracing) | [`observability.md`](./observability.md) |
| Deploy (build → release → run) | [`deployment.md`](./deployment.md) |
| The period-sum index decision | [`period-sum-index-decision.md`](./period-sum-index-decision.md) |
| Per-module design notes (co-located) | [`../src/modules/`](../src/modules/README.md) |
## Reference material

- Diagrams are now **Mermaid, inline** in [`architecture.md`](./architecture.md) (renders on GitHub).
- The original March design PDFs (data model, business rules) were removed as superseded
  by `architecture.md`, the ADRs and per-module `notes.md` — recoverable from git history.
- [`assets/`](./assets/) — README media (demo GIF, screenshots).
- [`blog/`](./blog/) — publishable write-ups (concurrency article + LinkedIn draft).
- [`revision/`](./revision/) — archived/superseded material (legacy `PROJECT_GUIDE.md`).

## History (dated journals — point-in-time, not living reference)

- [`history/hardening-audit-2026-04.md`](./history/hardening-audit-2026-04.md) — hardening journal.
- [`history/race-conditions-fix-2026-05.md`](./history/race-conditions-fix-2026-05.md) — race-condition post-mortems.
- [`history/production-readiness-2026-06-16.md`](./history/production-readiness-2026-06-16.md) — production-readiness changes.

> Convention: when the code and a doc disagree, the code wins — open a PR to fix the doc
> in the same change.
