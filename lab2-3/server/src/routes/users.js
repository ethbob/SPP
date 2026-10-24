// Управление пользователями.
//   GET    /api/users                  список (manager, admin)
//   PATCH  /api/users/:id              сменить роль / заблокировать (admin)
//   DELETE /api/users/:id/sessions     завершить все сессии пользователя (admin)
const express = require('express');
const users = require('../services/userService');
const auth = require('../services/authService');
const { HttpError, methodNotAllowed } = require('../middleware/errors');
const { parseId, requireJson } = require('../middleware/validate');
const { authenticate, requirePermission } = require('../middleware/auth');

const router = express.Router();
router.param('id', parseId('id'));
router.use(authenticate);

router
  .route('/')
  .get(requirePermission('users:read'), async (req, res) => {
    res.json(await users.list());
  })
  .all(methodNotAllowed(['GET', 'HEAD']));

router
  .route('/:id')
  .patch(requirePermission('users:manage'), requireJson, async (req, res) => {
    const { before, after } = await users.update(req.user, req.resourceId, req.body);
    if (before.role !== after.role) {
      req.log.info({ event: 'user.role_changed', targetUserId: req.resourceId, from: before.role, to: after.role }, 'Изменена роль');
    }
    if (before.is_active && !after.is_active) {
      const count = await auth.revokeAll(req.resourceId); // заблокированный теряет все сессии сразу
      req.log.warn({ event: 'user.blocked', targetUserId: req.resourceId, revokedSessions: count }, 'Пользователь заблокирован');
    }
    if (!before.is_active && after.is_active) {
      req.log.info({ event: 'user.unblocked', targetUserId: req.resourceId }, 'Пользователь разблокирован');
    }
    res.json(users.toUser(after));
  })
  .all(methodNotAllowed(['PATCH']));

router
  .route('/:id/sessions')
  .delete(requirePermission('users:manage'), async (req, res) => {
    if (!(await users.findById(req.resourceId))) throw new HttpError(404, `Пользователь ${req.resourceId} не найден`);
    const count = await auth.revokeAll(req.resourceId);
    req.log.warn({ event: 'session.revoked_by_admin', targetUserId: req.resourceId, count }, 'Админ завершил сессии пользователя');
    res.status(204).end();
  })
  .all(methodNotAllowed(['DELETE']));

module.exports = router;
