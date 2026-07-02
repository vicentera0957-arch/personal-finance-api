# `users` module — History and post-mortems

> **Current** state in [notes.md](./notes.md).

---

## Bug E — Concurrent register → 500 (RESOLVED)

**Previous state:** `CreateUserUseCase` does a `GetUserByEmailUseCase` before inserting (check-then-insert). Under normal conditions it detects the duplicate and throws `UserAlreadyExistsException` → 409. But if two requests arrived simultaneously, both passed the check and the second one failed with `23505` in the `ormRepository.save()`. Since `UserRepositoryImpl.save()` had no `try/catch`, the `QueryFailedError` bubbled up unmapped → NestJS returned a 500.

**Applied fix:** `UserRepositoryImpl.save()` catches the error:

```typescript
async save(user: User): Promise<User> {
  const orm = this.mapper.toOrm(user);
  try {
    const saved = await this.ormRepository.save(orm);
    return this.mapper.toDomain(saved);
  } catch (err) {
    if (err instanceof QueryFailedError && (err as any).driverError?.code === '23505') {
      throw new UserAlreadyExistsException(user.getEmail().getValue());
    }
    throw err;
  }
}
```

**Defense-in-depth pattern:** unique index `uq_users_email` in the DB (the real guarantee) + `catch 23505` in the repo (maps to 409) + pre-check in `CreateUserUseCase` (fail-fast, saves the round-trip in the normal case). The pre-check is not the guarantee; the catch is.
