// Проверка access-токена и прав доступа
const auth = require('../services/authService');
const { can } = require('../permissions');
const { unauthorized, forbidden } = require('./errors');

// Требует заголовок Authorization: Bearer <access-токен>; кладёт пользователя в req.user
async function authenticate(req, res, next) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) throw unauthorized();

  const payload = auth.verifyAccessToken(token);
  const row = await auth.loadActiveSession(payload.sid, Number(payload.sub));

  // роль берём из базы, а не из токена: если админ её поменял, изменение действует сразу
  req.user = { id: row.id, email: row.email, name: row.name, role: row.role, sessionId: row.session_id };
  req.log = req.log.child({ userId: row.id, role: row.role });
  next();
}

// Требует разрешение; иначе 403
const requirePermission = (permission) => (req, res, next) => {
  if (!can(req.user.role, permission)) throw forbidden(`Действие доступно не для роли «${req.user.role}»`);
  next();
};

module.exports = { authenticate, requirePermission };
