// Thin, synchronous SQLite layer on top of Node's built-in `node:sqlite`.
// No native modules to compile -> installs anywhere Node 22+ runs.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { log } from '../lib/logger.js';

export const db = new DatabaseSync(config.dbFile);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');

const cache = new Map();
function stmt(sql) {
  let s = cache.get(sql);
  if (!s) { s = db.prepare(sql); cache.set(sql, s); }
  return s;
}

// node:sqlite accepts null/number/bigint/string/Buffer only.
function norm(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  if (v !== null && typeof v === 'object' && !(v instanceof Uint8Array)) return JSON.stringify(v);
  return v;
}
const args = (p) => p.map(norm);

/** All rows. */
export const all = (sql, ...p) => stmt(sql).all(...args(p));
/** First row or undefined. */
export const get = (sql, ...p) => stmt(sql).get(...args(p));
/** Run a write. Returns { changes, lastInsertRowid }. */
export const run = (sql, ...p) => {
  const r = stmt(sql).run(...args(p));
  return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
};

let depth = 0;
/** Run fn inside a transaction (nesting uses savepoints). fn must be synchronous. */
export function tx(fn) {
  const sp = `sp${depth}`;
  db.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
  depth++;
  try {
    const result = fn();
    depth--;
    db.exec(depth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
    return result;
  } catch (e) {
    depth--;
    db.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
    throw e;
  }
}

/** Insert an object into a table; returns new id. */
export function insert(table, obj) {
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined);
  const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
  return run(sql, ...keys.map((k) => obj[k])).lastInsertRowid;
}

/** Update row by id (optionally scoped by business_id). */
export function update(table, id, obj, businessId) {
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined);
  if (!keys.length) return 0;
  let sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`;
  const p = [...keys.map((k) => obj[k]), id];
  if (businessId !== undefined) { sql += ' AND business_id = ?'; p.push(businessId); }
  return run(sql, ...p).changes;
}

/** Parse JSON columns of a row in place. */
export function parseJson(row, fields) {
  if (!row) return row;
  for (const f of fields) {
    if (typeof row[f] === 'string') {
      try { row[f] = JSON.parse(row[f]); } catch { /* leave as string */ }
    }
  }
  return row;
}

export const now = () => new Date().toISOString();

/** Apply pending SQL migrations from src/db/migrations (in filename order). */
export function migrate() {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
  const done = new Set(all('SELECT name FROM schema_migrations').map((r) => r.name));
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    tx(() => {
      db.exec(sql);
      run('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)', file, now());
    });
    log.info('migration applied', { file });
  }
}
