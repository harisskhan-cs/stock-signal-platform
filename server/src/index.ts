import { createApp } from './app.js';
import { config } from './config.js';
import { PriceService } from './data/priceService.js';
import { YahooProvider } from './data/yahoo.js';
import { createDb } from './db/index.js';
import { migrate } from './db/migrate.js';
import { PriceRepository } from './db/priceRepository.js';
import { LiveHub } from './live/liveHub.js';

const db = await createDb(config.database);
await migrate(db);

const repo = new PriceRepository(db);
const provider = new YahooProvider();
const prices = new PriceService(repo, provider, { ttlMs: config.cacheTtlMs, historyYears: config.historyYears });
const live = new LiveHub(prices, provider, { intervals: { regular: config.livePollMs } });
const app = createApp({ prices, provider, repo, live, staticDir: config.staticDir });

const server = app.listen(config.port, () => {
  const where = db.kind === 'postgres' ? 'PostgreSQL (DATABASE_URL)' : `embedded PGlite at ${config.database}`;
  console.log(`API listening on http://localhost:${config.port} using ${where}`);
});

const shutdown = () => {
  server.close(() => {
    db.close().finally(() => process.exit(0));
  });
  // Live streams never end on their own, so close them or server.close() would wait forever.
  server.closeAllConnections();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
