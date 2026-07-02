# `auth` module — History and post-mortems

> **Current** state in [notes.md](./notes.md). This is the record of gaps that were once priorities and have already been closed.

---

## Closed gaps (2026 hardening)

### Refresh token rotation + family revocation + replay detection — IMPLEMENTED

**Previous state:** `RefreshTokenUseCase` only verified the refresh token's signature and issued a new access token, **without touching the DB or invalidating the previous refresh token**. A stolen refresh token was valid for its entire TTL (default `7d`), with no way to revoke it.

**Current state:** `refresh_tokens` table, `IAuthUnitOfWork` port, `sha256(token)` (never plaintext), `familyId` per rotation chain. On every `/refresh` the token is rotated (insert new + revoke old) under `FOR UPDATE`; if an already-rotated token arrives, replay is detected and **the whole family** is revoked. Flow details in [notes.md](./notes.md).

### Logout endpoint — IMPLEMENTED

**Previous state:** it didn't exist; a user could not invalidate their active tokens.

**Current state:** `POST /auth/logout` (`@Public()`) revokes the submitted refresh token.

### JWT `jti` — IMPLEMENTED

**Previous state:** tokens had no unique id, making individual revocation impossible.

**Current state:** the `jti` is the PK of the row in `refresh_tokens` and the value of `replacedById` on rotation.

---

## Actually pending

OAuth Google/GitHub remains the only open gap — see [notes.md](./notes.md).
