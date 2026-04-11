# Auth Module & Ownership Validation

## Overview

Este módulo maneja autenticación JWT global y colabora con la validación de ownership de recursos en toda la API.

## Arquitectura de Autenticación

### JwtAuthGuard (Global)
- **Ubicación:** `infrastructure/guards/jwt-auth.guard.ts`
- **Configuración:** Registrado como `APP_GUARD` en `auth.module.ts`
- **Comportamiento:** Valida JWT en cada request (excepto rutas marcadas con `@Public()`)
- **Payload del token:** `{ sub: userId, email: string, iat, exp }`

### @CurrentUser() Decorator
- **Ubicación:** `infrastructure/decorators/current-user.decorator.ts`
- **Tipo:** `AuthenticatedUser = { userId: string, email: string }`
- **Uso:** Inyecta el user autenticado en parámetros de controller
- **Scope:** Solo funciona en rutas protegidas (con JwtAuthGuard)

### Flujo de Autenticación
```
1. Cliente → POST /auth/register | /auth/login
2. Backend genera JWT con sub = userId
3. Cliente envía JWT en Authorization: Bearer header
4. JwtAuthGuard valida firma y extrae { userId, email }
5. @CurrentUser() lo inyecta en controller methods
6. Use cases reciben requestUserId para validar ownership
```

## Ownership Validation (Implementado 2026-04-11)

### Principio Arquitectónico

**"La validación de ownership ocurre en el use case, nunca en el controller ni en la entidad."**

Razones:
- **Seguridad por construcción:** Un use case no puede olvidar la validación
- **Testeable:** No requiere HTTP mocks
- **Consistente:** Patrón único en toda la codebase
- **DRY:** Los "get by id" use cases son la puerta central

### Excepción Genérica Compartida

**Archivo:** `src/shared/domain/exceptions/resource-ownership.exception.ts`

```typescript
export class ResourceOwnershipException extends Error {
  constructor(resourceId: string) {
    super(`You do not have access to resource ${resourceId}`);
    this.name = 'ResourceOwnershipException';
  }
}
```

**Mapeo HTTP:** Controllers convierten esto a `ForbiddenException` (403)

### Patrones Implementados

#### Patrón 1: Get-by-ID Use Cases (Puerta Central)

Estos 4 use cases son el punto de validación clave. Todos los demás usan cases que los invocan heredan la protección.

```typescript
// ANTES
async execute(id: string): Promise<Account> {
  const account = await this.accountRepository.findById(id);
  if (!account) throw new AccountNotFoundException(id);
  return account;
}

// DESPUÉS
async execute(id: string, requestUserId: string): Promise<Account> {
  const account = await this.accountRepository.findById(id);
  if (!account) throw new AccountNotFoundException(id);
  if (account.userId !== requestUserId) {
    throw new ResourceOwnershipException(id);
  }
  return account;
}
```

**Afectados:**
- `GetAccountByIdUseCase`
- `GetCategoryByIdUseCase`
- `GetBudgetByIdUseCase`
- `GetTransactionByIdUseCase`

#### Patrón 2: Operaciones que Delegan a Get-by-ID

Cualquier use case que usa `getXByIdUseCase` automáticamente hereda la validación.

```typescript
// RenameAccountUseCase, ArchiveAccountUseCase, etc.
async execute(dto: RenameAccountDto): Promise<Account> {
  const account = await this.getAccountByIdUseCase.execute({
    id: dto.id,
    requestUserId: dto.requestUserId,  // Nuevo parámetro
  });
  account.rename(dto.name);
  return this.accountRepository.save(account);
}
```

**Afectados:** 12 use cases (rename, archive, unarchive, delete en accounts/categories/budgets)

#### Patrón 3: Cross-Module Ownership Checks

Use cases que crean recursos necesitan validar que los datos relacionados (account, category) pertenecen al mismo usuario.

```typescript
// CreateBudgetUseCase
async execute(command: CreateBudgetCommand): Promise<Budget> {
  // Valida que category existe Y pertenece al usuario
  const category = await this.getCategoryByIdUseCase.execute(
    command.categoryId,
    command.userId,  // Pasa userId del comando
  );
  // ... resto de lógica
}

// CreateTransactionUseCase
async execute(command: CreateTransactionCommand): Promise<Transaction> {
  // Ambas llamadas validan ownership
  await this.getAccountByIdUseCase.execute({
    id: command.accountId,
    requestUserId: command.userId,
  });
  const category = await this.getCategoryByIdUseCase.execute(
    command.categoryId,
    command.userId,
  );
  // ... resto de lógica
}
```

**Afectados:**
- `CreateBudgetUseCase` (valida category)
- `CreateTransactionUseCase` (valida account + category)
- `GetTransactionsByAccountIdUseCase` (valida account)

