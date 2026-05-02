# Plan — JWT con refresh token rotation y revocación

## Contexto

Hoy `RefreshTokenUseCase` (`src/modules/auth/application/use-cases/refresh-token.use-case.ts`) tiene 19 líneas: verifica la firma del refresh token recibido y emite un nuevo access token. **No persiste, no rota, no revoca.**

Consecuencias:

- Un refresh token robado es válido por 7 días enteros.
- No hay forma de cerrar sesión real (`POST /auth/logout` no existe o no invalida nada).
- No hay detección de **replay** (el atacante y el usuario legítimo pueden usar el mismo refresh token sin que el sistema lo note).

CLAUDE.md ya marca esto como gap conocido.

**Objetivo:** implementar refresh token rotation siguiendo el patrón estándar de Auth0/OAuth2, con detección de reuso y revocación en cascada.

---

## Patrón a implementar

### Flujo en estado normal

```
Cliente                       API
   │                            │
   │ POST /auth/login           │
   ├──────────────────────────► │
   │                            │ - emite access_token (15m)
   │                            │ - emite refresh_token RT1
   │                            │ - persiste RT1.hash en DB
   │ ◄────────────────────────┤
   │ {access, refresh: RT1}     │
   │                            │
   │ ... 15 min después ...     │
   │                            │
   │ POST /auth/refresh (RT1)   │
   ├──────────────────────────► │
   │                            │ - busca RT1 en DB
   │                            │ - valida no revocado, no expirado
   │                            │ - marca RT1 como usado (revoked_at)
   │                            │ - emite RT2, lo guarda con replaced_by_id
   │                            │ - emite nuevo access_token
   │ ◄────────────────────────┤
   │ {access, refresh: RT2}     │
```

### Flujo de detección de replay

Si llega un `RT1` que ya está marcado como usado (porque el legítimo lo cambió por `RT2`):

```
Cliente atacante              API
   │                            │
   │ POST /auth/refresh (RT1)   │ ← RT1 ya rotado
   ├──────────────────────────► │
   │                            │ - busca RT1 en DB
   │                            │ - detecta revoked_at != null
   │                            │ - REVOCA toda la familia (RT1, RT2, RT3...)
   │                            │ - rechaza la request con 401
   │ ◄────────────────────────┤
   │ 401 Unauthorized           │
```

El usuario legítimo es expulsado y debe re-login. Es agresivo, pero es la única forma de garantizar que el atacante quede fuera.

`✶ Insight ─────────────────────────────────────`
La clave del patrón: cada refresh token tiene un `family_id` (UUID compartido entre todos los tokens emitidos desde el mismo login). Cuando se detecta replay, se revoca **toda la familia** mediante `UPDATE WHERE family_id = ?`. Sin family_id, solo revocas el token actual y el atacante puede seguir rotando con los siguientes.
`─────────────────────────────────────────────────`

---

## Estado deseado

1. Tabla `refresh_tokens` con: `id`, `user_id`, `family_id`, `token_hash`, `expires_at`, `created_at`, `revoked_at`, `replaced_by_id`.
2. Domain entity `RefreshToken` + value objects que validan invariantes.
3. Repositorio + implementación TypeORM.
4. `LoginUseCase` emite RT y persiste su hash.
5. `RefreshTokenUseCase` rota: invalida el viejo, emite nuevo, detecta replay y revoca familia.
6. Nuevo `LogoutUseCase` y endpoint `POST /auth/logout` que revoca el RT actual.
7. Job de limpieza (cron / scheduled task) que borra tokens expirados.

---

## Plan paso a paso

### Paso 1 — Migration de `refresh_tokens`

Crear migración manual (no autogenerada):

```ts
// src/database/migrations/XXXXXXXXXXXXX-CreateRefreshTokens.ts
CREATE TABLE refresh_tokens (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id UUID NOT NULL,
  token_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMP NULL,
  replaced_by_id UUID NULL REFERENCES refresh_tokens(id) ON DELETE SET NULL
);

CREATE INDEX idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);
CREATE INDEX idx_refresh_tokens_family_id ON refresh_tokens(family_id);
CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_expires_at ON refresh_tokens(expires_at)
  WHERE revoked_at IS NULL;
```

