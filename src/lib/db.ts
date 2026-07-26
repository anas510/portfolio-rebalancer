// ---------------------------------------------------------------------------
// Database layer  (future-proofed: local SQLite file OR Turso/libSQL)
//
// We use `@libsql/client`, which speaks SQLite for BOTH a local file
// (url = "file:./data/portfolio.db") and a remote Turso database
// (url = "libsql://...", authToken = "..."). One code path, two backends.
//
//   - No env vars set  -> local file at ./data/portfolio.db  (great for `npm run dev`)
//   - TURSO_DATABASE_URL set -> remote Turso  (great for Vercel free hosting)
//
// The schema is created lazily on first access, so there is no separate
// migration step for the happy path.
// ---------------------------------------------------------------------------

import { createClient, type Client } from "@libsql/client";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { hashPassword } from "./password";
import { SEED_ALIASES } from "./symbols";

let _client: Client | null = null;
let _initPromise: Promise<void> | null = null;

type Row = Record<string, unknown>;

function resolveConfig(): { url: string; authToken?: string } {
  const tursoUrl = process.env.TURSO_DATABASE_URL;
  if (tursoUrl) {
    return { url: tursoUrl, authToken: process.env.TURSO_AUTH_TOKEN };
  }
  const localPath = process.env.LOCAL_DB_PATH || "./data/portfolio.db";
  const abs = path.resolve(process.cwd(), localPath);
  // Ensure the containing directory exists for the local file backend.
  try {
    mkdirSync(path.dirname(abs), { recursive: true });
  } catch {
    /* ignore */
  }
  return { url: `file:${abs}` };
}

export function getClient(): Client {
  if (!_client) {
    _client = createClient(resolveConfig());
  }
  return _client;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS user (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     email TEXT NOT NULL UNIQUE,
     password_hash TEXT NOT NULL,
     is_admin INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE TABLE IF NOT EXISTS model_portfolio (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     is_active INTEGER NOT NULL DEFAULT 1,
     updated_at TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE TABLE IF NOT EXISTS model_holding (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     model_id INTEGER NOT NULL REFERENCES model_portfolio(id) ON DELETE CASCADE,
     symbol TEXT NOT NULL,
     name TEXT,
     target_pct REAL NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS symbol_alias (
     symbol TEXT NOT NULL,
     name TEXT NOT NULL,
     PRIMARY KEY (symbol, name)
   )`,
  // Optional history of generated plans (nice for auditing / later features).
  `CREATE TABLE IF NOT EXISTS rebalance_run (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     cash_available REAL NOT NULL DEFAULT 0,
     investable_total REAL NOT NULL DEFAULT 0,
     plan_json TEXT NOT NULL
   )`,
  // Named portfolios. Each uses the shared default model unless model_id points
  // to its own (custom) model_portfolio row.
  `CREATE TABLE IF NOT EXISTS portfolio (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     model_id INTEGER REFERENCES model_portfolio(id),
     is_selected INTEGER NOT NULL DEFAULT 0,
     updated_at TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  // Saved current-holdings snapshot for a portfolio (still editable/re-priceable).
  `CREATE TABLE IF NOT EXISTS portfolio_holding (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     portfolio_id INTEGER NOT NULL REFERENCES portfolio(id) ON DELETE CASCADE,
     symbol TEXT NOT NULL,
     name TEXT,
     quantity REAL NOT NULL DEFAULT 0,
     price REAL NOT NULL DEFAULT 0,
     value REAL
   )`,
];

async function ensureColumn(db: Client, table: string, column: string, definition: string): Promise<void> {
  const info = await db.execute(`PRAGMA table_info(${table})`);
  const cols = info.rows.map((r) => String((r as Row).name));
  if (!cols.includes(column)) {
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

async function runMigrations(db: Client): Promise<void> {
  await ensureColumn(db, "portfolio", "user_id", "INTEGER REFERENCES user(id)");
  await ensureColumn(db, "model_portfolio", "user_id", "INTEGER REFERENCES user(id)");
  await ensureColumn(db, "rebalance_run", "user_id", "INTEGER REFERENCES user(id)");
}

async function seedAdminUser(db: Client): Promise<void> {
  const email = (process.env.ADMIN_EMAIL || "anasm51006@gmail.com").trim().toLowerCase();
  const password = process.env.ADMIN_INITIAL_PASSWORD;
  if (!password) return;

  const existing = await db.execute({ sql: "SELECT id FROM user WHERE email = ?", args: [email] });
  let adminId: number;

  if (existing.rows.length === 0) {
    const hash = await hashPassword(password);
    const inserted = await db.execute({
      sql: "INSERT INTO user (email, password_hash, is_admin) VALUES (?, ?, 1)",
      args: [email, hash],
    });
    adminId = Number(inserted.lastInsertRowid);
  } else {
    adminId = Number((existing.rows[0] as Row).id);
    await db.execute({ sql: "UPDATE user SET is_admin = 1 WHERE id = ?", args: [adminId] });
  }

  // Assign legacy rows (pre-auth) to the admin account.
  await db.execute({ sql: "UPDATE portfolio SET user_id = ? WHERE user_id IS NULL", args: [adminId] });
  await db.execute({ sql: "UPDATE model_portfolio SET user_id = ? WHERE user_id IS NULL", args: [adminId] });
  await db.execute({ sql: "UPDATE rebalance_run SET user_id = ? WHERE user_id IS NULL", args: [adminId] });
}

/** Create tables and seed reference data exactly once per process. */
export async function initDb(): Promise<void> {
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    const db = getClient();
    for (const stmt of SCHEMA) {
      await db.execute(stmt);
    }
    await runMigrations(db);

    // Seed symbol aliases if the table is empty.
    const count = await db.execute("SELECT COUNT(*) AS c FROM symbol_alias");
    const c = Number((count.rows[0] as Row).c ?? 0);
    if (c === 0) {
      for (const a of SEED_ALIASES) {
        await db.execute({
          sql: "INSERT OR IGNORE INTO symbol_alias (symbol, name) VALUES (?, ?)",
          args: [a.symbol, a.name],
        });
      }
    }

    await seedAdminUser(db);
  })();
  return _initPromise;
}

/** Convenience: init + return the client. */
export async function db(): Promise<Client> {
  await initDb();
  return getClient();
}
