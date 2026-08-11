#!/usr/bin/env node
/**
 * Bulk realistic load seed — direct DB insert, no HTTP.
 *
 * Why not through the API like scripts/seed-demo.mjs: at the default
 * THROTTLE_LIMIT (100 req/min per IP) thousands of sequential HTTP calls
 * would take hours, and a chunk of the expense inserts would 422 against
 * the "expenses <= budget limit" invariant unless the script re-derived
 * every running total itself. A one-shot bulk seed doesn't need to
 * re-prove the write-side invariants the app's UoW already protects —
 * it just needs to produce FK-valid, internally consistent rows.
 *
 * Why the distribution is skewed, not flat: this table is meant to be used
 * for EXPLAIN (ANALYZE, BUFFERS) exercises — planner-plan-change demos,
 * partial indexes, Index Only Scan, keyset pagination. A uniform
 * distribution makes `WHERE user_id = $1` equally selective for every
 * value of $1, so there is no parameter that pushes the planner from Seq
 * Scan to Index Scan. See paretoAllocation/temporalAllocation below.
 *
 * Usage:
 *   npm run populate
 *   npm run populate -- --reset          # wipe previously-seeded users first
 *   npm run populate -- --no-analyze     # skip ANALYZE (see SEED_SKEW notes)
 *   SEED_USERS=20 SEED_TX_COUNT=5000 npm run populate
 *   SEED_USERS=200 SEED_TX_COUNT=1000000 SEED_MONTHS=24 npm run populate
 *                                          # the docs/perf/ lab dataset — see
 *                                          # "Por que 1.000.000 y no 15.000"
 *                                          # in docs/perf/README.md
 *
 * Env vars (all optional):
 *   SEED_USERS       synthetic users to create (default 50)
 *   SEED_TX_COUNT    total transactions across all users, exact (default 15000)
 *   SEED_MONTHS      trailing months of history incl. current (default 12)
 *   SEED_SKEW        Pareto exponent (alpha) for the per-user tx-count
 *                     distribution (default 1.1). Higher = more skewed.
 *   ALLOW_NON_LOCAL_SEED=true   required (or --force) if DB_HOST isn't localhost
 *
 * Requires Node >= 20. Uses `pg`/`bcrypt`/`dotenv`, all already dependencies —
 * no ts-node, no TypeORM, so it runs directly against the DB the same way
 * migrations do (see src/data-source.ts for the same env-var/default pattern).
 *
 * Everything is built in memory before the bulk insert (see bulkInsert
 * below). The "switch to COPY FROM STDIN past ~500k rows" warning that used
 * to live here was a guess; it has since been measured. 1M transactions
 * (200 users, 24 months) insert in **117 s**, ~8.500 rows/s, on the
 * multi-row VALUES() path — acceptable, so COPY stays unbuilt. What the
 * scale does require is `node --max-old-space-size=6144`: the peak is two
 * live copies of the row set, because bulkInsert's caller `.map()`s the
 * whole array into column objects before handing it over.
 *
 * Money columns are `integer` (int32), and that is a real ceiling here, not
 * a formality: every per-user total scales with SEED_TX_COUNT via the Pareto
 * skew, so quantities that look safe at 15k rows overflow at 1M. Two of them
 * did, and both fixes are load-bearing — see the salary sizing in
 * generateTransactions. If you change how amounts are generated, re-run at
 * SEED_TX_COUNT=1000000 before believing it works; 15k proves nothing.
 */

import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import pg from 'pg';
import bcrypt from 'bcrypt';

dotenv.config();

const { Client } = pg;

const SEED_USERS = Number(process.env.SEED_USERS ?? 50);
const SEED_TX_COUNT = Number(process.env.SEED_TX_COUNT ?? 15000);
const SEED_MONTHS = Number(process.env.SEED_MONTHS ?? 12);
const SEED_SKEW = Number(process.env.SEED_SKEW ?? 1.1);
const RESET = process.argv.includes('--reset');
const FORCE = process.argv.includes('--force') || process.env.ALLOW_NON_LOCAL_SEED === 'true';
const NO_ANALYZE = process.argv.includes('--no-analyze');

const DEMO_EMAIL_PATTERN = 'seed-load-user-%@finanzas.dev';
const SHARED_PASSWORD = 'SeedLoad2026!';

