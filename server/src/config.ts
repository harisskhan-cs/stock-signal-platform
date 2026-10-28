import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const number = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return value != null && value !== '' && Number.isFinite(n) ? n : fallback;
};

/** `--port=4000` on the command line wins over PORT, so dev tooling that sets PORT for the frontend can't steal it. */
const argPort = process.argv.find((a) => a.startsWith('--port='))?.slice('--port='.length);

export const config = {
  port: number(argPort, number(process.env.PORT, 4000)),
  /**
   * `postgres://user:pass@host:5432/db` for a PostgreSQL server. When unset,
   * the app uses an embedded PGlite database in PGLITE_DIR.
   */
  database: process.env.DATABASE_URL || process.env.PGLITE_DIR || path.resolve(here, '../.data/pglite'),
  cacheTtlMs: number(process.env.CACHE_TTL_MINUTES, 60) * 60_000,
  historyYears: number(process.env.HISTORY_YEARS, 25),
  /** How often live prices are polled while the market is open. Slower outside regular hours. */
  livePollMs: number(process.env.LIVE_POLL_SECONDS, 5) * 1000,
  /** The Vite build output, served by Express in production. */
  staticDir: path.resolve(here, '../../client/dist'),
};
