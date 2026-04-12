import { DataSource, QueryRunner } from 'typeorm';

// Minimal DataSource fake for unit tests of use cases that open a transaction.
// The InMemory repos ignore the QueryRunner argument, so we only need to
// satisfy the contract (connect/startTransaction/commit/rollback/release).
export function makeFakeDataSource(): {
  dataSource: DataSource;
  commits: () => number;
  rollbacks: () => number;
} {
  let commits = 0;
  let rollbacks = 0;

  const qr: Partial<QueryRunner> = {
    connect: async () => undefined,
    startTransaction: async () => undefined,
    commitTransaction: async () => {
      commits += 1;
    },
    rollbackTransaction: async () => {
      rollbacks += 1;
    },
    release: async () => undefined,
  };

  const dataSource: Partial<DataSource> = {
    createQueryRunner: () => qr as QueryRunner,
  };

  return {
    dataSource: dataSource as DataSource,
    commits: () => commits,
    rollbacks: () => rollbacks,
  };
}
