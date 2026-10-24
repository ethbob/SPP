// Вход, временные ключи (access + refresh токены), сессии, защита от подбора, восстановление пароля.
//
// Схема «временных ключей»:
//   access-токен  — JWT на 15 минут. В нём id пользователя, роль и id сессии.
//                   Клиент отправляет его в заголовке Authorization: Bearer <токен>.
//   refresh-токен — случайная строка на 7 дней в httpOnly-cookie (JavaScript её не видит).
//                   В базе хранится только её SHA-256. По ней выдаётся новый access-токен,
//                   а сам refresh-токен при этом меняется (ротация).
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const logger = require('../logger');
const users = require('./userService');
const mailer = require('./mailer');
const { HttpError, ValidationError, unauthorized, forbidden, tooManyRequests } = require('../middleware/errors');
const { onlyFields } = require('../middleware/validate');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const randomToken = () => crypto.randomBytes(48).toString('base64url');

// Хеш-пустышка: если пользователя нет, всё равно тратим время на bcrypt,
// чтобы по времени ответа нельзя было понять, существует ли email
const DUMMY_HASH = bcrypt.hashSync('dummy-password-1', 10);

// ---------- access-токен ----------

function signAccessToken(user, sessionId) {
  return jwt.sign({ role: user.role, sid: sessionId }, config.jwt.secret, {
    subject: String(user.id),
    expiresIn: config.jwt.accessTtlSec,
  });
}

function verifyAccessToken(token) {
  try {
    return jwt.verify(token, config.jwt.secret);
  } catch (err) {
    throw unauthorized(err.name === 'TokenExpiredError' ? 'Срок действия токена истёк' : 'Недействительный токен');
  }
}

// Проверка, что сессия из токена ещё активна и пользователь не заблокирован —
// так завершённая сессия перестаёт работать сразу, не дожидаясь истечения JWT
async function loadActiveSession(sessionId, userId) {
  const { rows } = await db.query(
    `SELECT u.*, s.id AS session_id
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.user_id = $2 AND s.revoked_at IS NULL AND s.expires_at > now()`,
    [sessionId, userId],
  );
  const row = rows[0];
  if (!row) throw unauthorized('Сессия завершена, войдите снова');
  if (!row.is_active) throw forbidden('Учётная запись заблокирована администратором');
  // отмечаем активность не чаще раза в минуту
  await db.query(
    "UPDATE sessions SET last_used_at = now() WHERE id = $1 AND last_used_at < now() - interval '1 minute'",
    [sessionId],
  );
  return row;
}

// ---------- сессии (активные подключения) ----------

async function createSession(user, meta) {
  const id = crypto.randomUUID();
  const refreshToken = randomToken();
  await db.query(
    `INSERT INTO sessions (id, user_id, refresh_token_hash, user_agent, ip, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6))`,
    [id, user.id, sha256(refreshToken), meta.userAgent?.slice(0, 300) || null, meta.ip || null, config.session.refreshTtlDays],
  );

  // Ограничение числа одновременных входов: самые старые сессии сверх лимита завершаются
  const { rows: extra } = await db.query(
    `UPDATE sessions SET revoked_at = now()
      WHERE id IN (
        SELECT id FROM sessions
         WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
         ORDER BY last_used_at DESC OFFSET $2
      ) RETURNING id`,
    [user.id, config.session.maxActive],
  );
  if (extra.length) {
    logger.info({ event: 'session.evicted', userId: user.id, sessions: extra.map((r) => r.id) }, 'Превышен лимит сессий, старые завершены');
  }

  return { sessionId: id, refreshToken, accessToken: signAccessToken(user, id) };
}

