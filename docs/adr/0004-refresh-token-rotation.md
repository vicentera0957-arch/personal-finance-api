# ADR-0004: Refresh-token rotation with family revocation on replay

- **Status:** Accepted
- **Date:** 2026-06-20
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

**Why hash.** The server never needs to read a refresh token back — it only needs to
answer "is the token I was just handed the one I issued?". That is a comparison, and a
comparison only needs a one-way digest. Storing anything reversible would mean a DB leak
hands the attacker working tokens. `sha256` is enough here because the token is already
high-entropy random: the reason passwords need bcrypt (slow, salted) is that humans pick
guessable ones, which doesn't apply.

**Why a DB at all, rather than stateless refresh.** A stateless refresh token is valid
until it expires, full stop. There is no way to revoke it, and no way to notice it was
used twice. Both of those are the entire point of having refresh tokens: sign-out has to
mean something, and replay has to be detectable. That requires server-side state.

**Why revoke the whole family on replay.** A rotated token coming back means one of two
things: an attacker stole it and is using it after the legitimate client already
rotated, or the legitimate client replayed it (a network retry, a duplicated request).
There is no signal at runtime that separates those two cases — same token, same shape,
and the attacker can be behind the same IP and user agent.

Since we can't tell them apart, we have to pick which error to make. Revoking only the
presented token is the wrong pick: in the theft case the attacker has *already*
rotated it into a fresh, still-valid token, so revoking the dead one costs them nothing
and the chain stays compromised. Revoking the family is safe in both cases — the
attacker loses everything, and the legitimate user has to log in again. **Forcing a
re-login on a false positive is a much cheaper mistake than leaving a hijacked session
alive.**

That is what `familyId` is for: it makes "expel the whole chain" a single atomic
`UPDATE ... WHERE family_id = $1` instead of a walk up the `replacedById` links.

**Why the replay path commits.** The request ends in a 401, but the family revocation
must survive it. So the use case returns a `{ kind: 'replay' }` outcome from inside
`run()` — a normal return, so the runner commits — and throws the exception *after*
`run()` resolves. A thrown exception inside the callback would roll the revocation back
and leave the compromised chain alive.

## Alternatives considered

- **Revoke only the single replayed token.** Rejected: in the theft scenario the token
  presented is the one that was already rotated away, so it was worthless anyway. The
  attacker's live token is a *sibling* in the same family and survives. This defends
  against nothing.
- **Stateless refresh tokens (no DB).** Rejected: no revocation, no logout, no replay
  detection. Cheaper on every request and unable to do the one job that matters.
- **Store tokens encrypted rather than hashed.** Rejected: encryption is reversible, so
  the DB leak now also needs the key to stay secret — one more secret to protect, in
  exchange for a capability (recovering the plaintext) that no code path wants.
- **Sliding expiry without rotation** (extend the same token's lifetime on use).
  Rejected: a stolen token stays valid indefinitely as long as the attacker keeps
  using it, and nothing ever looks anomalous. Rotation is what makes theft *visible*.

## Consequences

**Positive**

- DB leak does not expose usable tokens; a compromised chain is expelled atomically.
- Replay is detected, not merely prevented — the family revocation is a signal that
  something went wrong, and it is durable.

**Negative / trade-offs**

- A legitimate replay (a network retry on the same refresh) logs the user out of that
  family. Accepted deliberately: this is the cheap direction to be wrong in.
- The refresh path needs a DB write plus a `FOR UPDATE` on the token row. Two concurrent
  `/auth/refresh` calls with the same token serialize on that lock — which is exactly
  what makes replay detection reliable rather than timing-dependent.
- Revoked rows accumulate; a daily `@Cron` deletes expired ones.

**Follow-ups**

- Nothing blocking. If sessions ever need to be listed or revoked individually from a
  UI, `familyId` is already the grouping key that would back it.