#### Patrón 4: User Self-Access

El módulo de usuarios valida que solo puedas acceder a tu propio perfil.

```typescript
// GetUserByIdUseCase, UpdateUserProfileUseCase, DeleteUserUseCase
async execute(dto: GetUserByIdDto): Promise<User> {
  if (dto.id !== dto.requestUserId) {
    throw new ResourceOwnershipException(dto.id);
  }
  const user = await this.userRepository.findById(dto.id);
  if (!user) throw new UserNotFoundException(dto.id);
  return user;
}
```

### Controllers: Cambios Transversales

Todos los 5 controllers (accounts, categories, budgets, transactions, users) recibieron:

1. **Imports de @CurrentUser() y tipos**
   ```typescript
   import { CurrentUser } from '../../../../auth/infrastructure/decorators/current-user.decorator';
   import type { AuthenticatedUser } from '../../../../auth/infrastructure/decorators/current-user.decorator';
   import { ResourceOwnershipException } from '../../../../../shared/domain/exceptions/resource-ownership.exception';
   ```

2. **@CurrentUser() en cada método**
   ```typescript
   async findById(
     @Param('id', ParseUUIDPipe) id: string,
     @CurrentUser() user: AuthenticatedUser,  // Nuevo
   ): Promise<Response> { ... }
   ```

3. **Extracción de userId desde JWT, no desde body**
   ```typescript
   // ANTES
   const account = await this.createAccountUseCase.execute({
     userId: dto.userId,  // ❌ Del request body
     // ...
   });

   // DESPUÉS
   const account = await this.createAccountUseCase.execute({
     userId: user.userId,  // ✅ Del JWT token
     // ...
   });
   ```

4. **Mapeo de excepción a HTTP 403**
   ```typescript
   try {
     // ...
   } catch (e) {
     if (e instanceof ResourceOwnershipException) {
       throw new ForbiddenException(e.message);  // 403
     }
   }
   ```

5. **Rutas de listado solo con JWT (sin parámetro de URL)**
   ```typescript
   // ANTES: GET /accounts/user/:userId
   @Get('user/:userId')
   async findByUserId(@Param('userId') userId: string): Promise<...> {
     // Cliente podía pasar cualquier userId
   }

   // DESPUÉS: GET /accounts
   @Get()
   async findByUserId(@CurrentUser() user: AuthenticatedUser): Promise<...> {
     // Solo puede listar sus propios recursos
     await this.getAccountsByUserIdUseCase.execute({ userId: user.userId });
   }
   ```

### DTOs HTTP: Eliminación de userId

Los DTOs de **creación** ya no aceptan `userId` en el body (es redundante y un vector de ataque):

```typescript
// ANTES
export class CreateAccountDto {
  @IsUUID()
  @IsNotEmpty()
  userId: string;  // ❌ Cliente especificaba el userId
  // ...
}

// DESPUÉS
export class CreateAccountDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  name: string;
  // ... (sin userId)
}
```

**DTOs Afectados:**
- `CreateAccountDto`
- `CreateCategoryDto`
- `CreateBudgetDto`
- `CreateTransactionDto`

## Matriz de Cambios

| Use Case | Cambio | Razón |
|----------|--------|-------|
| GetAccountByIdUseCase | Agregar `requestUserId` param | Puerta central de validación |
| RenameAccountUseCase | Agregar `requestUserId` param | Pasa a GetAccountByIdUseCase |
| ArchiveAccountUseCase | Agregar `requestUserId` param | Pasa a GetAccountByIdUseCase |
| UnarchiveAccountUseCase | Agregar `requestUserId` param | Pasa a GetAccountByIdUseCase |
| DeleteAccountUseCase | Agregar `requestUserId` param | Pasa a GetAccountByIdUseCase |
| CreateBudgetUseCase | Validar category.userId | Cross-module ownership |
| CreateTransactionUseCase | Validar account + category | Cross-module ownership |
| GetTransactionsByAccountIdUseCase | Validar account.userId | Impide enumeration de cuentas ajenas |
| GetUserByIdUseCase | Agregar self-access check | Solo acceso a propio perfil |
| UpdateUserProfileUseCase | Agregar self-access check | Solo actualizar propio perfil |
| DeleteUserUseCase | Agregar self-access check | Solo eliminar propia cuenta |

## Ejemplos de Uso

### Crear una Cuenta (cliente)

```bash
# Cliente registrado con userId = abc-123
curl -X POST http://localhost:3000/accounts \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Mi Cuenta Corriente",
    "type": "corriente",
    "initialBalance": 5000
  }'

# ✅ La cuenta se crea con userId = abc-123 (del JWT)
# ❌ Si alguien intenta pasar "userId": "xyz-789" en el body, será ignorado
```

### Obtener una Cuenta de Otro Usuario

