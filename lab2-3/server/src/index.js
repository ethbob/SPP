require('dotenv').config();
const fs = require('fs');
const app = require('./app');
const db = require('./db');
const { UPLOAD_DIR } = require('./services/taskService');

const PORT = Number(process.env.PORT) || 4000;

// В Docker база может стартовать чуть позже API — пробуем подключиться несколько раз
async function connectWithRetry(attempts = 15) {
  for (let i = 1; ; i++) {
    try {
      await db.init();
      return;
    } catch (err) {
      if (i >= attempts) throw err;
      console.log(`База недоступна (${err.message}), попытка ${i}/${attempts}…`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function start() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  await connectWithRetry();
  app.listen(PORT, () => console.log(`API запущен: http://localhost:${PORT}/api`));
}

start().catch((err) => {
  console.error('Не удалось запустить API:', err.message);
  process.exit(1);
});
