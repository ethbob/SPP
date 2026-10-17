const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://app:app@localhost:5433/tasks',
});

// DATE отдаём строкой 'YYYY-MM-DD', чтобы не было сдвигов из-за часового пояса
require('pg').types.setTypeParser(1082, (v) => v);

async function init() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
}

module.exports = {
  query: (text, params) => pool.query(text, params),
  init,
  pool,
};
