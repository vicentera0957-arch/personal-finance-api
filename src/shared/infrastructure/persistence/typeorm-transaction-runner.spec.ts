import { DataSource, QueryRunner } from 'typeorm';
import { TypeOrmTransactionRunner } from './typeorm-transaction-runner';
import { NestedTransactionError } from './nested-transaction.error';

// Excepción de dominio real (no una fabricada para el test) — es la que
// protege el `instanceof` de todos los controllers en el caso "la excepción
// llega intacta".
class FakeDomainException extends Error {
  constructor(id: string) {
    super(`fake domain exception for ${id}`);
    this.name = 'FakeDomainException';
  }
}

interface TestCtx {
  readonly marker: string;
}

class TestRunner extends TypeOrmTransactionRunner<TestCtx> {
  constructor(dataSource: DataSource) {
    super(dataSource);
  }

  protected createContext(): TestCtx {
    return { marker: 'ctx' };
  }
}

interface MockQueryRunner {
  connect: jest.Mock<Promise<void>, []>;
  startTransaction: jest.Mock<Promise<void>, []>;
  commitTransaction: jest.Mock<Promise<void>, []>;
  rollbackTransaction: jest.Mock<Promise<void>, []>;
  release: jest.Mock<Promise<void>, []>;
  isTransactionActive: boolean;
  isReleased: boolean;
}

function makeQueryRunner(log: string[]): MockQueryRunner {
  return {
    connect: jest.fn().mockImplementation(async () => {
      log.push('connect');
    }),
    startTransaction: jest.fn().mockImplementation(async () => {
      log.push('startTransaction');
    }),
    commitTransaction: jest.fn().mockImplementation(async () => {
      log.push('commitTransaction');
    }),
    rollbackTransaction: jest.fn().mockImplementation(async () => {
      log.push('rollbackTransaction');
    }),
    release: jest.fn().mockImplementation(async () => {
      log.push('release');
    }),
    isTransactionActive: true,
    isReleased: false,
  };
}

function makeDataSource(qr: MockQueryRunner): {
  dataSource: DataSource;
  createQueryRunner: jest.Mock;
} {
  const createQueryRunner = jest
    .fn()
    .mockReturnValue(qr as unknown as QueryRunner);
  return {
    dataSource: { createQueryRunner } as unknown as DataSource,
    createQueryRunner,
  };
}

