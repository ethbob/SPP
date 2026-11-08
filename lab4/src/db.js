const fs = require('fs');
const path = require('path');
const pg = require('pg');
const config = require('./config');

// Внешние базы (Neon, Render) требуют SSL. Параметры sslmode/channel_binding из их строки
// подключения обрабатываем сами и убираем, чтобы драйвер pg их не интерпретировал по-своему
function parseUrl(raw) {
  const url = new URL(raw);
  const ssl = /^(require|verify)/.test(url.searchParams.get('sslmode') || '');
  url.searchParams.delete('sslmode');
  url.searchParams.delete('channel_binding');
  return { connectionString: url.toString(), ssl };
}
const { connectionString, ssl } = parseUrl(config.databaseUrl);

const pool = new pg.Pool({
  connectionString,
  ssl: ssl ? { rejectUnauthorized: false } : undefined,
  max: 10,
});

async function init() {
  await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
}

module.exports = { query: (text, params) => pool.query(text, params), init, pool };