> **Por qué `token_hash` y no el token plano**: si se filtra la DB, los tokens persistidos no son utilizables. Hash con SHA-256 (no bcrypt — bcrypt es para passwords humanos, los tokens son alta-entropía y SHA-256 es suficiente).

### Paso 2 — Domain entity y VO

```
src/modules/auth/domain/
  entities/
    refresh-token.entity.ts        # crear / revocar / rotar
  value-objects/
    refresh-token-id.vo.ts         # UUID
    family-id.vo.ts                # UUID
  exceptions/
    refresh-token-revoked.exception.ts
    refresh-token-expired.exception.ts
    refresh-token-replay-detected.exception.ts
  repository/
    refresh-token.repository.ts    # interfaz
```

Métodos clave del entity:

- `RefreshToken.create({ userId, familyId, tokenHash, expiresAt })` — nuevo, sin revoked.
- `RefreshToken.reconstitute(...)` — desde DB.
- `entity.revoke(replacedById?)` — marca revoked_at + replaced_by_id si rota.
- `entity.isUsable()` — `!revoked && expiresAt > now`.

### Paso 3 — Repositorio

Métodos mínimos:

```ts
abstract class IRefreshTokenRepository {
  abstract findByTokenHash(hash: string): Promise<RefreshToken | null>;
  abstract save(token: RefreshToken): Promise<void>;
  abstract revokeFamily(familyId: string): Promise<void>;
  abstract deleteExpired(now: Date): Promise<number>;
}
```

### Paso 4 — Modificar `LoginUseCase`

Después de validar credenciales y emitir tokens:

```ts
const familyId = uuid();
const refreshTokenJti = uuid();
const refreshToken = this.tokenProvider.signRefresh({ sub: userId, jti: refreshTokenJti });
const tokenHash = sha256(refreshToken);

const entity = RefreshToken.create({
  id: refreshTokenJti,
  userId,
  familyId,
  tokenHash,
  expiresAt: now() + 7d,
});

await this.repo.save(entity);

return { accessToken, refreshToken };
```

### Paso 5 — Reescribir `RefreshTokenUseCase`

Pseudocódigo:

```ts
async execute(refreshToken: string) {
  const payload = this.tokenProvider.verifyRefresh(refreshToken);  // valida firma
  const tokenHash = sha256(refreshToken);

  const stored = await this.repo.findByTokenHash(tokenHash);
  if (!stored) throw new InvalidRefreshTokenException();

  if (stored.isRevoked()) {
    // ⚠️ REPLAY DETECTADO — revocar toda la familia
    await this.repo.revokeFamily(stored.familyId);
    throw new RefreshTokenReplayDetectedException();
  }

  if (stored.isExpired()) throw new RefreshTokenExpiredException();

  // Rotación
  const newJti = uuid();
  const newToken = this.tokenProvider.signRefresh({ sub: stored.userId, jti: newJti });
  const newHash = sha256(newToken);

  const newEntity = RefreshToken.create({
    id: newJti,
    userId: stored.userId,
    familyId: stored.familyId,  // misma familia
    tokenHash: newHash,
    expiresAt: now() + 7d,
  });

  stored.revoke(newJti);  // marca el viejo como reemplazado por el nuevo

  // ⚠️ Toda esta operación debe ir en una transacción (Unit of Work)
  await this.uow.execute(async () => {
    await this.repo.save(stored);
    await this.repo.save(newEntity);
  });

  const newAccess = this.tokenProvider.signAccess({ sub: stored.userId });
  return { accessToken: newAccess, refreshToken: newToken };
}
```

> **Atómicamente**: la rotación debe ir dentro de un `IUnitOfWork`. Si crashea entre `revoke` y `save(new)`, el usuario pierde acceso. Sigue el patrón ya establecido en `transactions/budgets`.

### Paso 6 — Endpoint `POST /auth/logout`

```ts
@Post('logout')
@HttpCode(204)
async logout(@Body('refreshToken') token: string) {
  await this.logoutUseCase.execute(token);
}
```

`LogoutUseCase`: verifica firma, busca por hash, marca revocado (sin revocar la familia entera, solo el token actual).

### Paso 7 — Limpieza de tokens expirados

