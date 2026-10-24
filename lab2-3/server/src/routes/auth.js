// Аутентификация и сессии.
//   POST   /api/auth/register         регистрация (201) — новый пользователь получает роль user
//   POST   /api/auth/login            вход (200) → access-токен в теле, refresh-токен в httpOnly-cookie
//   POST   /api/auth/refresh          новый access-токен по cookie (200 / 401)
//   POST   /api/auth/logout           выход: завершить текущую сессию (204)
//   GET    /api/auth/me               текущий пользователь (200 / 401)
//   GET    /api/auth/sessions         мои активные сессии (200)
//   DELETE /api/auth/sessions/:sid    завершить одну сессию (204 / 404)
//   DELETE /api/auth/sessions         завершить все, кроме текущей (204)
//   POST   /api/auth/forgot-password  письмо со ссылкой восстановления (202)
//   POST   /api/auth/reset-password   новый пароль по токену из письма (204 / 400 / 410)
const express = require('express');
const config = require('../config');
const auth = require('../services/authService');
const users = require('../services/userService');
const { permissionsOf } = require('../permissionsView');
const { HttpError, methodNotAllowed } = require('../middleware/errors');
const { requireJson } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();

const COOKIE = 'refreshToken';
const cookieOptions = {
  httpOnly: true, // недоступна из JavaScript — защита от кражи через XSS
  sameSite: 'strict', // не отправляется с чужих сайтов — защита от CSRF
  secure: config.appUrl.startsWith('https://'),
  path: '/api/auth', // браузер шлёт её только на эндпоинты авторизации
  maxAge: config.session.refreshTtlDays * 24 * 60 * 60 * 1000,
};

const meta = (req) => ({ ip: req.ip, userAgent: req.get('user-agent'), log: req.log });

// Ответ после входа / обновления токена
function sendTokens(res, status, { user, accessToken, refreshToken }) {
  res.cookie(COOKIE, refreshToken, cookieOptions);
  res.set('Cache-Control', 'no-store'); // токены не кэшируются
  res.status(status).json({
    accessToken,
    tokenType: 'Bearer',
    expiresIn: config.jwt.accessTtlSec,
    user: { ...users.toUser(user), permissions: permissionsOf(user.role) },
  });
}

// Лимиты по IP — вторая линия защиты от подбора (первая — блокировка учётной записи)
const loginLimiter = rateLimit({
  name: 'login',
  windowMs: config.security.ipWindowMinutes * 60 * 1000,
  max: config.security.ipLoginLimit,
  message: 'Слишком много попыток входа с вашего адреса. Попробуйте позже.',
});
const mailLimiter = rateLimit({
  name: 'password-reset',
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Слишком много запросов на восстановление. Попробуйте позже.',
});
const registerLimiter = rateLimit({
  name: 'register',
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: 'Слишком много регистраций с вашего адреса. Попробуйте позже.',
});
router.limiters = [loginLimiter, mailLimiter, registerLimiter];

router
  .route('/register')
  .post(registerLimiter, requireJson, async (req, res) => {
    const user = await users.register(req.body);
    req.log.info({ event: 'auth.register', userId: user.id }, 'Новый пользователь');
    const session = await auth.createSession(user, meta(req));
    res.location('/api/auth/me');
    sendTokens(res, 201, { user, ...session });
  })
  .all(methodNotAllowed(['POST']));

router
  .route('/login')
  .post(loginLimiter, requireJson, async (req, res) => {
    const result = await auth.login(req.body, meta(req));
    sendTokens(res, 200, result);
  })
  .all(methodNotAllowed(['POST']));

router
  .route('/refresh')
  .post(async (req, res) => {
    try {
      const result = await auth.refresh(req.cookies[COOKIE], meta(req));
      sendTokens(res, 200, result);
    } catch (err) {
      res.clearCookie(COOKIE, { ...cookieOptions, maxAge: undefined });
      throw err;
    }
  })
  .all(methodNotAllowed(['POST']));

router
  .route('/logout')
  .post(async (req, res) => {
    const session = await auth.revokeSessionByToken(req.cookies[COOKIE]);
    if (session) req.log.info({ event: 'auth.logout', userId: session.user_id, sessionId: session.id }, 'Выход');
    res.clearCookie(COOKIE, { ...cookieOptions, maxAge: undefined });
    res.status(204).end();
  })
  .all(methodNotAllowed(['POST']));

router
  .route('/me')
  .get(authenticate, async (req, res) => {
    const user = await users.findById(req.user.id);
    res.json({ ...users.toUser(user), permissions: permissionsOf(user.role) });
  })
  .all(methodNotAllowed(['GET', 'HEAD']));

router
  .route('/sessions')
  .get(authenticate, async (req, res) => {
    const list = await auth.listSessions(req.user.id);
    res.json(list.map((s) => ({ ...s, current: s.id === req.user.sessionId })));
  })
  .delete(authenticate, async (req, res) => {
    const count = await auth.revokeAll(req.user.id, req.user.sessionId);
    req.log.info({ event: 'session.revoked_all', count }, 'Завершены все другие сессии');
    res.status(204).end();
  })
  .all(methodNotAllowed(['GET', 'HEAD', 'DELETE']));

router
  .route('/sessions/:sid')
  .delete(authenticate, async (req, res) => {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.sid)) throw new HttpError(400, 'Некорректный id сессии');
    const ok = await auth.revokeSession(req.user.id, req.params.sid);
    if (!ok) throw new HttpError(404, 'Сессия не найдена');
    req.log.info({ event: 'session.revoked', sessionId: req.params.sid }, 'Сессия завершена');
    res.status(204).end();
  })
  .all(methodNotAllowed(['DELETE']));

router
  .route('/forgot-password')
  .post(mailLimiter, requireJson, async (req, res) => {
    await auth.requestPasswordReset(req.body, meta(req));
    // 202 Accepted: запрос принят; ответ не зависит от того, есть ли такой email
    res.status(202).json({ detail: 'Если такой email зарегистрирован, на него отправлено письмо со ссылкой' });
  })
  .all(methodNotAllowed(['POST']));

router
  .route('/reset-password')
  .post(mailLimiter, requireJson, async (req, res) => {
    await auth.resetPassword(req.body, meta(req));
    res.status(204).end();
  })
  .all(methodNotAllowed(['POST']));

module.exports = router;
