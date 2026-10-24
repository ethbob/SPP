// Настройка Express: только JSON API.
// Express 5 сам передаёт ошибки из async-обработчиков в errorHandler.
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const pinoHttp = require('pino-http');
const logger = require('./logger');
const db = require('./db');
const { notFound, errorHandler, methodNotAllowed } = require('./middleware/errors');

const app = express();

app.disable('x-powered-by');
// API стоит за nginx: настоящий IP клиента берём из X-Forwarded-For (нужно для лимитов по IP)
app.set('trust proxy', 1);

// Лог каждого запроса одной JSON-строкой + сквозной id запроса (заголовок X-Request-Id)
app.use(
  pinoHttp({
    logger,
    genReqId: (req, res) => {
      const id = req.get('x-request-id') || crypto.randomUUID();
      res.set('X-Request-Id', id);
      return id;
    },
    customLogLevel: (req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
    customSuccessMessage: (req, res, ms) => `${req.method} ${req.originalUrl} → ${res.statusCode} (${Math.round(ms)} мс)`,
    customErrorMessage: (req, res) => `${req.method} ${req.originalUrl} → ${res.statusCode}`,
    customSuccessObject: (req, res, val) => ({ ...val, event: 'http.request' }),
    customErrorObject: (req, res, err, val) => ({ ...val, event: 'http.request' }),
    serializers: {
      req: (req) => ({ id: req.id, method: req.method, url: req.url, ip: req.remoteAddress, userAgent: req.headers['user-agent'] }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
    autoLogging: { ignore: (req) => req.url === '/api/health' },
  }),
);

app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// Проверка работоспособности: 200, если база отвечает, иначе 503
app
  .route('/api/health')
  .get(async (req, res) => {
    try {
      await db.query('SELECT 1');
      res.json({ status: 'ok' });
    } catch {
      res.status(503).set('Retry-After', '10').json({ status: 'unavailable' });
    }
  })
  .all(methodNotAllowed(['GET', 'HEAD']));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/attachments', require('./routes/attachments'));

app.use(notFound); // неизвестный адрес → 404
app.use(errorHandler);

module.exports = app;