Job que se corre 1 vez al día:

```ts
@Cron('0 3 * * *')  // 3am
async cleanupExpiredTokens() {
  const deleted = await this.repo.deleteExpired(new Date());
  this.logger.log(`Cleaned up ${deleted} expired refresh tokens`);
}
```

Si ya tienes BullMQ planeado, mete esto como job recurrente. Si no, `@nestjs/schedule` es suficiente.

### Paso 8 — Tests

Crear specs unitarios y de integración cubriendo:

- ✅ Login crea entry en `refresh_tokens`.
- ✅ Refresh con token válido rota correctamente.
- ✅ Refresh con token revocado lanza `ReplayDetectedException` y revoca la familia.
- ✅ Refresh con token expirado lanza `ExpiredException`.
- ✅ Logout marca el token como revocado.
- ✅ Después de logout, refresh con ese token falla.
- ✅ Cleanup borra solo tokens expirados.

---

## Criterios de aceptación

- [ ] Tabla `refresh_tokens` migrada con índices.
- [ ] `LoginUseCase` persiste el hash del refresh token al loguear.
- [ ] `RefreshTokenUseCase` rota: invalida viejo + emite nuevo en una transacción.
- [ ] Replay detectado revoca toda la familia.
- [ ] `POST /auth/logout` revoca el token actual.
- [ ] Cleanup automático de tokens expirados.
- [ ] Tests unitarios + integración cubriendo los flujos clave.

---

## Decisiones de diseño con justificación

| Decisión | Por qué |
|---|---|
| Hash SHA-256 del token, no el token crudo | Si se filtra la DB, los tokens persistidos no son usables. SHA-256 sin sal porque el token tiene 256+ bits de entropía propia. Bcrypt sería overkill (lento) sin agregar seguridad. |
| `family_id` por sesión de login | Permite revocar **todos** los tokens emitidos desde un login concreto cuando se detecta replay. |
| Revocar la familia en replay (no solo el token actual) | Si solo revocas el token usado, el atacante (que tiene el token siguiente de la cadena) sigue dentro. Solo cortando la familia entera lo expulsas. |
| Refresh tokens en DB (no JWT-stateless puros) | JWT puros no se pueden revocar antes de su expiración. Para "logout real" hace falta estado en DB. |
| Operación de rotación dentro de UoW | Atomicidad: revocar viejo + crear nuevo deben pasar juntos o no pasar. Si crashea a la mitad, el usuario queda sin acceso. |

---

## Riesgos conocidos

| Riesgo | Mitigación |
|---|---|
| Race condition: dos refresh concurrentes con el mismo token (legítimo, ej. dos pestañas) | Tomar `FOR UPDATE` lock sobre la fila al leerla. Solo uno gana, el otro recibe "ya rotado". El front-end debe reintentar con el token nuevo. |
| Tabla crece sin límite | Job de cleanup diario + índice parcial en `expires_at WHERE revoked_at IS NULL`. |
| Cliente (frontend) no actualiza el refresh token tras la rotación | Documentar bien la respuesta del endpoint. El front debe reemplazar el RT en cada `/refresh`, no solo el access. |
| Detección de replay expulsa al usuario legítimo en flujos extraños (red lenta + reintentos) | Aceptable. Si pasa con frecuencia, considerar un grace period de N segundos donde el token recién rotado puede usarse de nuevo. Empezar sin grace period y monitorear. |

---

## Recursos

- [Auth0 — Refresh Token Rotation](https://auth0.com/docs/secure/tokens/refresh-tokens/refresh-token-rotation) — el estándar de facto del patrón.
- [OWASP JWT Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html) — atacks que la implementación debe resistir.
- [RFC 6749 §10.4](https://datatracker.ietf.org/doc/html/rfc6749#section-10.4) — el RFC OAuth2 sobre refresh tokens.

---

## Tiempo estimado

- Migration + entity + VO + repo: 3-4 h
- LoginUseCase + RefreshTokenUseCase reescrito: 3-4 h
- LogoutUseCase + endpoint: 1 h
- Cleanup job: 1 h
- Tests (unit + integration): 3-4 h

**Total: 2-3 días de trabajo concentrado.**
