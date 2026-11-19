import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

const LOCK_ID = 727_274;

/**
 * Apply the `*.sql` files in `dir` that have not run yet, in name order, each in its own transaction.
 * Safe to call on every start and from several containers at once (an advisory lock serialises them).
 * Returns the names it applied.
 */
export async function migrate(pool: pg.Pool, dir: string | URL): Promise<string[]> {
  const folder = typeof dir === 'string' ? dir : fileURLToPath(dir);
  const files = (await readdir(folder)).filter((f) => f.endsWith('.sql')).sort();
  const db = await pool.connect();
  try {
    await db.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await db.query(
      'CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const done = new Set(
      (await db.query<{ name: string }>('SELECT name FROM _migrations')).rows.map((r) => r.name),
    );
    const applied: string[] = [];
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(folder, file), 'utf8');
      await db.query('BEGIN');
      try {
        await db.query(sql);
        await db.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
        await db.query('COMMIT');
      } catch (err) {
        await db.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
      applied.push(file);
    }
    return applied;
  } finally {
    await db.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => undefined);
    db.release();
  }
}
