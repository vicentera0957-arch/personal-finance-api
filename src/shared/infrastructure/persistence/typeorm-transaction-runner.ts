import { Logger } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';
import { activeTransaction } from './active-transaction.storage';
import { NestedTransactionError } from './nested-transaction.error';
import { IUnitOfWork } from '../../domain/IUnitOfWork';

/**
 * Clase base para los cuatro impls de UoW.
 *
 * El ciclo de vida (crear QueryRunner → begin → work → commit/rollback →
 * release) vive UNA sola vez acá; cada módulo aporta únicamente
 * `createContext()`, que construye sus recursos escopados sobre el
 * `QueryRunner` de esta transacción. El QueryRunner vive en el stack de la
 * llamada, no en un campo de instancia — por eso el impl puede ser singleton
 * (cierra P3) y por eso es imposible olvidar el release() o hacer un doble
 * begin() (cierra P4).
 *
 * Detección de anidamiento: `activeTransaction` (un AsyncLocalStorage que
 * lleva sólo el nombre del dueño) marca la cadena async mientras run() está
 * en curso. Un segundo run() — del mismo puerto o de otro — en la misma
 * cadena lanza NestedTransactionError antes de crear su propio QueryRunner.
 * Es un runner sin estado: sin este chequeo, dos run() anidados abrirían dos
 * transacciones distintas y podrían deadlockear entre sí en silencio (ver
 * PLAN-P3P4-transactional-runner.md §5).
 *
 * `extends IUnitOfWork<TCtx>`: los 4 impls (`extends
 * TypeOrmTransactionRunner<TCtx> implements IFooUnitOfWork`) ya no heredan
 * de su puerto directamente — heredan de esta clase, que sí hereda del
 * puerto genérico. `implements IFooUnitOfWork` sigue siendo válido porque
 * ese puerto no declara miembros propios más allá de `run()`.
 */
export abstract class TypeOrmTransactionRunner<
  TCtx,
> implements IUnitOfWork<TCtx> {
  private readonly logger = new Logger(TypeOrmTransactionRunner.name);

  protected constructor(private readonly dataSource: DataSource) {}

  /** Único punto de variación entre los cuatro módulos. */
  protected abstract createContext(queryRunner: QueryRunner): TCtx;

  async run<T>(work: (ctx: TCtx) => Promise<T>): Promise<T> {
    const outer = activeTransaction.getStore();
    if (outer) {
      throw new NestedTransactionError(outer.owner, this.constructor.name);
    }

    const qr: QueryRunner = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    const ownerName = this.constructor.name;

    return activeTransaction.run({ owner: ownerName }, async () => {
      // El contexto se invalida apenas run() termina (éxito o error): una
      // referencia que se escapó del callback (asignada a una variable
      // externa) revienta acá con un mensaje que nombra la causa, en vez de
      // un QueryRunnerAlreadyReleasedError genérico salido de TypeORM. No
      // cubre una propiedad ya extraída dentro del callback (`const r =
      // ctx.accounts`) — sólo la fuga del propio `ctx`.
      const live = { value: true };
      const guardedCtx = new Proxy(
        this.createContext(qr) as unknown as Record<string, unknown>,
        {
          get(target: Record<string, unknown>, prop: string | symbol): unknown {
            if (!live.value) {
              throw new Error(
                `El contexto transaccional de ${ownerName} se usó fuera de run(). ` +
                  'Los recursos escopados sólo son válidos dentro del callback: ' +
                  'no los guardes en variables externas.',
              );
            }
            return Reflect.get(target, prop);
          },
        },
      ) as unknown as TCtx;

      try {
        const result = await work(guardedCtx);
        await qr.commitTransaction();
        return result;
      } catch (err) {
        // El error del rollback NUNCA debe enmascarar el error original.
        try {
          if (qr.isTransactionActive) await qr.rollbackTransaction();
        } catch (rollbackErr) {
          this.logger.error(
            `Rollback falló tras un error en ${ownerName}.run(); se propaga ` +
              `el error original. Causa del rollback: ${(rollbackErr as Error).message}`,
          );
        }
        throw err;
      } finally {
        live.value = false;
        await qr.release();
      }
    });
  }
}
