# ADR-0005: Single-entry, immutable transactions (not a double-entry ledger)

- **Status:** Draft
- **Date:** YYYY-MM-DD
- **Deciders:** Vicente Cristobal Rivas Avello

> This ADR exists to state honestly what the transaction model **is** and **is not**.
> It is the most valuable kind of ADR: documenting a scope decision and its trade-offs
> instead of overclaiming.

## Context and problem statement

The app records money movements that update account balances and must respect budget
limits. A classic accounting design is **double-entry** (every event posts balanced
debit/credit lines across two accounts). That is powerful but heavier to model.

> Fact from the code: [`Transaction`](../../src/modules/transactions/domain/entities/transaction.entity.ts)
> is **immutable** — it has no mutation methods; "editing" means delete + recreate.
> Each transaction has a single `nature` (`income`/`expense`) and updates **one**
> account's balance via `inflow`/`outflow`
> ([`create-transaction.use-case.ts`](../../src/modules/transactions/application/use-cases/create-transaction.use-case.ts)).
> There is **no** contra-account, no debit/credit pairing, no balanced journal.
> This is a **single-entry** model.

## Decision

V1 uses a single-entry, immutable transaction log. Balance is mutated atomically per
transaction under lock (see [ADR-0002](./0002-unit-of-work-pessimistic-locks.md)).
Corrections are delete + recreate, not in-place updates.

## Why this option

<!--
Two things to capture in your own words:
1. Why IMMUTABLE + delete/recreate instead of mutable updates? (audit trail?
   simpler invariants? avoids partial-update races?)
2. Why SINGLE-entry and not double-entry? (out of scope for V1? single-user personal
   finance doesn't need inter-account postings? complexity not justified yet?)
-->

## Alternatives considered

- **Double-entry ledger (debit/credit lines, balanced postings):** <!-- Why rejected for V1? scope/complexity? -->
- **Mutable transactions (in-place `update`):** <!-- Why rejected? lost audit trail, balance-recompute races? -->

## Consequences

**Positive**

- Simple, auditable, immutable record; balance correctness enforced by locks.

**Negative / trade-offs**

- No native transfer-between-accounts as a single balanced operation.
- Reporting/reconciliation is less rich than a true ledger.

**Follow-ups**

- <!-- If double-entry ever becomes a goal, note it here as a future direction. -->
