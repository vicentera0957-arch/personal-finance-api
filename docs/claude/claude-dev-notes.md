3. inflow y outflow no verifican si la cuenta está archivada --LISTO

// ❌ account.entity.ts
inflow(amount: Balance): void {
if (amount.isZero()) { ... }
this.currentBalance = this.currentBalance.add(amount);
}

Se puede hacer inflow y outflow a una cuenta archivada. Esto es una violación de
invariante de negocio. Si rename() verifica el estado de archivo, inflow() y  
 outflow() también deberían hacerlo.

---

4. adjustBalance recibe un reason que no usa para nada -- CONSULTAR

// account.entity.ts
adjustBalance(newBalance: Balance, reason: string): void {
if (!reason || reason.trim().length === 0) {
throw new Error('El motivo del ajuste es requerido');
}
this.currentBalance = newBalance; // ← reason se valida pero desaparece  
 this.updatedAt = new Date();
}

Si el reason es requerido, debe persistirse (audit log, campo en la entidad, o  
 evento de dominio). Si no va a persistirse, el parámetro no tiene sentido.  
 Decisión de diseño pendiente: o lo guardás, o lo eliminás.

---

5. AccountsModule exporta IAccountRepository — esto es peligroso -- pedir explicar

// accounts.module.ts
exports: [GetAccountByIdUseCase, IAccountRepository], // ← ❌

Por qué es un problema: Si TransactionsModule importa AccountsModule y obtiene  
 IAccountRepository, puede bypassear todos los use cases y los invariantes de  
 dominio. Imaginate que TransactionUseCase hace accountRepository.save(account)  
 directamente sin pasar por account.inflow(). El dominio pierde el control.

Lo correcto es exportar solo use cases. El módulo de transactions debe llamar a
GetAccountByIdUseCase para leer la cuenta, y luego probablemente necesitás un  
 use case específico como ApplyTransactionToAccountUseCase que encapsule
inflow/outflow.

---

6. AccountMapper usa Balance.create() en vez de Balance.reconstitute() -- CONSULTAR -- REALIZADO

// account.mapper.ts
toDomain(orm: AccountOrmEntity): Account {
const initialBalance = Balance.create(orm.initialBalance); // ← revalida  
 const currentBalance = Balance.create(orm.currentBalance); // ← revalida

Cuando reconstruís desde la DB, los datos ya son válidos (el dominio los  
 escribió). Re-ejecutar Balance.create() significa que si algún día los datos  
 históricos tienen valores que no pasan la nueva validación (ej: lógica de  
 negocio que cambió), el sistema explota al leer datos viejos. Para eso existe  
 Balance.reconstitute(). Compará con tu propio user.mapper.ts... aunque ahí  
 también hay la misma tensión con Email.create().

---

7. @UpdateDateColumn en TypeORM + updatedAt manejado por el dominio — hay  
   tensión -- LISTO

// user.orm.entity.ts
@UpdateDateColumn({ name: 'updated_at' })
updatedAt: Date;

TypeORM con @UpdateDateColumn sobreescribe el updatedAt en cada save() con el  
 timestamp del momento del save. Pero vos seteas orm.updatedAt =
domain.getUpdatedAt() en el mapper. El valor que ponés en el mapper es ignorado
— TypeORM lo overridea. Esto significa que el dominio "cree" que controla ese  
 timestamp, pero en realidad no lo controla.

Opciones:

- Usar @Column({ name: 'updated_at' }) común y dejar que el dominio controle el
  valor (consistente con tu diseño DDD)
- Aceptar que TypeORM maneja el updatedAt y no intentar setearlo en el mapper

---

8. Balance.create() usa Math.round() silenciosamente -- LISTO

// balance.vo.ts
static create(amount: number): Balance {
if (!Number.isInteger(amount)) {
throw new Error('El balance no acepta decimales (CLP no tiene centavos)');
}
return new Balance(amount);
}

Cambio: Ahora rechaza explícitamente decimales en lugar de redondearlos silenciosamente. En un sistema financiero, el redondeo oculto es peligroso (1000.5 → 1001 sin avisar). La solución es validar que sea entero en el factory method, garantizando que ningún dato no-entero pueda entrar al dominio.

---

9. bcrypt directamente en el use case — el comentario ya lo anticipaste

// create-user.use-case.ts
import \* as bcrypt from 'bcrypt';
// "despues haremos una interfaz de password hashing"

Esto ya lo identificaste en el código. Cuando lo implementes, la interfaz  
 correcta es:

// domain/services/password-hasher.interface.ts
export abstract class IPasswordHasher {
abstract hash(plain: string): Promise<string>;
abstract compare(plain: string, hash: string): Promise<boolean>;
}

El use case recibe el IPasswordHasher por DI. La implementación con bcrypt va en
infrastructure. El dominio no sabe qué algoritmo se usa.

---

10. Value Objects lanzan Error genérico en lugar de excepciones de dominio -- LISTO

**ANTES:** Email.create(), Balance.create(), AccountType.create() lanzaban Error genérico
**AHORA:** Excepciones específicas de dominio para mejor testing y logs

Excepciones agregadas:
- Accounts: InvalidBalanceException, InvalidAccountTypeException
- Users: EmptyEmailException, InvalidEmailFormatException

**Ventajas:**
- Testing claro: `expect(() => Email.create(...)).toThrow(InvalidEmailFormatException)`
- Controllers pueden mapear específicamente: 400 para ValidationError, 422 para InvalidBalance, etc.
- Logs semánticamente precisos
- Consistencia: todo el dominio habla el mismo lenguaje
