import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { env, REPO_ROOT } from '../env.js';
import * as schema from './schema.js';

mkdirSync(dirname(env.DATABASE_PATH), { recursive: true });

const sqlite = new Database(env.DATABASE_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });

const MIGRATIONS_DIR = resolve(REPO_ROOT, 'apps/server/migrations');

/**
 * Applies any .sql file in migrations/ that hasn't run yet, in filename order,
 * each inside a transaction. Hand-rolled rather than drizzle-kit: the schema is
 * ours, and drizzle-kit pulls in a dependency chain with open advisories.
 */
export function runMigrations(): string[] {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);

  const applied = new Set(
    sqlite.prepare('SELECT name FROM _migrations').all().map((r) => (r as { name: string }).name),
  );

  const pending = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql') && !applied.has(f)).sort();

  for (const file of pending) {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8');
    sqlite.transaction(() => {
      sqlite.exec(sql);
      sqlite.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(file, Date.now());
    })();
  }
  return pending;
}

export { schema };
