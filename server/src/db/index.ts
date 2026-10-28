import { mkdir } from 'node:fs/promises';
import path from 'node:path';

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends Queryable {
  /** Runs `fn` inside BEGIN/COMMIT, rolling back if it throws. */
  transaction<R>(fn: (tx: Queryable) => Promise<R>): Promise<R>;
  close(): Promise<void>;
  readonly kind: 'postgres' | 'pglite';
}

/**
 * Opens the database.
 *
 * - `postgres://...` connects to a PostgreSQL server through node-postgres.
 * - `memory://` starts an in-memory PGlite instance (used by the tests).
 * - Anything else is treated as a directory for an embedded PGlite database,
 *   which is real PostgreSQL compiled to WebAssembly, so the app runs with no
 *   database install. The SQL is identical either way.
 */
export async function createDb(target: string): Promise<Db> {
  if (/^postgres(ql)?:\/\//.test(target)) return createPostgres(target);
  return createPglite(target === 'memory://' ? undefined : target);
}

async function createPostgres(connectionString: string): Promise<Db> {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString, max: 10 });
  return {
    kind: 'postgres',
    async query<T>(sql: string, params?: unknown[]) {
      const result = await pool.query(sql, params);
      return result.rows as T[];
    },
    async transaction<R>(fn: (tx: Queryable) => Promise<R>) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn({
          async query<T>(sql: string, params?: unknown[]) {
            return (await client.query(sql, params)).rows as T[];
          },
        });
        await client.query('COMMIT');
        return out;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

async function createPglite(dataDir: string | undefined): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  // PGlite creates the data directory itself but not its parents (e.g. .data/ on a fresh clone).
  if (dataDir) await mkdir(path.dirname(path.resolve(dataDir)), { recursive: true });
  let db: InstanceType<typeof PGlite>;
  try {
    db = await PGlite.create(dataDir);
  } catch (err) {
    // The embedded database only holds cached prices, so a damaged copy can simply be rebuilt.
    throw new Error(
      `Could not open the embedded database at ${dataDir}. If it was copied or moved, delete that folder and restart; prices are re-downloaded automatically. (${(err as Error).message})`,
      { cause: err },
    );
  }
  return {
    kind: 'pglite',
    async query<T>(sql: string, params?: unknown[]) {
      return (await db.query<T>(sql, params)).rows;
    },
    transaction<R>(fn: (tx: Queryable) => Promise<R>) {
      return db.transaction((tx) =>
        fn({
          async query<T>(sql: string, params?: unknown[]) {
            return (await tx.query<T>(sql, params)).rows;
          },
        }),
      );
    },
    close: () => db.close(),
  };
}
