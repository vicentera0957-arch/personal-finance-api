# ADR-0005: Single-entry, immutable transactions (not a double-entry ledger)

- **Status:** Accepted
- **Date:** 2026-06-20
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

**Why immutable.** An update to a transaction is never one change — it is a change to
the record *and* a compensating change to the account balance *and* possibly a
re-evaluation of the budget limit for a different period. Supporting `PATCH
/transactions/:id` means writing a diff engine: which fields moved, what does each one
imply, and every combination needs its own invariant check under the same locks.
Delete + recreate reuses two paths that already exist and are already tested: delete
reverses the balance under lock, create re-applies it and re-runs the budget gate. **The
edit case gets the invariant enforcement for free instead of needing its own.**

The audit property is a real benefit but it is the second one, not the first. A record
that is never rewritten means the transaction table is an append/remove log rather than
mutable state.

**Why single-entry.** Double-entry earns its complexity when money moves *between*
places you track and both sides must stay reconciled — that is what makes the books
balance. This domain is one user recording where their own money went. `income` and
`expense` cross the system boundary: the counterparty (an employer, a supermarket) is
not an account in this system and never will be. Modelling that with a contra-account
means inventing placeholder accounts that exist only to satisfy the pattern, which is
ceremony without a reader.

The honest limit is transfers between two of the user's own accounts — the one case that
genuinely has two sides. V1 doesn't support them. That is a **scope** decision, and
naming it is the reason this ADR exists: single-entry is not "double-entry done badly",
it is a smaller model chosen on purpose, and the boundary where it stops working is
known in advance rather than discovered later.

## Alternatives considered

- **Double-entry ledger (balanced debit/credit postings).** Rejected for V1: it doubles
  the write model, requires a chart of accounts and external/equity accounts for every
  income and expense, and its main payoff — reconciliation across accounts — has no
  consumer in a single-user personal finance app. Deferring it is cheap; the transaction
  table would gain lines, not change shape.
- **Mutable transactions (in-place `update`).** Rejected: every mutable field needs its
  own compensating-write path and its own invariant re-check under lock. It multiplies
  the surface where the budget and balance invariants can be violated, for an operation
  the user experiences as "fix a typo".
- **Soft delete (`deletedAt`) instead of a hard delete.** Rejected for V1: it keeps the
  audit trail but every read path, every `SUM` and the `v_period_expenses` view then
  need a `WHERE deleted_at IS NULL`, and one forgotten filter silently corrupts a
  budget total. Worth revisiting only if the audit trail becomes a requirement.

## Consequences

**Positive**

- Simple, auditable, immutable record; balance correctness enforced by locks.
- Two write paths (create, delete) instead of three. The invariant checks live in one
  place each, and editing composes them rather than duplicating them.

**Negative / trade-offs**

- No native transfer-between-accounts as a single balanced operation.
- Reporting/reconciliation is less rich than a true ledger.
- "Editing" a transaction is two HTTP calls, and nothing makes them atomic: a client
  that deletes and then fails to recreate leaves the record gone. Acceptable at this
  scale, and it is the concrete cost of the choice.

**Follow-ups**

- **Transfers** are the natural next step and don't require double-entry: two linked
  transactions sharing a `transferGroupId`, created atomically inside the existing Unit
  of Work. That covers the real gap without adopting a full ledger. Tracked on the
  README roadmap.
