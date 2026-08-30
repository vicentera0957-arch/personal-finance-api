# History

- **Last updated:** 2026-08-30

Point-in-time records of work that is **finished**.

These documents exist so the analysis isn't redone: what was broken, what was measured,
what was decided, and what it cost. They are **not** guidance to follow. Where one
describes a rule that is still in force, the live version of that rule lives in
[`CLAUDE.md`](../../CLAUDE.md), [`conventions.md`](../conventions.md) or
[`concurrency-model.md`](../concurrency-model.md) — read those, not these.

For the _why_ behind a decision that is still in force, go to the
[ADRs](../adr/) instead. The difference is deliberate: an **ADR** is a live decision that
governs new code; a **history** document is a closed episode that no longer does.

Dates are ISO 8601 (`YYYY-MM-DD`, or `YYYY-MM` where only the month is known) and record
**when the work happened**, not when the document was written.

## The record

| Doc | Period | What it records |
| --- | --- | --- |
| [`hardening-audit-2026-04.md`](./hardening-audit-2026-04.md) | 2026-04 | The security/robustness audit that took the app from "solid domain" to "production-shape", and the roadmap it produced |
| [`race-conditions-fix-2026-05.md`](./race-conditions-fix-2026-05.md) | 2026-05 | Post-mortems for Race 1 and Race 2 — the two cross-module races — with the TOCTOU diagrams |
| [`production-readiness-2026-06-16.md`](./production-readiness-2026-06-16.md) | 2026-06-16 | Hardened CI, secrets fail-fast, Redis as a hard readiness dependency: the changes that made the first deploy possible |
| [`structural-refactors.md`](./structural-refactors.md) | 2026-08-01 → 2026-08-06 | P1–P7: the two module cycles, the stateless UoW runner, and per-consumer port narrowing |
| [`closed-race-conditions.md`](./closed-race-conditions.md) | 2026-04 → 2026-05 | Registry of all seven closed races (Bug A/B/E, Race 1/2/3, B4) and the lock that closed each |

## Where to start

**[`closed-race-conditions.md`](./closed-race-conditions.md) first.** It is the shortest
and the only one that is a table rather than a narrative — seven rows, one per race, each
naming the lock that closed it. Everything else here is the long form of one of those
rows, or the audit that found them.

Then, if you need the reasoning rather than the result:

| You want to know… | Read |
| --- | --- |
| Why a specific race was possible at all, step by step | [`race-conditions-fix-2026-05.md`](./race-conditions-fix-2026-05.md) |
| Why the module graph is shaped the way it is | [`structural-refactors.md`](./structural-refactors.md) |
| What "production ready" was taken to mean here, and what was left open | [`production-readiness-2026-06-16.md`](./production-readiness-2026-06-16.md) |
| What the codebase looked like before any of it | [`hardening-audit-2026-04.md`](./hardening-audit-2026-04.md) |

The regression net for all seven races is
`test/integration/concurrency/concurrency.integration.spec.ts`. Treat it as the oracle:
if you change the lock model, those scenarios must keep passing **unmodified**.

## Two shapes of document

- **Episodes** — a dated piece of work, filename `<topic>-<YYYY-MM[-DD]>.md`. Written
  once, then frozen.
- **Registries** — `closed-race-conditions.md` and `structural-refactors.md`. They span a
  range rather than a date, so the filename carries no date; the period is in the header
  and in the table above.

## Adding one

A document belongs here when the work it describes is **closed** and the analysis would
otherwise be lost. Open the file with the standard header — status, date, and a line
pointing at the live doc that superseded it:

```markdown
# <Title> — <YYYY-MM>

- **Status:** Point-in-time record — not current guidance
- **Date:** <YYYY-MM[-DD]>

> The rules this produced live in [`conventions.md`](../conventions.md) …
```

Then add a row to the table above in the same PR, and — if the document replaces
material that was living guidance — delete that material rather than leaving both.
Two copies of a rule is how they drift.
