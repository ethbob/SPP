// Настройка Express: только JSON API, никакого HTML.
// Express 5 сам передаёт ошибки из async-обработчиков в errorHandler.
const express = require('express');
const { notFound, errorHandler } = require('./middleware/errors');

const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' })); // разбирает JSON-тело в req.body

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/attachments', require('./routes/attachments'));

app.use('/api', notFound); // неизвестный адрес API → 404 в JSON
app.use(notFound);
app.use(errorHandler);

module.exports = app;
