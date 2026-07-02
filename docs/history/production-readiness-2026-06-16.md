# Production Readiness — 2026-06

Log of this session's changes to move the API closer to "production ready":
hardened CI, secrets fail-fast, Redis as a hard dependency in the readiness check,
line-ending normalization and dependency scanning. Each section states the **what**,
the **why** and links the **official documentation** of the technology/detail used.

---

## Summary of touched files

**Created**

| File | Purpose |
| --- | --- |
| `.gitattributes` | Force LF in the repo (root cause of the broken lint on Windows) |
| `.github/dependabot.yml` | Automatic update PRs (npm + GitHub Actions) |
| `src/shared/infrastructure/health/redis-health.indicator.ts` | Redis health indicator for `/ready` |
| `src/shared/infrastructure/health/redis-health.indicator.spec.ts` | Indicator tests (up/down) |
| `docs/production-readiness-2026-06-16.md` | This document |

**Modified**

| File | Change |
| --- | --- |
| `.github/workflows/ci.yml` | Rewrite: concurrency, permissions, DRY env, Redis service, `needs` gating, coverage, timeouts + `docker-build` and `security-audit` jobs |
| `.prettierrc` | `endOfLine: "lf"` → `"auto"` (tolerates local CRLF) |
| `src/config/env.validation.ts` | DB_* and REDIS_HOST `required()` in production |
| `src/shared/domain/cache/cache-store.port.ts` | `ping()` method on the port |
| `src/shared/infrastructure/cache/redis-cache-store.ts` | `ping()` implementation |
| `src/shared/infrastructure/health/health.module.ts` | Registers `RedisHealthIndicator` |
| `src/shared/infrastructure/health/health.controller.ts` | `/ready` checks Redis in addition to the DB |
| _(17 more files)_ | `prettier` reformat via `lint:fix` (format only) |

**Final verification:** clean build · lint 0 errors · **595 unit tests green**.

---

## 1. Hardened CI (`.github/workflows/ci.yml`)

7 jobs: `lint`, `build`, `unit-tests`, `integration-tests`, `migration-smoke`,
`docker-build`, `security-audit`.

### What was added and why

- **`concurrency` + `cancel-in-progress`** — multiple pushes to the same PR cancel the old
  in-flight runs; no minutes burned verifying already-obsolete code.
  → https://docs.github.com/en/actions/using-jobs/using-concurrency
- **`permissions: contents: read`** — least privilege for the `GITHUB_TOKEN` (by default
  it can write); CI only reads code.
  → https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication
  · https://docs.github.com/en/actions/using-jobs/assigning-permissions-to-jobs
- **Workflow/job-level `env` (DRY)** — Node version and dummy test secrets in a
  single place (they are toy values, they never touch prod).
  → https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/store-information-in-variables
- **Redis service container** in integration — the suite boots the full `AppModule`,
  which builds a Redis client; it was missing before and passed "by luck".
  → https://docs.github.com/en/actions/using-containerized-services/about-service-containers
  · https://docs.github.com/en/actions/using-containerized-services/creating-redis-service-containers
- **`needs: build`** on the heavy jobs (integration, docker) — no containers are started
  and no image is built if the TS doesn't compile.
  → https://docs.github.com/en/actions/using-jobs/using-jobs-in-a-workflow#defining-prerequisite-jobs
- **Real coverage** in unit-tests (`test:cov`) — the `coverageThreshold` in `package.json`
  wasn't gating because `npm test` doesn't pass `--coverage`.
  → https://jestjs.io/docs/configuration#coveragethreshold-object
- **`timeout-minutes` per job** — without it a hung job runs until the 6-hour default.
  → https://docs.github.com/en/actions/using-jobs/using-jobs-in-a-workflow#jobsjob_idtimeout-minutes
- **`cache: npm` in setup-node** — pulls deps from cache, not from the network.
  → https://github.com/actions/setup-node#caching-global-packages-data
- **Migration smoke with an idempotent re-run** — the second run must be a no-op;
  if it migrates again, there is a non-deterministic migration.
  → https://typeorm.io/migrations

### `docker-build` job (#3)

Builds the image on every PR (without push) to catch `Dockerfile`/entrypoint errors
early, with layer caching via GitHub Actions.

- `docker/setup-buildx-action` → https://github.com/docker/setup-buildx-action
- `docker/build-push-action` → https://github.com/docker/build-push-action
- `type=gha` cache → https://docs.docker.com/build/cache/backends/gha/
- Multi-stage (Dockerfile context) → https://docs.docker.com/build/building/multi-stage/

### `security-audit` job (#4)

`npm audit --audit-level=high`, a **real (blocking) gate**. After this session's
`npm audit fix` the project sits at **0 high / 0 critical** (see §6), so the gate passes.
It gates on high/critical, not on moderate.

- `npm audit` / `--audit-level` → https://docs.npmjs.com/cli/v10/commands/npm-audit
- `continue-on-error` → https://docs.github.com/en/actions/using-jobs/using-jobs-in-a-workflow#jobsjob_idcontinue-on-error

---

## 2. Production secrets fail-fast (`src/config/env.validation.ts`)

`DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` and `REDIS_HOST` are now `required()` when
`NODE_ENV=production` (via `Joi.when`); in dev/test they keep their `default`. Before, a deploy
with a forgotten var started **silently** with dev credentials instead of failing.

Verified: prod without `DB_PASSWORD` → the app doesn't start · full prod → passes · empty dev → defaults.

- Joi `any.when()` → https://joi.dev/api/#anywhencondition-options
- NestJS config + schema validation → https://docs.nestjs.com/techniques/configuration#schema-validation
- 12-factor III. Config → https://12factor.net/config

---

## 3. Redis as a hard dependency in the readiness check

The global `ThrottlerGuard` uses Redis as storage; its `increment()` **rejects** if Redis
doesn't respond → without Redis, every request dies with a 500. Decision taken: treat Redis as
a **hard dependency** and reflect it in `/ready`, so the orchestrator stops routing
traffic (503) when Redis goes down, instead of sending requests that will fail anyway.

Implementation:
- New `ICacheStore.ping()` on the port + impl (`RedisCacheStore`) — reuses the existing
  cache connection, without opening a third one.
- `RedisHealthIndicator` with `HealthIndicatorService` (the non-deprecated Terminus 11 API).
- `/ready` now runs `db.pingCheck` **and** `redis.isHealthy`.

Liveness (`/health`) vs readiness (`/ready`): the former restarts the container if it fails;
the latter only stops routing (a Redis blip must not kill the pod).

- NestJS Terminus (healthchecks) → https://docs.nestjs.com/recipes/terminus
- Custom health indicator → https://docs.nestjs.com/recipes/terminus#custom-health-indicators
- Rate limiting / throttler → https://docs.nestjs.com/security/rate-limiting
- Throttler Redis storage → https://www.npmjs.com/package/@nest-lab/throttler-storage-redis
- ioredis (client) → https://github.com/redis/ioredis
- Liveness vs readiness probes (K8s) → https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/

---

## 4. Line-ending normalization (`.gitattributes` + `.prettierrc`)

**Problem:** without `.gitattributes`, line endings depended on each machine's
`core.autocrlf`. On this Windows working copy (CRLF), `npm run lint` spat out ~8500 `␍`
errors in ALL files; on CI (Linux/LF) it passed. Local lint unusable + noisy diffs.

**Fix:**
- `.gitattributes` with `* text=auto eol=lf` → git always stores LF (a strong guarantee).
  A separate `*.sh eol=lf`: a CRLF in the `docker-entrypoint.sh` shebang breaks startup
  on Alpine.
- `.prettierrc` `endOfLine: "auto"` → prettier tolerates the local working tree's CRLF without
  any destructive conversion; the LF guarantee stays at the git layer.
- `npm run lint:fix` fixed 137 pre-existing `prettier/prettier` format errors
  (which also failed on CI/Linux — they were not CRLF).

- `gitattributes` → https://git-scm.com/docs/gitattributes
- GitHub: configuring line endings → https://docs.github.com/en/get-started/git-basics/configuring-git-to-handle-line-endings
- Prettier `endOfLine` → https://prettier.io/docs/options#end-of-line

---

## 5. Dependabot (`.github/dependabot.yml`)

Automatic update PRs: the `npm` ecosystem (with majors separated from minor/patch)
and `github-actions` (keeps the workflows' actions up to date). The `security-audit`
**detects**, Dependabot **proposes** the fix, CI **validates** it before merging.

- `dependabot.yml` options → https://docs.github.com/en/code-security/dependabot/dependabot-version-updates/configuration-options-for-the-dependabot.yml-file
- `groups` → https://docs.github.com/en/code-security/dependabot/dependabot-version-updates/controlling-dependencies-updated#grouping-dependencies

---

## 6. Vulnerability resolution (`npm audit fix`)

`npm audit fix` (without `--force` → only patches within the current semver, no breaking
changes). It only touched `package-lock.json`; direct deps didn't move.

- **Before:** 42 vulnerabilities (1 low, 31 moderate, 9 high, 1 critical).
- **After:** 20 moderate, **0 high, 0 critical**. Removed: the critical (handlebars,
  not reachable in this app), the 9 high (incl. the `path-to-regexp` DoS in the routing of
  `@nestjs/core`/`platform-express`, the only one with real runtime impact) and the low.
- **595 unit tests green** after the fix.

The **20 remaining moderates are dev-tooling** (jest/babel/ts-jest/istanbul + js-yaml via
@nestjs/swagger): they are not packaged into the production image and are not on an
attacker's path. Their "fix" according to npm would be a **destructive downgrade** (`jest@30→25`,
`@nestjs/swagger@11→5`), which is why `npm audit fix --force` is **NOT** run. They will be resolved via
Dependabot PRs when healthy upstream versions exist.

- `npm audit fix` → https://docs.npmjs.com/cli/v10/commands/npm-audit

---

## Pending (non-blocking, outside this session)

- **20 dev-tooling moderates** — wait for upstream / Dependabot PRs; don't force a downgrade.
- **Error tracking** (Sentry or similar) — today there are metrics + logs; grouping stack
  traces and alerting on new 500s is missing.
- **Partial index** for the period-sum query — decision consciously deferred
  (see `docs/period-sum-index-decision.md`).
