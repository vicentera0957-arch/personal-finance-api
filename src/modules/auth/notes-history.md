# Módulo `auth` — Histórico

> Estado **actual** en [notes.md](./notes.md). Aquí queda el registro de gaps que en su momento eran prioritarios y ya fueron cerrados.

---

## Gaps cerrados (hardening 2026)

### Refresh token rotation + revocación de familia + detección de replay — IMPLEMENTADO

**Estado previo:** `RefreshTokenUseCase` solo verificaba la firma del refresh token y emitía un access nuevo, **sin tocar la DB ni invalidar el refresh anterior**. Un refresh token robado era válido durante todo su TTL (default `7d`), sin forma de revocarlo.

**Estado actual:** tabla `refresh_tokens`, puerto `IAuthUnitOfWork`, `sha256(token)` (nunca en claro), `familyId` por cadena de rotación. En cada `/refresh` se rota (inserta nuevo + revoca viejo) bajo `FOR UPDATE`; si llega un token ya rotado se detecta replay y se revoca **toda la familia**. Detalle del flujo en [notes.md](./notes.md).

### Logout endpoint — IMPLEMENTADO

**Estado previo:** no existía; un usuario no podía invalidar sus tokens activos.

**Estado actual:** `POST /auth/logout` (`@Public()`) revoca el refresh token enviado.

### JWT `jti` — IMPLEMENTADO

**Estado previo:** los tokens no tenían id único, imposibilitando la revocación individual.

**Estado actual:** el `jti` es la PK de la fila en `refresh_tokens` y el valor de `replacedById` al rotar.

---

## Pendiente real

OAuth Google/GitHub sigue siendo el único gap abierto — ver [notes.md](./notes.md).
