<!--
dev.to front matter — uncomment when publishing there:
---
title: How I closed 6 race conditions in my personal finance API (without SERIALIZABLE)
published: true
tags: postgres, concurrency, nestjs, backend
---
Canonical home: docs/blog/ in the repo. Add the repo link before publishing.
-->

# How I closed 6 race conditions in my personal finance API (without SERIALIZABLE)

Three months into my first backend project — a personal finance API in NestJS + PostgreSQL — I realized it could create money out of thin air.

Not through a bug in the math. Through **timing**. Every code path was correct when requests arrived one at a time; several were wrong the moment two arrived together. This post is the story of the six races I found, how each one was closed, and why the answer was *not* cranking the isolation level up to `SERIALIZABLE`.

I was reading *Designing Data-Intensive Applications* while building this, which made me paranoid in exactly the right way: I stopped asking "does this work?" and started asking "what does this do when it runs twice, at the same time?"

## The setup

The domain is small and strict: accounts hold a balance (integer CLP — no floats near money), categories classify transactions, and budgets put a **hard monthly limit** on expense categories. An expense that would push the month's total over its budget limit must be rejected with a 422. That's the core invariant:

```
Σ (expenses in category, month) ≤ budget limit
```

The naive implementation of that check is the one every tutorial writes:

```ts
const spent = await sumExpenses(userId, categoryId, month, year);
if (spent + amount > budget.limit) throw new BudgetLimitExceededException();
await save(transaction);
```

Read, check, write. Under one request at a time: correct. Under two: broken.

## Race #1 — the write skew that overspends the budget

Budget limit: 100.000. Already spent: 90.000. Two requests for a 5.000 expense arrive simultaneously:

```
Request A                          Request B
─────────                          ─────────
SUM(expenses) → 90.000
                                   SUM(expenses) → 90.000
90k + 5k ≤ 100k ✓
                                   90k + 5k ≤ 100k ✓
INSERT expense (5.000)
COMMIT
                                   INSERT expense (5.000)
                                   COMMIT

Final state: 100.000 spent… but with N concurrent requests, anything.
```

Both checks passed on the same stale snapshot. Neither transaction saw the other's insert, because under `READ COMMITTED` (Postgres's default) neither had committed when the other read. This is a textbook **write skew**: each write is individually valid; the *combination* violates the invariant.

The same shape appeared in a second flow: `PATCH /budgets/:id/limit` lowering the limit while a concurrent `POST /transactions` filled it. Two writers, two different rows, one shared invariant, no coordination.

## Why not SERIALIZABLE

Postgres has a switch for this. `SERIALIZABLE` detects these anomalies at commit time and aborts one transaction with a serialization error (`40001`). Problem solved?

Sort of — but the failure moves into your application: every write path now needs **retry logic**, because any transaction can abort through no fault of its own. Retries mean idempotency concerns, backoff, and a failure mode that only shows up under load.

I chose the other route: keep `READ COMMITTED` and **manufacture serialization exactly where the invariant needs it**, with explicit pessimistic locks. Don't ask the database for global protection; build point protection where a mistake costs money, and leave every read path cheap.

## The mechanism: one guardian row per invariant

The pattern that closed the write skew: every invariant gets a **guardian row**, and every flow that can affect that invariant must take a `SELECT … FOR UPDATE` on that row *before reading the data that feeds its decision*.

For the budget invariant, the guardian is the budget row itself:

```
Request A                          Request B
─────────                          ─────────
SELECT budget FOR UPDATE  🔒
                                   SELECT budget FOR UPDATE  ⏳ blocks…
SUM → 90.000
90k + 5k ≤ 100k ✓
INSERT + COMMIT           🔓
                                   …unblocks, reads FRESH state
                                   SUM → 95.000
                                   95k + 5k ≤ 100k ✓ (exactly at limit)
                                   INSERT + COMMIT
```

B waited, then decided on data that included A's write. The invariant holds for any N, because the budget row acts as a **mutex for its own invariant**. Every flow that mutates period expenses — creating a transaction, lowering the limit, deleting the budget — takes that same lock first, so they all serialize against each other.

The full map ended up small:

| Invariant | Guardian row |
|---|---|
| Σ period expenses ≤ limit | the `budgets` row for that period |
| account balance is correct | the `accounts` row |
| a transaction isn't reversed twice | the `transactions` row |
| a refresh token isn't replayed | the `refresh_tokens` row |

And every transactional flow follows the same skeleton:

```
1. fail-fast checks OUTSIDE the transaction (cheap 404/403, no locks held)
2. BEGIN
3. lock the guardian row(s)        ← FOR UPDATE
4. dependent reads (SUMs, counts)  ← no lock of their own; see below
5. decide the invariant on data read AFTER the lock
6. write
7. COMMIT / ROLLBACK
```

Step 3 before step 4 **is** the correctness. Everything else is plumbing.

## The subtlety that taught me the most: you can't lock a SUM

