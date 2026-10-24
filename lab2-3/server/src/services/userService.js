// Пользователи: регистрация, поиск, управление ролями (для admin)
const bcrypt = require('bcryptjs');
const db = require('../db');
const { ROLES } = require('../permissions');
const { HttpError, ValidationError } = require('../middleware/errors');
const { onlyFields } = require('../middleware/validate');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    isActive: row.is_active,
    lockedUntil: row.locked_until && row.locked_until > new Date() ? row.locked_until : null,
    createdAt: row.created_at,
    ...(row.active_sessions !== undefined && { activeSessions: row.active_sessions }),
  };
}

// Требования к паролю: 8+ символов, хотя бы одна буква и одна цифра
function passwordError(password) {
  if (typeof password !== 'string' || password.length < 8) return 'Пароль — не короче 8 символов';
  if (password.length > 72) return 'Пароль — не длиннее 72 символов';
  if (!/\p{L}/u.test(password) || !/\d/.test(password)) return 'Пароль должен содержать буквы и цифры';
  return null;
}

const hashPassword = (password) => bcrypt.hash(password, 10);

async function findByEmail(email) {
  const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [String(email).trim().toLowerCase()]);
  return rows[0] || null;
}

async function findById(id) {
  const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

async function register(body) {
  const errors = {};
  onlyFields(body, ['email', 'name', 'password'], errors);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!EMAIL_RE.test(email) || email.length > 254) errors.email = 'Некорректный email';
  if (!name) errors.name = 'Имя обязательно';
  else if (name.length > 100) errors.name = 'Имя не длиннее 100 символов';
  const pwdErr = passwordError(body.password);
  if (pwdErr) errors.password = pwdErr;
  if (Object.keys(errors).length) throw new ValidationError(errors);

  try {
    const { rows } = await db.query(
      `INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, 'user') RETURNING *`,
      [email, name, await hashPassword(body.password)],
    );
    return rows[0];
  } catch (err) {
    // 23505 — нарушение UNIQUE: такой email уже есть → 409 Conflict
    if (err.code === '23505') throw new HttpError(409, 'Пользователь с таким email уже зарегистрирован', { errors: { email: 'Email уже занят' } });
    throw err;
  }
}

async function list() {
  const { rows } = await db.query(
    `SELECT u.*, COUNT(s.id) FILTER (WHERE s.revoked_at IS NULL AND s.expires_at > now())::int AS active_sessions
       FROM users u LEFT JOIN sessions s ON s.user_id = u.id
      GROUP BY u.id ORDER BY u.id`,
  );
  return rows.map(toUser);
}

// Админ меняет роль и/или блокирует пользователя
async function update(actor, id, body) {
  const errors = {};
  onlyFields(body, ['role', 'isActive'], errors);
  if (!('role' in body) && !('isActive' in body)) errors._ = 'Передайте role и/или isActive';
  if ('role' in body && !ROLES.includes(body.role)) errors.role = `Роль должна быть одной из: ${ROLES.join(', ')}`;
  if ('isActive' in body && typeof body.isActive !== 'boolean') errors.isActive = 'Ожидается true или false';
  if (Object.keys(errors).length) throw new ValidationError(errors);

  if (id === actor.id) throw new HttpError(403, 'Нельзя менять роль или блокировать самого себя');

  const user = await findById(id);
  if (!user) throw new HttpError(404, `Пользователь ${id} не найден`);

  const role = body.role ?? user.role;
  const isActive = body.isActive ?? user.is_active;
  const { rows } = await db.query(
    'UPDATE users SET role = $1, is_active = $2, updated_at = now() WHERE id = $3 RETURNING *',
    [role, isActive, id],
  );
  return { before: user, after: rows[0] };
}

module.exports = { toUser, passwordError, hashPassword, findByEmail, findById, register, list, update };
