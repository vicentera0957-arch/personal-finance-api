#!/usr/bin/env node
/**
 * Demo seed — populates the API with a realistic demo user via the PUBLIC API.
 *
 * Why through HTTP and not direct DB inserts: the seed exercises the real
 * validation, domain rules and locks (an expense over its budget would be
 * rejected here too). It can never produce a state the API itself couldn't.
 *
 * Usage:
 *   node scripts/seed-demo.mjs                        # against local (default)
 *   API_URL=https://<app>.up.railway.app node scripts/seed-demo.mjs
 *   node scripts/seed-demo.mjs --reset                # delete demo user & reseed
 *
 * Env vars (all optional):
 *   API_URL        base URL without /api/v1 (default http://localhost:3000)
 *   DEMO_EMAIL     default demo-recruiter@finanzas.dev
 *   DEMO_PASSWORD  default DemoRecruiter2026!
 *
 * Requires Node >= 20 (native fetch). No dependencies.
 */

const API_URL = (process.env.API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const BASE = `${API_URL}/api/v1`;
const EMAIL = process.env.DEMO_EMAIL ?? 'demo-recruiter@finanzas.dev';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'DemoRecruiter2026!';
const RESET = process.argv.includes('--reset');

// ── HTTP helper ──────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, { body, token, expect } = {}) {
  // Retry loop for 429: the API rate-limits per IP (global + stricter auth
  // bucket). A seed that ignores Retry-After fails against any real deploy.
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 429 && attempt < 6) {
      const wait = Number(res.headers.get('retry-after')) || 60;
      console.log(`  … throttled (429) on ${method} ${path} — waiting ${wait}s`);
      await sleep(wait * 1000 + 500);
      continue;
    }

    const text = await res.text();
    const json = text ? JSON.parse(text) : null;

    const expected = expect ?? [200, 201, 204];
    if (!expected.includes(res.status)) {
      throw new Error(
        `${method} ${path} → ${res.status}\n${JSON.stringify(json, null, 2)}`,
      );
    }
    return { status: res.status, body: json };
  }
}

// JWT payload without verification — good enough to read our own `sub`.
function jwtSub(token) {
  const payload = JSON.parse(
    Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
  );
  return payload.sub;
}

const log = (msg) => console.log(`  ${msg}`);