```bash
# Cliente con userId = abc-123 intenta acceder a cuenta de xyz-789
curl -X GET http://localhost:3000/accounts/account-id-xyz \
  -H "Authorization: Bearer <jwt-token-abc>"

# GetAccountByIdUseCase.execute(id, "abc-123")
# Carga la account → account.userId = "xyz-789"
# Compara: "xyz-789" !== "abc-123"
# → Lanza ResourceOwnershipException
# → Controller convierte a ForbiddenException
# → Retorna 403 Forbidden
```

### Listar Propias Cuentas

```bash
# ANTES (vulnerable)
curl -X GET http://localhost:3000/accounts/user/otro-usuario-id \
  -H "Authorization: Bearer <jwt>"
# ❌ Podía listar cuentas de otro usuario

# DESPUÉS (seguro)
curl -X GET http://localhost:3000/accounts \
  -H "Authorization: Bearer <jwt>"
# ✅ Solo lista cuentas del usuario autenticado
# El parámetro :userId fue eliminado
```

## Testing

### Unit Tests de Use Cases

Para los nuevos parámetros `requestUserId`:

```typescript
it('should throw ResourceOwnershipException when user does not own account', async () => {
  const account = Account.create({
    id: 'acc-1',
    userId: 'user-A',  // Account pertenece a user-A
    // ...
  });
  await accountRepository.save(account);

  // Intenta acceder con user-B
  expect(() =>
    getAccountByIdUseCase.execute({
      id: 'acc-1',
      requestUserId: 'user-B',  // ← Different user
    })
  ).rejects.toThrow(ResourceOwnershipException);
});
```

### Integration Tests de Controllers

```typescript
it('should return 403 when accessing another user\'s account', async () => {
  const token_A = await authService.login('user-a@example.com', 'password');
  const accountB = await createAccountAs('user-b@example.com');

  const response = await request(app.getHttpServer())
    .get(`/accounts/${accountB.id}`)
    .set('Authorization', `Bearer ${token_A}`);

  expect(response.status).toBe(403);
  expect(response.body.message).toContain('do not have access');
});
```

## Decisiones de Diseño

### ¿Por qué validación en use case, no en controller?

1. **Seguridad por defecto:** Un use case nuevo no puede olvidar la validación
2. **DDD:** La lógica de negocio (quién puede acceder a qué) es dominio, no infraestructura
3. **Testeable sin HTTP:** `expect(() => useCase.execute(...)).toThrow(ResourceOwnershipException)`
4. **Reutilizable:** Otros módulos llaman a estos use cases y heredan la protección

### ¿Por qué eliminar :userId de las rutas?

- **Seguridad:** Elimina el vector de pasar un parámetro malicioso
- **Simplic idad:** La ruta no necesita saber el userId (viene del JWT)
- **REST puro:** Un recurso es identificado por su ID, no por quién lo pide
- **Consistencia:** Patrón `/me` es estándar (Spotify, GitHub, etc.)

### ¿Por qué ResourceOwnershipException es genérica?

- **Escalabilidad:** Uno de cada tipo sería 20+ excepciones para nada
- **HTTP mapping:** Todos mapean a 403 Forbidden
- **Logs:** `ResourceOwnershipException(resourceId)` es suficiente contexto
- **YAGNI:** No necesitamos granularidad si no la usamos

## Qué NO fue tocado

Estos componentes **no fueron modificados** porque no es necesario:

- `UpdateAccountBalanceUseCase` — Interno (solo llamado por transactions con lock)
- `GetBudgetByUserCategoryPeriodUseCase` — Interno (solo CreateTransactionUseCase)
- `GetUserByEmailUseCase` — Solo para login (flujo público)
- Domain entities (Account, Category, etc.) — No tienen lógica de ownership
- Repositories — Solo hacen queries, no validación
- Value Objects — Inalterados

## Próximos Pasos Opcionales

Estos NO están incluidos en esta implementación pero son recomendados:

1. **Admin routes:** `GET /admin/accounts?userId=xyz` para super-users
2. **Audit logging:** Registrar intentos de acceso denegado
3. **Rate limiting:** Proteger contra fuerza bruta de IDs
4. **Refresh token rotation:** Cada refresh genera un nuevo token
5. **Token blacklist:** Revocar tokens manualmente (logout)

## Referencias

- **Plan:** `C:\Users\Vicen\.claude\plans\cozy-beaming-bengio.md`
- **Exception base:** `src/shared/domain/exceptions/resource-ownership.exception.ts`
- **Decorator:** `src/modules/auth/infrastructure/decorators/current-user.decorator.ts`
- **Guard:** `src/modules/auth/infrastructure/guards/jwt-auth.guard.ts`

---

**Implementado:** 2026-04-11  
**Modelo:** Claude Haiku 4.5  
**Status:** ✅ Completo
