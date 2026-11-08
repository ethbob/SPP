// HTTP без фреймворков: встроенный модуль http раздаёт статические файлы клиента
// и пару служебных JSON-эндпоинтов
const fs = require('fs');
const path = require('path');
const db = require('./db');
const store = require('./store');
const log = require('./logger');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

function json(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

async function handleHttp(req, res) {
  const started = Date.now();
  res.on('finish', () => {
    if (req.url !== '/health') log.debug('http.request', { method: req.method, url: req.url, status: res.statusCode, ms: Date.now() - started });
  });

  const url = new URL(req.url, 'http://localhost');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return json(res, 405, { error: 'Method Not Allowed' }, { Allow: 'GET, HEAD' });
  }

  if (url.pathname === '/health') {
    try {
      await db.query('SELECT 1');
      return json(res, 200, { status: 'ok' });
    } catch {
      return json(res, 503, { status: 'db_unavailable' }, { 'Retry-After': '10' });
    }
  }

  if (url.pathname === '/api/leaderboard') {
    return json(res, 200, await store.leaderboard(20));
  }

  // Статика: защищаемся от выхода за пределы папки public (../../etc/passwd)
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return json(res, 403, { error: 'Forbidden' });

  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) return json(res, 404, { error: 'Not Found' });
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

module.exports = { handleHttp };