const DB = {
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER ?? 'finance_user',
  password: process.env.DB_PASSWORD ?? 'finance_password',
  database: process.env.DB_NAME ?? 'personal_finance_db',
};

// ── Safety guard ─────────────────────────────────────────────────────────────
// This is a bulk-insert script. It must never be pointable at a deployed DB
// by accident.
if (!FORCE && !['localhost', '127.0.0.1'].includes(DB.host)) {
  console.error(
    `Refusing to run against DB_HOST=${DB.host} (not localhost).\n` +
      `Pass --force or set ALLOW_NON_LOCAL_SEED=true if this is really intended.`,
  );
  process.exit(1);
}

// ── Random helpers ───────────────────────────────────────────────────────────

const randomInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const pick = (arr) => arr[randomInt(0, arr.length - 1)];
const variance = (base, pct) => Math.round(base * (1 + (Math.random() * 2 - 1) * pct));

function weightedPick(items) {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let r = Math.random() * total;
  for (const item of items) {
    if ((r -= item.weight) <= 0) return item;
  }
  return items[items.length - 1];
}

// Oldest → newest, length `n`, including the current month.
function monthsBack(n) {
  const out = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({ month: d.getMonth() + 1, year: d.getFullYear() });
  }
  return out;
}

function daysInMonth(month, year) {
  return new Date(year, month, 0).getDate();
}

// Random timestamp within the given month; clamped to "today" if it's the
// current month so we never generate future-dated transactions.
function randomDateInMonth(month, year) {
  const now = new Date();
  const isCurrent = month === now.getMonth() + 1 && year === now.getFullYear();
  const maxDay = isCurrent ? now.getDate() : daysInMonth(month, year);
  const day = randomInt(1, Math.max(1, maxDay));
  const hour = randomInt(7, 22);
  const minute = randomInt(0, 59);
  return new Date(year, month - 1, day, hour, minute, randomInt(0, 59));
}

// ── Distribution shaping ─────────────────────────────────────────────────────

// Ranked n^-alpha weights normalized to `totalCount`. Rank 1 (the first
// bucket) gets the largest share. Both the shortfall from enforcing
// `minPerBucket` and the rounding remainder are reconciled onto bucket 0 —
// the largest allocation has the most room to absorb an adjustment without
// disturbing the tail the skew exists to create in the first place.
function paretoAllocation(totalCount, n, alpha, minPerBucket) {
  const weights = Array.from({ length: n }, (_, i) => (i + 1) ** -alpha);
  const weightSum = weights.reduce((s, w) => s + w, 0);
  const alloc = weights.map((w) => Math.round((w / weightSum) * totalCount));

  for (let i = 0; i < alloc.length; i++) {
    if (alloc[i] < minPerBucket) {
      alloc[0] -= minPerBucket - alloc[i];
      alloc[i] = minPerBucket;
    }
  }
  alloc[0] += totalCount - alloc.reduce((s, v) => s + v, 0);
  return alloc;
}

// Linear recency weights (oldest month = 1x, newest = ~2x): a real table
// grows over time, it doesn't backfill evenly across history. Every month
// is floored at 1 (its salary slot) and reconciled onto the newest month —
// same reasoning as paretoAllocation, just keyed by recency instead of rank.
function temporalAllocation(totalForUser, monthCount) {
  const denom = Math.max(monthCount - 1, 1);
  const weights = Array.from({ length: monthCount }, (_, m) => 1 + m / denom);
  const weightSum = weights.reduce((s, w) => s + w, 0);
  const alloc = weights.map((w) => Math.round((w / weightSum) * totalForUser));

  const newestIdx = monthCount - 1;
  for (let m = 0; m < alloc.length; m++) {
    if (alloc[m] < 1) {
      alloc[newestIdx] -= 1 - alloc[m];
      alloc[m] = 1;
    }
  }
  alloc[newestIdx] += totalForUser - alloc.reduce((s, v) => s + v, 0);
  return alloc;
}

// ── Category catalog ─────────────────────────────────────────────────────────