// ── Seed ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nSeeding demo data → ${BASE}\n`);

  // 0. Liveness
  await fetch(`${API_URL}/health`).then((r) => {
    if (!r.ok) throw new Error(`API not reachable at ${API_URL}/health`);
  });

  // 1. Register (idempotent-ish: 409 means the user already exists)
  let reg = await api('POST', '/auth/register', {
    body: { name: 'Demo Recruiter', email: EMAIL, password: PASSWORD },
    expect: [201, 409],
  });

  if (reg.status === 409) {
    if (!RESET) {
      console.error(
        `Demo user already exists (${EMAIL}).\n` +
          `Re-run with --reset to delete it and reseed from scratch.`,
      );
      process.exit(1);
    }
    log(`user exists — resetting (--reset)`);
    const { body: session } = await api('POST', '/auth/login', {
      body: { email: EMAIL, password: PASSWORD },
    });
    const userId = jwtSub(session.accessToken);
    await api('DELETE', `/users/${userId}`, { token: session.accessToken });
    log(`deleted user ${userId} (cascade wipes accounts/categories/budgets/transactions)`);
    reg = await api('POST', '/auth/register', {
      body: { name: 'Demo Recruiter', email: EMAIL, password: PASSWORD },
      expect: [201],
    });
  }
  log(`user registered: ${EMAIL}`);

  const { body: auth } = await api('POST', '/auth/login', {
    body: { email: EMAIL, password: PASSWORD },
  });
  const token = auth.accessToken;

  // 2. Accounts
  const { body: checking } = await api('POST', '/accounts', {
    token,
    body: { name: 'Cuenta Corriente', type: 'corriente', initialBalance: 850_000 },
  });
  const { body: savings } = await api('POST', '/accounts', {
    token,
    body: { name: 'Fondo de Ahorro', type: 'ahorro', initialBalance: 1_200_000 },
  });
  log(`accounts: Cuenta Corriente (850k), Fondo de Ahorro (1.2M)`);

  // 3. Categories
  const mkCat = (name, nature, color, icon) =>
    api('POST', '/categories', { token, body: { name, nature, color, icon } });

  const { body: catSalary } = await mkCat('Sueldo', 'income', '#2E7D32', 'wallet');
  const { body: catRent } = await mkCat('Arriendo', 'expense', '#6D4C41', 'home');
  const { body: catGrocery } = await mkCat('Supermercado', 'expense', '#FF5733', 'shopping-cart');
  const { body: catTransport } = await mkCat('Transporte', 'expense', '#1E88E5', 'bus');
  const { body: catLeisure } = await mkCat('Ocio', 'expense', '#8E24AA', 'film');
  log(`categories: Sueldo (income) + Arriendo/Supermercado/Transporte/Ocio (expense)`);

  // 4. Budgets — current month
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const mm = String(month).padStart(2, '0');
  const day = (d) => `${year}-${mm}-${String(d).padStart(2, '0')}`;

  const mkBudget = (categoryId, limit) =>
    api('POST', '/budgets', { token, body: { categoryId, month, year, limit } });

  await mkBudget(catRent.id, 450_000);
  await mkBudget(catGrocery.id, 250_000);
  await mkBudget(catTransport.id, 80_000);
  await mkBudget(catLeisure.id, 120_000);
  log(`budgets ${mm}/${year}: Arriendo 450k · Supermercado 250k · Transporte 80k · Ocio 120k`);

  // 5. Transactions — all through the real gate (budget lock + balance lock)
  const mkTx = (accountId, categoryId, nature, amount, description, d) =>
    api('POST', '/transactions', {
      token,
      body: { accountId, categoryId, nature, amount, description, transactionDate: day(d) },
    });

  await mkTx(checking.id, catSalary.id, 'income', 1_500_000, 'Sueldo mensual', 1);
  await mkTx(checking.id, catRent.id, 'expense', 450_000, 'Arriendo depto', 2); // budget 100% used
  await mkTx(checking.id, catGrocery.id, 'expense', 52_390, 'Supermercado semana 1', 3);
  await mkTx(checking.id, catTransport.id, 'expense', 15_000, 'Carga tarjeta transporte', 5);
  await mkTx(checking.id, catLeisure.id, 'expense', 45_990, 'Cine + salida', 6);
  await mkTx(checking.id, catGrocery.id, 'expense', 38_750, 'Supermercado semana 2', 8);
  await mkTx(checking.id, catTransport.id, 'expense', 12_500, 'Apps de transporte', 12);
  await mkTx(checking.id, catLeisure.id, 'expense', 32_000, 'Concierto', 13);
  await mkTx(checking.id, catGrocery.id, 'expense', 61_200, 'Supermercado semana 3', 15);
  log(`transactions: 1 income (1.5M) + 8 expenses across the month`);

  // 6. Summary
  const { body: budgets } = await api('GET', `/budgets?month=${month}&year=${year}`, { token });
  const { body: account } = await api('GET', `/accounts/${checking.id}`, { token });

  console.log(`\nDemo ready:`);
  console.log(`   URL          ${API_URL}`);
  console.log(`   Swagger      ${API_URL}/api/docs`);
  console.log(`   Login        ${EMAIL} / ${PASSWORD}`);
  console.log(`   Accounts     Cuenta Corriente + Fondo de Ahorro (savings: ${savings.id.slice(0, 8)}…)`);
  console.log(`   Balance      Cuenta Corriente → $${account.currentBalance.toLocaleString('es-CL')}`);
  console.log(`   Budgets      ${Array.isArray(budgets) ? budgets.length : '?'} for ${mm}/${year} (Arriendo at 100% of its limit)`);
  console.log(`\n   Interesting demo states:`);
  console.log(`   - Arriendo budget is exactly full: one more CLP is a 422`);
  console.log(`   - Supermercado at ~61% (152.340 of 250.000)`);
  console.log(`   - requests/demo-flow.http walks the full flow incl. replay detection\n`);
}

main().catch((err) => {
  console.error(`\nSeed failed:\n${err.message}\n`);
  process.exit(1);
});
