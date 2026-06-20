# ADR-0004: Refresh-token rotation with family revocation on replay

- **Status:** Draft
- **Date:** YYYY-MM-DD
- **Deciders:** Vicente Cristobal Rivas Avello

## Context and problem statement

Stateless JWT access tokens are short-lived; long-lived refresh tokens must be
revocable and resistant to theft/replay. Storing raw refresh tokens would turn a DB
leak into account takeover.

> Fact from the code (auth module): refresh tokens are persisted in `refresh_tokens`
> as **`sha256(token)`** (never plaintext). Each row carries `id` (= JWT `jti`),
> `familyId` (shared across a rotation chain), `tokenHash`, `expiresAt`, `revokedAt`,
> `replacedById`. `/auth/refresh` runs inside `IAuthUnitOfWork`, reads the row
> `FOR UPDATE`, and on a revoked/replayed token revokes the **entire family**
> (`UPDATE ... WHERE family_id = $1`). A daily `@Cron` deletes expired tokens.

## Decision

Rotate on every refresh: revoke the old token, issue a new one in the same family.
On replay (a rotated token presented again), revoke the whole family and reject.
Persist only the hash.

## Why this option

<!--
Why revoke the WHOLE family on replay instead of just the presented token?
(Hint you gave: you can't safely distinguish "attacker replay" from "legit retry",
so you expel the chain. Confirm/expand in your own words.)
Why hashing, and why a DB-backed refresh store rather than stateless refresh?
-->

## Alternatives considered

- **Revoke only the single replayed token:** <!-- Why rejected? attacker keeps a valid sibling? -->
- **Stateless refresh tokens (no DB):** <!-- Why rejected? no revocation, no replay detection? -->
- **Store tokens encrypted instead of hashed:** <!-- Why rejected? reversible = worse on leak? -->

## Consequences

**Positive**

- DB leak does not expose usable tokens; a compromised chain is expelled atomically.

**Negative / trade-offs**

- A legitimate replay (network retry on the same refresh) logs the user out of that family.
- Refresh path needs a DB write + lock (not free).

**Follow-ups**

-