const CATEGORIES = [
  { name: 'Sueldo', nature: 'income', color: '#2E7D32', icon: 'wallet' },
  { name: 'Freelance', nature: 'income', color: '#00897B', icon: 'briefcase' },
  { name: 'Arriendo', nature: 'expense', color: '#6D4C41', icon: 'home' },
  { name: 'Supermercado', nature: 'expense', color: '#FF5733', icon: 'shopping-cart' },
  { name: 'Transporte', nature: 'expense', color: '#1E88E5', icon: 'bus' },
  { name: 'Ocio', nature: 'expense', color: '#8E24AA', icon: 'film' },
  { name: 'Salud', nature: 'expense', color: '#E53935', icon: 'heart-pulse' },
  { name: 'Servicios', nature: 'expense', color: '#FBC02D', icon: 'bolt' },
];

const DESCRIPTIONS = {
  Supermercado: ['Supermercado semana', 'Feria/almacén', 'Compra despensa'],
  Transporte: ['Carga tarjeta transporte', 'Combustible', 'App de transporte'],
  Ocio: ['Cine', 'Salida a comer', 'Streaming', 'Concierto'],
  Salud: ['Farmacia', 'Consulta médica', 'Óptica'],
  Freelance: ['Pago proyecto freelance'],
};

// Slot pool for the "variable" part of a month (weighted; kind carried per entry).
const VARIABLE_SLOTS = [
  { cat: 'Supermercado', kind: 'expense', weight: 35, amt: [15_000, 70_000] },
  { cat: 'Transporte', kind: 'expense', weight: 25, amt: [5_000, 25_000] },
  { cat: 'Ocio', kind: 'expense', weight: 22, amt: [10_000, 90_000] },
  { cat: 'Salud', kind: 'expense', weight: 13, amt: [5_000, 120_000] },
  { cat: 'Freelance', kind: 'income', weight: 5, amt: [50_000, 400_000] },
];

// Budget ceilings for a user at the *global average* activity level — scaled
// per user-month by activityFactor before use (see buildUser). Arriendo and
// Servicios are excluded from that scaling: both are always exactly one
// transaction/month regardless of Pareto rank, so their monthly spend
// doesn't grow with activity the way the four "variable" categories'
// does (their transaction COUNT grows with activity, these two don't).
const BUDGET_LIMITS = {
  Arriendo: null, // computed per-user from their fixed rent, see buildUser
  Supermercado: 300_000,
  Transporte: 120_000,
  Ocio: 150_000,
  Salud: 100_000,
  Servicios: 90_000, // flat, like Arriendo — see comment above
};

// ── Bulk insert helper ───────────────────────────────────────────────────────

async function bulkInsert(client, table, columns, rows) {
  if (rows.length === 0) return;
  // Progress + table name on stderr: at SEED_TX_COUNT in the hundreds of
  // thousands the transactions insert alone runs for minutes with nothing to
  // show, and when a row does get rejected Postgres names the *type* but not
  // the table ("value ... is out of range for type integer"), which is not
  // enough to find the offending generator on a five-table insert.
  const chunkSize = Math.max(1, Math.floor(60_000 / columns.length));
  process.stderr.write(`  … inserting ${rows.length} rows into ${table}\n`);
  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    const values = [];
    const tuples = chunk.map((row, i) => {
      const base = i * columns.length;
      values.push(...columns.map((c) => row[c]));
      return `(${columns.map((_, j) => `$${base + j + 1}`).join(',')})`;
    });
    const sql = `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(',')}) VALUES ${tuples.join(',')}`;
    await client.query(sql, values);
  }
}

// ── Per-user data generation ─────────────────────────────────────────────────

