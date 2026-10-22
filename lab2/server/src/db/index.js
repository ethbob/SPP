const fs = require('fs');
const path = require('path');
const pg = require('pg');

// DATE отдаём строкой 'YYYY-MM-DD', чтобы не было сдвигов из-за часового пояса
pg.types.setTypeParser(1082, (v) => v);

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://app:app@localhost:5434/tasks',
});

async function init() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
}

module.exports = {
  query: (text, params) => pool.query(text, params),
  init,
  pool,
};