describe('TypeOrmTransactionRunner', () => {
  it('camino feliz: startTransaction → work → commitTransaction → release, sin rollback', async () => {
    const log: string[] = [];
    const qr = makeQueryRunner(log);
    const { dataSource } = makeDataSource(qr);
    const runner = new TestRunner(dataSource);

    await runner.run(async (ctx) => {
      expect(ctx.marker).toBe('ctx');
      log.push('work');
      return undefined;
    });

    expect(log).toEqual([
      'connect',
      'startTransaction',
      'work',
      'commitTransaction',
      'release',
    ]);
    expect(qr.rollbackTransaction).not.toHaveBeenCalled();
  });

  it('el callback lanza: rollback llamado, commit no, release sí', async () => {
    const log: string[] = [];
    const qr = makeQueryRunner(log);
    const { dataSource } = makeDataSource(qr);
    const runner = new TestRunner(dataSource);

    await expect(
      runner.run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(qr.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(qr.commitTransaction).not.toHaveBeenCalled();
    expect(qr.release).toHaveBeenCalledTimes(1);
  });

  it('la excepción llega intacta: el instanceof de dominio sobrevive al runner', async () => {
    const qr = makeQueryRunner([]);
    const { dataSource } = makeDataSource(qr);
    const runner = new TestRunner(dataSource);

    await expect(
      runner.run(async () => {
        throw new FakeDomainException('b1');
      }),
    ).rejects.toBeInstanceOf(FakeDomainException);
  });

  it('el valor de retorno se propaga', async () => {
    const qr = makeQueryRunner([]);
    const { dataSource } = makeDataSource(qr);
    const runner = new TestRunner(dataSource);

    const result = await runner.run(async () => 42);

    expect(result).toBe(42);
  });

  it('release() siempre corre, también cuando commitTransaction lanza', async () => {
    const qr = makeQueryRunner([]);
    qr.commitTransaction.mockRejectedValueOnce(new Error('commit failed'));
    const { dataSource } = makeDataSource(qr);
    const runner = new TestRunner(dataSource);

    await expect(runner.run(async () => 'ok')).rejects.toThrow('commit failed');

    expect(qr.release).toHaveBeenCalledTimes(1);
  });

  it('el rollback que falla no enmascara el error original', async () => {
    const qr = makeQueryRunner([]);
    qr.rollbackTransaction.mockRejectedValueOnce(new Error('rollback failed'));
    const { dataSource } = makeDataSource(qr);
    const runner = new TestRunner(dataSource);

    await expect(
      runner.run(async () => {
        throw new Error('original error');
      }),
    ).rejects.toThrow('original error');

    expect(qr.release).toHaveBeenCalledTimes(1);
  });

  it('anidamiento: run(() => run(() => …)) lanza NestedTransactionError; el QueryRunner interno nunca se crea', async () => {
    const qr = makeQueryRunner([]);
    const { dataSource, createQueryRunner } = makeDataSource(qr);
    const runner = new TestRunner(dataSource);

    await expect(
      runner.run(async () => {
        return runner.run(async () => 'inner');
      }),
    ).rejects.toBeInstanceOf(NestedTransactionError);

    expect(createQueryRunner).toHaveBeenCalledTimes(1);
  });

  it('secuencial no es anidamiento: await run(…); await run(…) no lanza', async () => {
    const qr = makeQueryRunner([]);
    const { dataSource, createQueryRunner } = makeDataSource(qr);
    const runner = new TestRunner(dataSource);

    await runner.run(async () => 'first');
    await runner.run(async () => 'second');

    expect(createQueryRunner).toHaveBeenCalledTimes(2);
  });

  // La adquisicion (connect + startTransaction) corre ANTES de entrar al
  // callback que tiene el `finally { release() }`. Sin un try propio ahi, un
  // fallo en esa ventana deja la conexion tomada del pool para siempre.
  describe('fallo al abrir la transaccion: la conexion vuelve al pool', () => {
    it('startTransaction lanza: release() SI corre y el error original se propaga', async () => {
      const log: string[] = [];
      const qr = makeQueryRunner(log);
      const boom = new Error('connection terminated unexpectedly');
      qr.startTransaction.mockImplementation(async () => {
        log.push('startTransaction:throw');
        throw boom;
      });
      const { dataSource } = makeDataSource(qr);
      const runner = new TestRunner(dataSource);

      await expect(runner.run(async () => 'never')).rejects.toBe(boom);

      expect(log).toEqual(['connect', 'startTransaction:throw', 'release']);
      expect(qr.release).toHaveBeenCalledTimes(1);
      expect(qr.commitTransaction).not.toHaveBeenCalled();
      expect(qr.rollbackTransaction).not.toHaveBeenCalled();
    });

    it('connect lanza: release() corre igual y el error original se propaga', async () => {
      const log: string[] = [];
      const qr = makeQueryRunner(log);
      const boom = new Error('too many clients already');
      qr.connect.mockImplementation(async () => {
        log.push('connect:throw');
        throw boom;
      });
      const { dataSource } = makeDataSource(qr);
      const runner = new TestRunner(dataSource);

      await expect(runner.run(async () => 'never')).rejects.toBe(boom);

      expect(log).toEqual(['connect:throw', 'release']);
      expect(qr.startTransaction).not.toHaveBeenCalled();
    });

    it('el release que falla no enmascara el error de apertura', async () => {
      const qr = makeQueryRunner([]);
      const boom = new Error('connection terminated unexpectedly');
      qr.startTransaction.mockRejectedValue(boom);
      qr.release.mockRejectedValue(new Error('release failed'));
      const { dataSource } = makeDataSource(qr);
      const runner = new TestRunner(dataSource);

      await expect(runner.run(async () => 'never')).rejects.toBe(boom);
    });

    it('el callback NUNCA corre si la transaccion no se pudo abrir', async () => {
      const qr = makeQueryRunner([]);
      qr.startTransaction.mockRejectedValue(new Error('boom'));
      const { dataSource } = makeDataSource(qr);
      const runner = new TestRunner(dataSource);
      const work = jest.fn().mockResolvedValue('x');

      await expect(runner.run(work)).rejects.toThrow('boom');

      expect(work).not.toHaveBeenCalled();
    });

    it('un fallo de apertura no deja la cadena async marcada: el run() siguiente no cree estar anidado', async () => {
      const failing = makeQueryRunner([]);
      failing.startTransaction.mockRejectedValue(new Error('boom'));
      const runnerA = new TestRunner(makeDataSource(failing).dataSource);

      await expect(runnerA.run(async () => 'never')).rejects.toThrow('boom');

      // Si el fallo hubiera dejado el AsyncLocalStorage marcado, esto tiraria
      // NestedTransactionError en vez de completar.
      const ok = makeQueryRunner([]);
      const runnerB = new TestRunner(makeDataSource(ok).dataSource);

      await expect(runnerB.run(async () => 'ok')).resolves.toBe('ok');
    });
  });
});