function buildUser(index, months, txPerMonth, globalAvgPerMonth) {
  const now = new Date();
  const userId = randomUUID();
  const email = `seed-load-user-${index}@finanzas.dev`;

  const accounts = [];
  const accountRoll = Math.random();
  const accountCount = accountRoll < 0.6 ? 1 : accountRoll < 0.9 ? 2 : 3;
  const accountTypes = ['corriente', 'ahorro', 'vista'];
  for (let a = 0; a < accountCount; a++) {
    accounts.push({
      id: randomUUID(),
      type: a === 0 ? 'corriente' : accountTypes[a % accountTypes.length],
      name: a === 0 ? 'Cuenta Corriente' : `Cuenta ${a + 1}`,
      initialBalance: randomInt(200_000, 3_000_000),
      balance: 0, // filled below, then tracked live as transactions are generated
    });
  }
  accounts.forEach((acc) => (acc.balance = acc.initialBalance));

  const categories = CATEGORIES.map((c) => ({ ...c, id: randomUUID(), userId }));
  const catByName = Object.fromEntries(categories.map((c) => [c.name, c]));

  const arriendoBase = randomInt(250_000, 650_000);

  const budgets = [];
  const transactions = [];

  months.forEach(({ month, year }, m) => {
    // Activity level of THIS user-month relative to the flat/uniform
    // baseline (globalAvgPerMonth). Without this, a flat BUDGET_LIMITS
    // value means Pareto "whales" blow through every category every month
    // while the tail never comes close — the column loses all variety.
    const activityFactor = txPerMonth[m] / globalAvgPerMonth;
    for (const [name, flatLimit] of Object.entries(BUDGET_LIMITS)) {
      let limit;
      if (name === 'Arriendo') {
        limit = Math.round(arriendoBase * 1.02);
      } else if (name === 'Servicios') {
        limit = variance(flatLimit, 0.1);
      } else {
        limit = Math.max(1, Math.round(variance(flatLimit * activityFactor, 0.15)));
      }
      budgets.push({
        id: randomUUID(),
        userId,
        categoryId: catByName[name].id,
        month,
        year,
        amountLimit: limit,
        createdAt: now,
        updatedAt: now,
      });
    }
  });

  return { userId, email, accounts, categories, budgets, transactions, arriendoBase };
}

// Fixed slots (salary + rent + utilities) plus weighted-random slots, sized to
// hit `count` exactly — this is what makes the grand total land on
// SEED_TX_COUNT without post-hoc trimming.
function monthSlots(count) {
  const slots = [];
  if (count <= 0) return slots;
  slots.push({ cat: 'Sueldo', kind: 'income' });
  let remaining = count - 1;
  for (const cat of ['Arriendo', 'Servicios']) {
    if (remaining > 0) {
      slots.push({ cat, kind: 'expense' });
      remaining--;
    }
  }
  for (let i = 0; i < remaining; i++) {
    const s = weightedPick(VARIABLE_SLOTS);
    slots.push({ cat: s.cat, kind: s.kind, amt: s.amt });
  }
  return slots;
}

function chargeAccount(account, amount) {
  // Mirrors the domain's Balance >= 0 invariant even though this path
  // bypasses the VO — clamp to whatever's actually available instead of
  // letting a seed run produce a negative balance. Never floor above 0:
  // once an account is drained, further charges apply cleanly (0 CLP),
  // they never push it negative.
  const applied = Math.min(amount, account.balance);
  account.balance -= applied;
  return applied;
}

// Secondary accounts (savings-type) never receive salary, so over many
// months of random redirects they can run dry. Only redirect an expense to
// one if it can actually cover it — otherwise fall back to the primary
// account, which is replenished by salary every month.
function pickExpenseAccount(user, amount) {
  const primary = user.accounts[0];
  if (user.accounts.length > 1 && Math.random() < 0.25) {
    const candidate = pick(user.accounts.slice(1));
    if (candidate.balance >= amount) return candidate;
  }
  return primary;
}

