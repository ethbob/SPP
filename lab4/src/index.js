const { createServer } = require('./server');
const db = require('./db');
const log = require('./logger');

// В Docker/на хостинге база может стартовать позже — несколько попыток подключиться
async function main() {
  for (let attempt = 1; ; attempt++) {
    try {
      const app = await createServer();
      const shutdown = async (signal) => {
        log.info('app.stopping', { signal });
        await app.close();
        await db.pool.end();
        process.exit(0);
      };
      process.on('SIGTERM', shutdown);
      process.on('SIGINT', shutdown);
      return;
    } catch (err) {
      if (attempt >= 15) throw err;
      log.warn('db.retry', { attempt, err: err.message });
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

main().catch((err) => {
  log.error('app.start_failed', { err: err.message });
  process.exit(1);
});