My first instinct was to lock the expense rows being summed. Two problems. Postgres flatly refuses `FOR UPDATE` on aggregate queries — and even if it didn't, locking *existing* rows can't stop **phantoms**: a new expense row inserted into the range by a concurrent writer isn't covered by any lock you hold.

So the `SUM` carries no lock at all. Its consistency is inherited from the guardian-row lock taken *first* — like a talking stick: you may only compute the sum while holding the budget row, and since every writer of period expenses needs that same row, nobody can change the sum under you. A lock on row X protecting the integrity of a query over rows Y₁…Yₙ — nothing in the code makes that visible; it's an agreement, and it only works because *every* writer honors it. (More on that discomfort at the end.)

## The other four, briefly

**Lost update on the balance.** Two concurrent deposits both read balance 100k, both computed 100k + their amount, both wrote. One deposit evaporated. Closed with `FOR UPDATE` on the account row — same guardian pattern. This also covers archive/rename racing against transaction creation.

**Double-delete, double-reverse.** Deleting a transaction reverses its effect on the balance. Two concurrent `DELETE /transactions/:id` on the same id → the reversal applied twice. Closed by locking the transaction row: the second arrival unblocks after the first commits, finds the row gone, and correctly 404s instead of re-reversing.

**Duplicate registration returning 500.** Two concurrent `POST /auth/register` with the same email both passed the "email exists?" pre-check, then one crashed on the unique index. This one is *not* a job for locks — you can't lock a row that doesn't exist yet. The database's unique constraint is the real guarantee; the fix is catching error `23505` and translating it to a domain conflict (409). That gave me the rule of thumb I now apply everywhere: **read-modify-write → lock; check-then-insert → constraint + catch.** Never the other way around.

**Refresh token replay.** Refresh tokens rotate: using one issues a new pair and revokes the old. Two concurrent `/auth/refresh` with the same token must not both succeed — that's exactly what token theft looks like. `FOR UPDATE` on the token row (by hash — tokens are never stored in plaintext) serializes them: the second sees "already revoked" and triggers replay handling, which revokes the token's entire *family* — every descendant of that login. If a rotated token comes back, either an attacker has it or the client is broken; both mean the chain can't be trusted, and telling those cases apart at runtime is not possible, so we don't try.

## What about deadlocks?

One flow takes **two** locks: creating an expense locks the budget row (the limit gate) and then the account row (the balance write). Multiple locks + concurrency = deadlock risk, *if* two flows ever take the same rows in opposite order.

So the ordering is a system-wide rule: **budget → account, account always last**. No flow takes account-then-budget; no lock-order inversion exists on any pair of rows, so there is no deadlock *by construction* — not by timeout tuning. The honest caveat: that ordering lives in convention and documentation, not in the compiler.

## Tests that bite

The part I'd defend hardest in a review. Each race has an integration test against a real Postgres, all shaped the same way: fire N identical requests with `Promise.all`, then assert on the **final state** — not on individual responses.

- N concurrent deposits → the balance must equal the exact sum. A lost update shows up as a lower number.
- N expenses brushing the limit → exactly the ones that fit return 201; the rest 422; the final sum never exceeds the limit.
- Concurrent limit-lowering vs. expense-creation → exactly one wins; neither 500s.

And the step that made me trust them: **I removed each lock and watched the right test go red.** Account lock out → lost-update test fails. Budget lock out → the limit gets overspent. Transaction lock out → double reverse. Tests that don't fail when the protection is removed aren't testing the protection.

## What I'd still fix (and why I haven't)

The model is correct today but **fragile by convention**, and I'd rather say so than pretend otherwise:

- **The locks are invisible at the call site.** `findById()` inside the transactional scope takes `FOR UPDATE`; nothing in the name says so. A future contributor reading through the global (non-locking) repository would reopen every race without any test noticing immediately. A `findByIdForUpdate()` naming scheme would make the lock self-documenting.
- **Lock ordering is prose, not code.** Nothing stops a future flow from locking account-then-budget.
- **The SUM's protection is an agreement.** Any new code path that inserts expenses without taking the budget lock silently bypasses the gate.

All three are documented as known debt. Hardening them costs abstraction I don't need at this scale — but the decision to defer is written down, which I've come to believe matters as much as the fix.

## Takeaways

1. **Ask "what happens when this runs twice, concurrently?" of every write path.** It's the single highest-yield code-review question I know.
2. **Read-modify-write wants a lock; check-then-insert wants a constraint.** You can't lock what doesn't exist yet.
3. **You can't lock an aggregate — serialize its writers instead**, through a guardian row they all must hold.
4. **Lock before you read what feeds the decision.** A check on data read before the lock is a check on fiction.
5. **Prove your locks with tests that fail when the lock is removed.** Otherwise you have tests that pass *around* the race, not against it.

---

*The full analysis — lock map, flow-by-flow breakdowns, the deadlock argument, and the fragility notes — lives in the repo's `docs/concurrency-model.md`: [repo link]. The concurrency test suite is in `test/integration/concurrency/`.*
