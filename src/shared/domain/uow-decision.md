El patron UoW en este proyecto

Nivel 1 - Contrato generico (shared/domain/IUnitOfWork.ts)
Define solo el ciclo de vida transaccional (begin, commit, rollback, release, isActive). No sabe nada de repos. Vive en shared porque "tener una transaccion de DB" es cross-cutting, no pertenece a ningun bounded context.

Nivel 2 - Puerto por modulo (<modulo>/domain/I<Modulo>UnitOfWork.ts)
Cada modulo que necesita atomicidad define su propio puerto que extends IUnitOfWork y anade getters de los repos que ese flujo necesita - incluyendo repos de otros modulos que consume (no solo los propios).

Ejemplo: ITransactionUnitOfWork expone getTransactionRepository() + getAccountRepository() + getBudgetRepository() porque CreateTransaction mantiene invariantes que tocan las tres tablas en una sola transaccion de PostgreSQL.

Este puerto vive en el domain/ del modulo consumidor (patron "port owned by consumer"), aunque devuelva interfaces de repo de otros modulos. Esas interfaces de repo son las del dominio de su modulo dueno (ej. IAccountRepository sigue siendo de accounts/domain), el UoW solo las expone agrupadas segun lo que el caso de uso necesite.

Nivel 3 - Implementacion unica (infrastructure/persistence/unit-of-work.impl.ts)
Una sola clase TypeOrmUnitOfWorkImpl que satisface todos los puertos de UoW cuyos getters sabe servir. Se ata en NestJS con useExisting apuntando todos los puertos al mismo provider request-scoped -> misma instancia, mismo QueryRunner, misma transaccion de DB dentro de una request.

Como lo consume el use case (referencia: create-transaction.use-case.ts:30)

Inyecta el puerto del propio modulo (ITransactionUnitOfWork), nunca el IUnitOfWork generico ni el impl concreto.
begin() -> pide los repos al UoW (que son ScopedXRepository compartiendo el EntityManager del QueryRunner) -> opera -> commit() / rollback() en try/catch -> release() en finally.
Los locks pesimistas (FOR UPDATE) viven dentro de los scoped repos, no en el use case - el use case solo confia en que findById bajo UoW serializa por agregado.

Notas adicionales (por que esta decision es importante)

- Evita acoplar los casos de uso a TypeORM o a DataSource; el dominio conoce solo puertos.
- Permite transacciones consistentes en flujos que cruzan modulos sin romper la regla de dependencias.
- Mantiene un solo QueryRunner por request, evitando transacciones anidadas y estados parciales.
- Hace explicita la combinacion de repos requerida por cada caso de uso, facilitando pruebas y razonamiento.
