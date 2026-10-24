const fs = require('fs');
const config = require('./config');
const logger = require('./logger');
const app = require('./app');
const db = require('./db');
const { UPLOAD_DIR } = require('./services/taskService');
const { seedDemoUsers } = require('./seed');

// В Docker база может стартовать чуть позже API — пробуем подключиться несколько раз
async function connectWithRetry(attempts = 15) {
  for (let i = 1; ; i++) {
    try {
      await db.init();
      return;
    } catch (err) {
      if (i >= attempts) throw err;
      logger.warn({ event: 'db.retry', attempt: i, err: err.message }, 'База недоступна, повтор через 2 с');
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function start() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  await connectWithRetry();
  if (config.seedDemoUsers) await seedDemoUsers();
  app.listen(config.port, () => logger.info({ event: 'app.started', port: config.port }, `API запущен на порту ${config.port}`));
}

start().catch((err) => {
  logger.fatal({ event: 'app.start_failed', err }, 'Не удалось запустить API');
  process.exit(1);
});
