import type { Db } from './index.js';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS symbols (
     symbol          TEXT PRIMARY KEY,
     name            TEXT,
     currency        TEXT,
     exchange        TEXT,
     last_fetched_at TIMESTAMPTZ NOT NULL
   )`,
  // One row per symbol per trading day. The primary key doubles as the index
  // for the only access pattern: "all bars for a symbol, in date order".
  `CREATE TABLE IF NOT EXISTS daily_prices (
     symbol     TEXT NOT NULL REFERENCES symbols(symbol) ON DELETE CASCADE,
     trade_date DATE NOT NULL,
     open       DOUBLE PRECISION NOT NULL,
     high       DOUBLE PRECISION NOT NULL,
     low        DOUBLE PRECISION NOT NULL,
     close      DOUBLE PRECISION NOT NULL,
     adj_close  DOUBLE PRECISION NOT NULL,
     volume     DOUBLE PRECISION NOT NULL,
     PRIMARY KEY (symbol, trade_date)
   )`,
];

export async function migrate(db: Db): Promise<void> {
  for (const statement of SCHEMA) await db.query(statement);
}