async function refresh(refreshToken, meta) {
  if (!refreshToken) throw unauthorized('Нет refresh-токена');
  const { rows } = await db.query(
    `SELECT s.id AS session_id, u.*
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.refresh_token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
    [sha256(refreshToken)],
  );
  const row = rows[0];
  if (!row) throw unauthorized('Сессия истекла или завершена, войдите снова');
  if (!row.is_active) throw forbidden('Учётная запись заблокирована администратором');

  // ротация: старый refresh-токен становится недействительным
  const newRefresh = randomToken();
  await db.query(
    'UPDATE sessions SET refresh_token_hash = $1, last_used_at = now(), ip = $2, user_agent = $3 WHERE id = $4',
    [sha256(newRefresh), meta.ip || null, meta.userAgent?.slice(0, 300) || null, row.session_id],
  );
  return { user: row, sessionId: row.session_id, refreshToken: newRefresh, accessToken: signAccessToken(row, row.session_id) };
}

async function listSessions(userId) {
  const { rows } = await db.query(
    `SELECT id, user_agent, ip, created_at, last_used_at, expires_at
       FROM sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
      ORDER BY last_used_at DESC`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id,
    userAgent: r.user_agent,
    ip: r.ip,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    expiresAt: r.expires_at,
  }));
}

async function revokeSession(userId, sessionId) {
  const { rowCount } = await db.query(
    'UPDATE sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL',
    [sessionId, userId],
  );
  return rowCount > 0;
}

async function revokeSessionByToken(refreshToken) {
  if (!refreshToken) return null;
  const { rows } = await db.query(
    'UPDATE sessions SET revoked_at = now() WHERE refresh_token_hash = $1 AND revoked_at IS NULL RETURNING id, user_id',
    [sha256(refreshToken)],
  );
  return rows[0] || null;
}

// Завершить все сессии пользователя (кроме exceptId, если передан)
async function revokeAll(userId, exceptId = null) {
  const { rowCount } = await db.query(
    'UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL AND ($2::uuid IS NULL OR id <> $2)',
    [userId, exceptId],
  );
  return rowCount;
}

// ---------- вход и защита от подбора пароля ----------

async function login(body, meta) {
  const errors = {};
  onlyFields(body, ['email', 'password'], errors);
  if (typeof body.email !== 'string' || !body.email.trim()) errors.email = 'Введите email';
  if (typeof body.password !== 'string' || !body.password) errors.password = 'Введите пароль';
  if (Object.keys(errors).length) throw new ValidationError(errors);

  const log = meta.log || logger;
  const user = await users.findByEmail(body.email);

  // Учётная запись временно заблокирована после серии неудачных попыток
  if (user?.locked_until && user.locked_until > new Date()) {
    const sec = (user.locked_until - Date.now()) / 1000;
    log.warn({ event: 'auth.login.locked', userId: user.id, ip: meta.ip }, 'Попытка входа в заблокированную учётную запись');
    throw tooManyRequests(`Слишком много неудачных попыток. Учётная запись заблокирована, повторите через ${Math.ceil(sec / 60)} мин.`, sec);
  }

  const ok = await bcrypt.compare(body.password, user?.password_hash || DUMMY_HASH);

  if (!user || !ok) {
    if (user) {
      const { rows } = await db.query(
        `UPDATE users SET
           failed_logins = CASE WHEN failed_logins + 1 >= $2 THEN 0 ELSE failed_logins + 1 END,
           locked_until  = CASE WHEN failed_logins + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END
         WHERE id = $1 RETURNING failed_logins, locked_until`,
        [user.id, config.security.maxFailedLogins, config.security.lockMinutes],
      );
      const locked = rows[0].locked_until && rows[0].locked_until > new Date();
      log.warn({ event: locked ? 'auth.account.locked' : 'auth.login.failure', userId: user.id, ip: meta.ip }, 'Неверный пароль');
      if (locked) {
        throw tooManyRequests(`Слишком много неудачных попыток. Учётная запись заблокирована на ${config.security.lockMinutes} мин.`, config.security.lockMinutes * 60);
      }
    } else {
      log.warn({ event: 'auth.login.failure', reason: 'unknown_email', ip: meta.ip }, 'Вход с несуществующим email');
    }
    // одинаковый ответ для «нет такого email» и «неверный пароль»
    throw unauthorized('Неверный email или пароль');
  }

  if (!user.is_active) {
    log.warn({ event: 'auth.login.blocked_user', userId: user.id, ip: meta.ip }, 'Вход заблокированного пользователя');
    throw forbidden('Учётная запись заблокирована администратором');
  }

  await db.query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1', [user.id]);
  const session = await createSession(user, meta);
  log.info({ event: 'auth.login.success', userId: user.id, sessionId: session.sessionId, ip: meta.ip }, 'Успешный вход');
  return { user, ...session };
}

// ---------- восстановление доступа по email ----------

async function requestPasswordReset(body, meta) {
  const errors = {};
  onlyFields(body, ['email'], errors);
  if (typeof body.email !== 'string' || !body.email.trim()) errors.email = 'Введите email';
  if (Object.keys(errors).length) throw new ValidationError(errors);

  const log = meta.log || logger;
  const user = await users.findByEmail(body.email);
  if (!user || !user.is_active) {
    // не сообщаем, есть ли такой пользователь — ответ всегда одинаковый
    log.info({ event: 'auth.reset.requested', found: false, ip: meta.ip }, 'Запрос восстановления для неизвестного email');
    return;
  }

  const token = randomToken();
  await db.query(
    `INSERT INTO password_resets (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + make_interval(mins => $3))`,
    [user.id, sha256(token), config.security.resetTtlMinutes],
  );
  const link = `${config.appUrl}/reset-password?token=${token}`;
  try {
    await mailer.sendMail({ to: user.email, ...mailer.passwordResetEmail(user.name, link, config.security.resetTtlMinutes) });
  } catch (err) {
    log.error({ event: 'mail.failed', err, userId: user.id }, 'Не удалось отправить письмо');
    throw new HttpError(503, 'Почтовый сервер недоступен, попробуйте позже', { headers: { 'Retry-After': '60' } });
  }
  log.info({ event: 'auth.reset.requested', found: true, userId: user.id, ip: meta.ip }, 'Отправлено письмо для восстановления пароля');
}

async function resetPassword(body, meta) {
  const errors = {};
  onlyFields(body, ['token', 'password'], errors);
  if (typeof body.token !== 'string' || !body.token) errors.token = 'Нет токена из письма';
  const pwdErr = users.passwordError(body.password);
  if (pwdErr) errors.password = pwdErr;
  if (Object.keys(errors).length) throw new ValidationError(errors);

  const { rows } = await db.query('SELECT * FROM password_resets WHERE token_hash = $1', [sha256(body.token)]);
  const reset = rows[0];
  if (!reset) throw new HttpError(400, 'Ссылка для восстановления недействительна');
  // 410 Gone: ссылка была, но больше не работает
  if (reset.used_at) throw new HttpError(410, 'Ссылка уже использована. Запросите новую.');
  if (reset.expires_at < new Date()) throw new HttpError(410, 'Срок действия ссылки истёк. Запросите новую.');

  await db.query(
    'UPDATE users SET password_hash = $1, failed_logins = 0, locked_until = NULL, updated_at = now() WHERE id = $2',
    [await users.hashPassword(body.password), reset.user_id],
  );
  await db.query('UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [reset.user_id]);
  const revoked = await revokeAll(reset.user_id); // после смены пароля выходим со всех устройств
  (meta.log || logger).info({ event: 'auth.reset.completed', userId: reset.user_id, revokedSessions: revoked }, 'Пароль изменён по ссылке из письма');
}

module.exports = {
  verifyAccessToken,
  loadActiveSession,
  createSession,
  refresh,
  listSessions,
  revokeSession,
  revokeSessionByToken,
  revokeAll,
  login,
  requestPasswordReset,
  resetPassword,
};
