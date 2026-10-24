// Демо-пользователи трёх ролей — создаются при старте, если их ещё нет.
// Отключается переменной SEED_DEMO_USERS=false.
const db = require('./db');
const logger = require('./logger');
const { hashPassword } = require('./services/userService');

const DEMO = [
  { email: 'admin@example.com', name: 'Администратор', role: 'admin', password: 'Admin12345' },
  { email: 'manager@example.com', name: 'Менеджер', role: 'manager', password: 'Manager12345' },
  { email: 'user@example.com', name: 'Пользователь', role: 'user', password: 'User12345' },
];

async function seedDemoUsers() {
  for (const u of DEMO) {
    const { rowCount } = await db.query(
      `INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING`,
      [u.email, u.name, u.role, await hashPassword(u.password)],
    );
    if (rowCount) logger.info({ event: 'seed.user_created', email: u.email, role: u.role }, 'Создан демо-пользователь');
  }
  // задачи из лабы 2 были без владельца — отдаём их администратору
  await db.query(
    `UPDATE tasks SET user_id = (SELECT id FROM users WHERE email = 'admin@example.com') WHERE user_id IS NULL`,
  );
}

module.exports = { seedDemoUsers, DEMO };
