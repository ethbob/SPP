// Структурированное логирование: каждая запись — одна строка JSON
// { "level": 30, "time": "...", "reqId": "...", "event": "auth.login.success", "userId": 3, "msg": "..." }
const pino = require('pino');
const config = require('./config');

const logger = pino({
  level: config.logLevel,
  base: { service: 'tasks-api' },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }), // "level": "info" вместо числа
  },
  // секреты никогда не попадают в логи
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.token',
      '*.refreshToken',
    ],
    censor: '[скрыто]',
  },
});

module.exports = logger;
