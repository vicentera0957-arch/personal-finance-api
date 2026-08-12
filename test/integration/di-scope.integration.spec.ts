import { INestApplication } from '@nestjs/common';
import { createTestApp } from '../helpers/app-bootstrap';
import { UsersController } from '../../src/modules/users/infrastructure/http/user-controller/user.controller';
import { AuthController } from '../../src/modules/auth/infrastructure/http/auth-controller/auth.controller';
import { AccountsController } from '../../src/modules/accounts/infrastructure/http/accounts-controller/accounts.controller';
import { CategoriesController } from '../../src/modules/categories/infrastructure/http/categories-controller/categories.controller';
import { TransactionsController } from '../../src/modules/transactions/infrastructure/http/transactions-controller/transactions.controller';
import { BudgetsController } from '../../src/modules/budgets/infrastructure/http/budgets-controller/budgets.controller';
import { ReportsController } from '../../src/modules/reports/infrastructure/http/reports-controller/reports.controller';
import { ITransactionUnitOfWork } from '../../src/modules/transactions/domain/ITransactionUnitOfWork';
import { IBudgetUnitOfWork } from '../../src/modules/budgets/domain/IBudgetUnitOfWork';
import { IAccountUnitOfWork } from '../../src/modules/accounts/domain/IAccountUnitOfWork';
import { IAuthUnitOfWork } from '../../src/modules/auth/domain/IAuthUnitOfWork';

/**
 * docs/history/structural-refactors.md, P3+P4 (§3.6 of the archived plan) — regression net for P3 (dropping `Scope.REQUEST` from the
 * four UoW providers).
 *
 * `Scope.REQUEST` on a provider is contagious: NestJS makes every consumer
 * of a request-scoped provider request-scoped too, transitively, all the
 * way up to the controller (`isDependencyTreeStatic()` returns false for
 * the whole chain). Before this plan, 4 of the 7 domain controllers were
 * silently rebuilt on every request because their dependency tree touched a
 * request-scoped UoW.
 *
 * A `grep -rn "Scope\." src` catches the literal decorator, but it cannot
 * prove the *effect* — that Nest resolved every controller as a singleton.
 * This suite proves the effect directly: resolving each domain controller
 * from the root injector twice must return the exact same instance. If a
 * future change reintroduces `Scope.REQUEST` anywhere in a controller's
 * transitive dependency graph, Nest gives that controller its own
 * per-resolution instance and this identity check fails — a probe no grep
 * can replicate.
 *
 * Not run locally: requires the real Postgres + Redis services the CI job
 * provides (see `test/helpers/app-bootstrap.ts`).
 */
describe('DI scope: every domain controller and UoW port is a singleton', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const controllers = [
    ['UsersController', UsersController],
    ['AuthController', AuthController],
    ['AccountsController', AccountsController],
    ['CategoriesController', CategoriesController],
    ['TransactionsController', TransactionsController],
    ['BudgetsController', BudgetsController],
    ['ReportsController', ReportsController],
  ] as const;

  it.each(controllers)('%s resolves without throwing', (_name, Controller) => {
    expect(() => app.get(Controller)).not.toThrow();
  });

  it.each(controllers)(
    '%s is a singleton: app.get(C) === app.get(C)',
    (_name, Controller) => {
      expect(app.get(Controller)).toBe(app.get(Controller));
    },
  );

  // Direct probe on the four module-specific UoW tokens, one level below the
  // controllers: this is the exact provider that used to carry
  // `Scope.REQUEST` and drag every consumer above it along.
  const uowPorts = [
    ['ITransactionUnitOfWork', ITransactionUnitOfWork],
    ['IBudgetUnitOfWork', IBudgetUnitOfWork],
    ['IAccountUnitOfWork', IAccountUnitOfWork],
    ['IAuthUnitOfWork', IAuthUnitOfWork],
  ] as const;

  it.each(uowPorts)(
    '%s is a singleton: app.get(X) === app.get(X)',
    (_name, Port) => {
      expect(app.get(Port)).toBe(app.get(Port));
    },
  );
});
