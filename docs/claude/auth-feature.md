# Auth Module — Feature Notes

## Resumen

Módulo de autenticación basado en JWT con estrategia dual (access + refresh tokens),
guard global "deny by default", y arquitectura Ports & Adapters alineada con el DDD del proyecto.

## Arquitectura

```
src/modules/auth/
  domain/
    ports/
      password-hasher.port.ts    # Contrato: hash + compare
      token-provider.port.ts     # Contrato: generate + verify tokens
  application/
    use-cases/
      login.use-case.ts          # Email + password → TokenPair
      register.use-case.ts       # Crea user + genera TokenPair
      refresh-token.use-case.ts  # Refresh token viejo → TokenPair nuevo
  infrastructure/
    adapters/
      bcrypt-password-hasher.ts  # IPasswordHasher → bcrypt (10 salt rounds)
      jwt-token-provider.ts      # ITokenProvider → @nestjs/jwt
    decorators/
      current-user.decorator.ts  # @CurrentUser() extrae userId+email del request
      public.decorator.ts        # @Public() marca rutas que no requieren JWT
    guards/
      jwt.strategy.ts            # Passport strategy: Bearer token → payload
      jwt-auth.guard.ts          # Guard global con soporte @Public()
    http/
      dto/                       # login.dto, register.dto, refresh-token.dto
      auth-controller/           # POST /auth/login, /register, /refresh
  auth.module.ts
```

## Endpoints

| Method | Route            | Auth     | Descripción                           |
|--------|------------------|----------|---------------------------------------|
| POST   | `/auth/register` | @Public  | Crea usuario y retorna token pair     |
| POST   | `/auth/login`    | @Public  | Valida credenciales, retorna tokens   |
| POST   | `/auth/refresh`  | @Public  | Renueva token pair con refresh token  |

## Estrategia de tokens

- **Access token**: 15 minutos, firmado con `JWT_SECRET`
- **Refresh token**: 7 días, firmado con `JWT_REFRESH_SECRET` (secret separado)
- Ambos secrets se validan al arrancar la app via `ConfigModule` + `Joi`

## Guard global

Registrado en `app.module.ts` como `APP_GUARD`. Todas las rutas requieren JWT salvo
las marcadas con `@Public()`. Esto garantiza que si un dev olvida proteger una ruta,
queda protegida por defecto.

## Decisiones de diseño

### Ports & Adapters para hasher y tokens
- `IPasswordHasher` y `ITokenProvider` son abstract classes (no interfaces) para servir como DI tokens en NestJS
- Permite cambiar bcrypt por argon2 o JWT por otro sistema sin tocar use cases

### @CurrentUser() decorator
- Extrae `{ userId, email }` del `request.user` (puesto ahí por JwtStrategy.validate)
- Evita acceder a `@Req()` directamente en controllers — tipado y limpio

### Validación de env vars
- `ConfigModule.forRoot()` con schema Joi valida `JWT_SECRET` y `JWT_REFRESH_SECRET` al startup
- La app **no arranca** si faltan los secrets — fail fast en vez de fallar silenciosamente

### Excepciones de dominio en el controller
- Login: tanto `UserNotFoundException` como `InvalidCredentialsException` → 401 (no revela si el email existe)
- Register: `UserAlreadyExistsException` → 409 Conflict

## Qué NO incluye (decisiones conscientes para v1)

- **Revocación de refresh tokens**: no hay blacklist ni tabla de tokens. Si un refresh token se compromete, hay que esperar 7 días. Aceptable para MVP.
- **Ownership enforcement**: el guard verifica identidad, no autorización sobre recursos. Cada módulo (accounts, budgets, etc.) debe filtrar por userId en sus use cases.
- **Rate limiting**: no hay throttling en login/register. Agregar `@nestjs/throttler` cuando se exponga a internet.
- **Logout endpoint**: sin revocación server-side, logout es solo client-side (borrar tokens).