function generateTransactions(user, months, txPerMonth) {
  const primary = user.accounts[0];
  for (let m = 0; m < months.length; m++) {
    const { month, year } = months[m];
    const slots = monthSlots(txPerMonth[m]);

    // Pass 1: price every non-salary slot first. With SEED_SKEW some users
    // get hundreds of expense slots in a single month against what used to
    // be a flat, arbitrary salary figure — chargeAccount would clamp that
    // account to 0 within the first few dozen transactions and leave the
    // rest of the month's rows at amount=0. Pricing expenses first lets the
    // salary below be sized to actually cover them.
    let projectedExpenses = 0;
    let projectedOtherIncome = 0;
    const priced = slots.map((slot) => {
      if (slot.cat === 'Sueldo') return slot;
      let rawAmount;
      let description;
      if (slot.cat === 'Arriendo') {
        rawAmount = variance(user.arriendoBase, 0.03);
        description = 'Arriendo depto';
      } else if (slot.cat === 'Servicios') {
        rawAmount = randomInt(20_000, 80_000);
        description = 'Cuentas de servicios (luz/agua/gas)';
      } else {
        rawAmount = randomInt(...slot.amt);
        description = pick(DESCRIPTIONS[slot.cat] ?? [slot.cat]);
      }
      if (slot.kind === 'expense') projectedExpenses += rawAmount;
      // Freelance (VARIABLE_SLOTS, weight 5) is income that is never spent,
      // so it accumulates into the balance exactly like an oversized salary
      // would. It has to be netted out of the salary below, otherwise it
      // scales with SEED_TX_COUNT: the rank-1 Pareto user draws ~10.6k
      // Freelance rows over 24 months at ~225k CLP each — 2.4e9, past int32
      // on `current_balance` all by itself.
      else projectedOtherIncome += rawAmount;
      return { ...slot, rawAmount, description };
    });

    // Income before expenses. Amounts and dates are already fixed by the
    // pricing pass, and every row is re-sorted by transaction_date globally
    // before insert, so this ordering is invisible in the data — it only
    // controls the running balance, making it peak before anything is
    // charged. Without it the salary can arrive after the expenses it was
    // sized to cover and chargeAccount clamps rows to amount=0.
    const ordered = [
      ...priced.filter((s) => s.kind === 'income'),
      ...priced.filter((s) => s.kind === 'expense'),
    ];

    for (const slot of ordered) {
      const date = randomDateInMonth(month, year);
      const cat = user.categories.find((c) => c.name === slot.cat);

      let amount;
      let account;
      let description;
      if (slot.cat === 'Sueldo') {
        // Covers what this month's expenses actually need from the salary —
        // i.e. net of the month's other income — plus an ABSOLUTE surplus.
        // Both halves of that matter, and both are int32 constraints rather
        // than aesthetic ones: `amount` and `current_balance` are `integer`.
        //
        // Net of other income, because Freelance rows are never spent (see
        // projectedOtherIncome above). Absolute surplus, because whatever the
        // month does not spend accumulates into account.balance across all
        // SEED_MONTHS — a proportional 5-35% surplus therefore grows with
        // SEED_TX_COUNT (the rank-1 user books ~8.5e9 CLP of expenses over 24
        // months, so even a 20% average surplus lands beyond 2^31). Together
        // these cap the balance at initialBalance + SEED_MONTHS * 400k, flat
        // in SEED_TX_COUNT.
        //
        // The 50k floor covers both the rare all-salary month (monthSlots: a
        // user floored at 1 tx/month has zero projected expenses) and the
        // month where Freelance income happens to exceed expenses.
        amount = Math.max(projectedExpenses - projectedOtherIncome + randomInt(50_000, 400_000), 50_000);
        description = 'Sueldo mensual';
        account = primary;
        account.balance += amount;
      } else if (slot.kind === 'income') {
        amount = slot.rawAmount;
        description = slot.description;
        account = primary;
        account.balance += amount;
      } else {
        account = pickExpenseAccount(user, slot.rawAmount);
        amount = chargeAccount(account, slot.rawAmount);
        description = slot.description;
      }

      user.transactions.push({
        id: randomUUID(),
        userId: user.userId,
        accountId: account.id,
        categoryId: cat.id,
        nature: slot.kind,
        amount,
        description,
        transactionDate: date,
        createdAt: date,
      });
    }
  }
}

// ── Reporting ────────────────────────────────────────────────────────────────

function median(sortedAsc) {
  const mid = Math.floor(sortedAsc.length / 2);
  return sortedAsc.length % 2 ? sortedAsc[mid] : (sortedAsc[mid - 1] + sortedAsc[mid]) / 2;
}

// Compares each budget row against the ACTUAL spend of its own user's
// expense transactions in that (category, month, year) — categoryId is
// already unique per user (buildUser mints a fresh id per user), so it
// alone is enough to key the lookup.
function computeBudgetExceedStats(users) {
  const spend = new Map();
  for (const u of users) {
    for (const t of u.transactions) {
      if (t.nature !== 'expense') continue;
      const key = `${t.categoryId}|${t.transactionDate.getMonth() + 1}|${t.transactionDate.getFullYear()}`;
      spend.set(key, (spend.get(key) ?? 0) + t.amount);
    }
  }
  let exceeded = 0;
  let total = 0;
  for (const u of users) {
    for (const b of u.budgets) {
      total++;
      const key = `${b.categoryId}|${b.month}|${b.year}`;
      if ((spend.get(key) ?? 0) > b.amountLimit) exceeded++;
    }
  }
  return { exceeded, total };
}

