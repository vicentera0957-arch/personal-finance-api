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
 * Usage:
 *   npm run populate
 *   npm run populate -- --reset          # wipe previously-seeded users first
 *   SEED_USERS=20 SEED_TX_COUNT=5000 npm run populate
 *
 * Env vars (all optional):
 *   SEED_USERS       synthetic users to create (default 50)
 *   SEED_TX_COUNT    total transactions across all users, exact (default 15000)
 *   SEED_MONTHS      trailing months of history incl. current (default 12)
 *   ALLOW_NON_LOCAL_SEED=true   required (or --force) if DB_HOST isn't localhost
 *
 * Requires Node >= 20. Uses `pg`/`bcrypt`/`dotenv`, all already dependencies —
 * no ts-node, no TypeORM, so it runs directly against the DB the same way
 * migrations do (see src/data-source.ts for the same env-var/default pattern).
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
const RESET = process.argv.includes('--reset');
const FORCE = process.argv.includes('--force') || process.env.ALLOW_NON_LOCAL_SEED === 'true';

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

// Budget ceilings — deliberately close to typical spend so some months land
// over 100% and most don't (see CATEGORIES for the expense set).
const BUDGET_LIMITS = {
  Arriendo: null, // computed per-user from their fixed rent
  Supermercado: 300_000,
  Transporte: 120_000,
  Ocio: 150_000,
  Salud: 100_000,
  Servicios: 90_000,
};

// ── Bulk insert helper ───────────────────────────────────────────────────────

async function bulkInsert(client, table, columns, rows) {
  if (rows.length === 0) return;
  const chunkSize = Math.max(1, Math.floor(60_000 / columns.length));
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

function buildUser(index, months) {
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

  const salaryBase = randomInt(900_000, 2_200_000);
  const arriendoBase = randomInt(250_000, 650_000);

  const budgets = [];
  const transactions = [];

  for (const { month, year } of months) {
    // Budgets: one per expense category per month.
    for (const [name, flatLimit] of Object.entries(BUDGET_LIMITS)) {
      const limit = name === 'Arriendo' ? Math.round(arriendoBase * 1.02) : variance(flatLimit, 0.1);
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
  }

  return { userId, email, accounts, categories, budgets, transactions, salaryBase, arriendoBase };
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
  // bypasses the VO — clamp instead of letting a seed run produce a
  // nonsensical negative balance.
  const available = account.balance;
  const applied = Math.max(1, Math.min(amount, available));
  account.balance -= applied;
  return applied;
}

function generateTransactions(user, months, txPerMonth) {
  const primary = user.accounts[0];
  for (let m = 0; m < months.length; m++) {
    const { month, year } = months[m];
    const slots = monthSlots(txPerMonth[m]);
    for (const slot of slots) {
      const date = randomDateInMonth(month, year);
      const cat = user.categories.find((c) => c.name === slot.cat);
      const account = slot.cat === 'Sueldo' ? primary : pick(user.accounts.length > 1 && Math.random() < 0.3 ? user.accounts : [primary]);

      let amount;
      let description;
      if (slot.cat === 'Sueldo') {
        amount = variance(user.salaryBase, 0.05);
        description = 'Sueldo mensual';
        account.balance += amount;
      } else if (slot.cat === 'Arriendo') {
        amount = chargeAccount(account, variance(user.arriendoBase, 0.03));
        description = 'Arriendo depto';
      } else if (slot.cat === 'Servicios') {
        amount = chargeAccount(account, randomInt(20_000, 80_000));
        description = 'Cuentas de servicios (luz/agua/gas)';
      } else if (slot.kind === 'income') {
        amount = randomInt(...slot.amt);
        description = pick(DESCRIPTIONS[slot.cat] ?? [slot.cat]);
        account.balance += amount;
      } else {
        amount = chargeAccount(account, randomInt(...slot.amt));
        description = pick(DESCRIPTIONS[slot.cat] ?? [slot.cat]);
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

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const start = Date.now();
  const months = monthsBack(SEED_MONTHS);
  console.log(`\nPopulating ${SEED_TX_COUNT} transactions across ${SEED_USERS} users (${SEED_MONTHS} months) → ${DB.host}:${DB.port}/${DB.database}\n`);

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
    const now = new Date();

    // Exact distribution: base + remainder, so sums land exactly on the target.
    const baseTxPerUser = Math.floor(SEED_TX_COUNT / SEED_USERS);
    const userRemainder = SEED_TX_COUNT % SEED_USERS;

    const users = [];
    for (let i = 1; i <= SEED_USERS; i++) {
      const user = buildUser(i, months);
      const txForUser = baseTxPerUser + (i <= userRemainder ? 1 : 0);
      const baseTxPerMonth = Math.floor(txForUser / SEED_MONTHS);
      const monthRemainder = txForUser % SEED_MONTHS;
      const txPerMonth = months.map((_, m) => baseTxPerMonth + (m < monthRemainder ? 1 : 0));

      generateTransactions(user, months, txPerMonth);
      users.push(user);
    }

    const totalTx = users.reduce((s, u) => s + u.transactions.length, 0);

    await bulkInsert(
      client,
      'users',
      ['id', 'email', 'password_hash', 'full_name', 'created_at', 'updated_at'],
      users.map((u) => ({
        id: u.userId,
        email: u.email,
        password_hash: passwordHash,
        full_name: `Usuario Carga ${u.email.match(/user-(\d+)/)[1]}`,
        created_at: now,
        updated_at: now,
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
          created_at: now,
          updated_at: now,
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
          created_at: now,
          updated_at: now,
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
      users.flatMap((u) =>
        u.transactions.map((t) => ({
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
      ),
    );

    await client.query('COMMIT');

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`Done in ${elapsed}s:`);
    console.log(`   users        ${users.length}`);
    console.log(`   accounts     ${users.reduce((s, u) => s + u.accounts.length, 0)}`);
    console.log(`   categories   ${users.reduce((s, u) => s + u.categories.length, 0)}`);
    console.log(`   budgets      ${users.reduce((s, u) => s + u.budgets.length, 0)}`);
    console.log(`   transactions ${totalTx}`);
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
