# Módulo `users` — Histórico y post-mortems

> Estado **actual** en [notes.md](./notes.md).

---

## Bug E — Concurrent register → 500 (RESUELTO)

**Estado previo:** `CreateUserUseCase` hace un `GetUserByEmailUseCase` antes de insertar (check-then-insert). En condiciones normales detecta el duplicado y lanza `UserAlreadyExistsException` → 409. Pero si dos requests llegaban simultáneamente, ambas pasaban el check y la segunda fallaba con `23505` en el `ormRepository.save()`. Como `UserRepositoryImpl.save()` no tenía `try/catch`, el `QueryFailedError` subía sin mapear → NestJS devolvía 500.

**Fix aplicado:** `UserRepositoryImpl.save()` atrapa el error:

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

**Patrón defense-in-depth:** índice único `uq_users_email` en la DB (garantía real) + `catch 23505` en el repo (mapea a 409) + pre-check en `CreateUserUseCase` (fail-fast, ahorra el round-trip en el caso normal). El pre-check no es la garantía; el catch sí.