function printDistributionReport(users, allTransactions) {
  const byUser = users
    .map((u) => ({ email: u.email, count: u.transactions.length }))
    .sort((a, b) => b.count - a.count);
  const countsAsc = byUser.map((u) => u.count).sort((a, b) => a - b);
  const totalTx = allTransactions.length;

  console.log(`\n   Distribution:`);
  console.log(`   Top 5 users by transaction count:`);
  byUser.slice(0, 5).forEach((u, i) => {
    console.log(`     ${i + 1}. ${u.email}: ${u.count} (${((u.count / totalTx) * 100).toFixed(1)}%)`);
  });

  const min = countsAsc[0];
  const max = countsAsc[countsAsc.length - 1];
  console.log(`   Per-user tx count — min ${min}, median ${median(countsAsc)}, max ${max}`);
  console.log(
    `   Selectivity — largest user ${((max / totalTx) * 100).toFixed(2)}% of rows, ` +
      `smallest ${((min / totalTx) * 100).toFixed(3)}%`,
  );

  const incomeCount = allTransactions.filter((t) => t.nature === 'income').length;
  const expenseCount = totalTx - incomeCount;
  console.log(
    `   income/expense split — ${((incomeCount / totalTx) * 100).toFixed(1)}% / ` +
      `${((expenseCount / totalTx) * 100).toFixed(1)}%`,
  );

  const zeroCount = allTransactions.filter((t) => t.amount === 0).length;
  const zeroPct = (zeroCount / totalTx) * 100;
  console.log(`   amount=0 rows — ${zeroCount} (${zeroPct.toFixed(3)}%)`);
  if (zeroPct > 0.1) {
    console.warn(
      `   WARNING: amount=0 rows exceed 0.1% of the total — chargeAccount is clamping ` +
        `more than expected; check the salary-sizing headroom in generateTransactions.`,
    );
  }

  const { exceeded, total } = computeBudgetExceedStats(users);
  console.log(`   Budgets exceeded — ${exceeded}/${total} (${((exceeded / total) * 100).toFixed(1)}%)`);
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const start = Date.now();
  const months = monthsBack(SEED_MONTHS);
  console.log(`\nPopulating ${SEED_TX_COUNT} transactions across ${SEED_USERS} users (${SEED_MONTHS} months, skew=${SEED_SKEW}) → ${DB.host}:${DB.port}/${DB.database}\n`);

  const client = new Client(DB);
  await client.connect();

  try {
    await client.query('BEGIN');

    if (RESET) {
      const res = await client.query(
        `DELETE FROM "users" WHERE "email" LIKE $1`,
        [DEMO_EMAIL_PATTERN],
      );
      console.log(`  … --reset: deleted ${res.rowCount} previously-seeded users (cascades to their data)`);
    }

    const passwordHash = await bcrypt.hash(SHARED_PASSWORD, 10);

    // Pareto-ish skew across users (rank 1 = biggest), each floored at
    // SEED_MONTHS so every user keeps at least one transaction per month
    // (its salary slot — see monthSlots/temporalAllocation).
    const userTotals = paretoAllocation(SEED_TX_COUNT, SEED_USERS, SEED_SKEW, SEED_MONTHS);
    const globalAvgPerMonth = SEED_TX_COUNT / SEED_USERS / SEED_MONTHS;

    const users = [];
    for (let i = 1; i <= SEED_USERS; i++) {
      const txPerMonth = temporalAllocation(userTotals[i - 1], SEED_MONTHS);
      const user = buildUser(i, months, txPerMonth, globalAvgPerMonth);
      generateTransactions(user, months, txPerMonth);
      users.push(user);
    }

    // Flatten and sort by date GLOBALLY (not grouped by user) before the
    // bulk insert below — this is what makes the heap's physical layout
    // resemble production, where rows from many users arrive interleaved
    // in time rather than clustered by user_id. It's also what gives
    // transaction_date a physical correlation close to 1 in pg_stats after
    // ANALYZE (verified as one of the acceptance checks) — inserting
    // user-then-date order would leave the heap ordered by user_id instead,
    // and a date-range query's cost estimate wouldn't reflect reality.
    const allTransactions = users.flatMap((u) => u.transactions);
    allTransactions.sort((a, b) => a.transactionDate - b.transactionDate);
    const totalTx = allTransactions.length;

    await bulkInsert(
      client,
      'users',
      ['id', 'email', 'password_hash', 'full_name', 'created_at', 'updated_at'],
      users.map((u) => ({
        id: u.userId,
        email: u.email,
        password_hash: passwordHash,
        full_name: `Usuario Carga ${u.email.match(/user-(\d+)/)[1]}`,
        created_at: new Date(),
        updated_at: new Date(),
      })),
    );

    await bulkInsert(
      client,
      'accounts',
      ['id', 'user_id', 'name', 'type', 'initial_balance', 'current_balance', 'is_archived', 'created_at', 'updated_at'],
      users.flatMap((u) =>
        u.accounts.map((a) => ({
          id: a.id,
          user_id: u.userId,
          name: a.name,
          type: a.type,
          initial_balance: a.initialBalance,
          current_balance: a.balance,
          is_archived: false,
          created_at: new Date(),
          updated_at: new Date(),
        })),
      ),
    );

    await bulkInsert(
      client,
      'categories',
      ['id', 'user_id', 'name', 'nature', 'color', 'icon', 'created_at', 'updated_at'],
      users.flatMap((u) =>
        u.categories.map((c) => ({
          id: c.id,
          user_id: c.userId,
          name: c.name,
          nature: c.nature,
          color: c.color,
          icon: c.icon,
          created_at: new Date(),
          updated_at: new Date(),
        })),
      ),
    );

    await bulkInsert(
      client,
      'budgets',
      ['id', 'user_id', 'category_id', 'month', 'year', 'amount_limit', 'created_at', 'updated_at'],
      users.flatMap((u) =>
        u.budgets.map((b) => ({
          id: b.id,
          user_id: b.userId,
          category_id: b.categoryId,
          month: b.month,
          year: b.year,
          amount_limit: b.amountLimit,
          created_at: b.createdAt,
          updated_at: b.updatedAt,
        })),
      ),
    );

    await bulkInsert(
      client,
      'transactions',
      ['id', 'user_id', 'account_id', 'category_id', 'nature', 'amount', 'description', 'transaction_date', 'created_at'],
      allTransactions.map((t) => ({
        id: t.id,
        user_id: t.userId,
        account_id: t.accountId,
        category_id: t.categoryId,
        nature: t.nature,
        amount: t.amount,
        description: t.description,
        transaction_date: t.transactionDate,
        created_at: t.createdAt,
      })),
    );

    await client.query('COMMIT');

    // ANALYZE runs OUTSIDE the transaction (after COMMIT, same connection):
    // without fresh stats the planner would still see these tables as
    // whatever they were before this run (often empty), and every
    // EXPLAIN taken afterward would be measuring noise, not the dataset.
    if (!NO_ANALYZE) {
      await client.query('ANALYZE transactions, accounts, budgets, categories, users');
    } else {
      console.log(`  … --no-analyze: skipping ANALYZE on purpose (stats stay stale — rows= vs actual rows= should diverge)`);
    }

    const sizeRes = await client.query(`
      SELECT pg_size_pretty(pg_total_relation_size('transactions')) AS size,
             reltuples::bigint AS reltuples
      FROM pg_class WHERE relname = 'transactions'
    `);

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`Done in ${elapsed}s:`);
    console.log(`   users        ${users.length}`);
    console.log(`   accounts     ${users.reduce((s, u) => s + u.accounts.length, 0)}`);
    console.log(`   categories   ${users.reduce((s, u) => s + u.categories.length, 0)}`);
    console.log(`   budgets      ${users.reduce((s, u) => s + u.budgets.length, 0)}`);
    console.log(`   transactions ${totalTx}`);
    console.log(`   transactions table — ${sizeRes.rows[0].size}, reltuples=${sizeRes.rows[0].reltuples}`);

    printDistributionReport(users, allTransactions);

    console.log(`\n   Sample login   ${users[0].email} / ${SHARED_PASSWORD}`);
    console.log(`   Re-run with --reset to wipe these ${users.length} users and regenerate.\n`);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      console.error(
        `\nInsert failed on a unique constraint — synthetic users probably already exist.\n` +
          `Re-run with --reset to wipe them first.\n`,
      );
    } else {
      console.error(`\nPopulate failed:\n${err.message}\n`);
    }
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
