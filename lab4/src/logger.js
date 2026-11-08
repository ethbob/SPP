// Структурированный лог: одна JSON-строка на событие (без сторонних библиотек)
const config = require('./config');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
const min = LEVELS[config.logLevel] ?? LEVELS.info;

function write(level, event, data = {}) {
  if (LEVELS[level] < min) return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, event, ...data });
  (level === 'error' ? process.stderr : process.stdout).write(line + '\n');
}

module.exports = {
  debug: (event, data) => write('debug', event, data),
  info: (event, data) => write('info', event, data),
  warn: (event, data) => write('warn', event, data),
  error: (event, data) => write('error', event, data),
};
