//   GET    /api/attachments/:id   скачать файл (200 / 403 / 404)
//   DELETE /api/attachments/:id   удалить файл (204 / 403 / 404)
const path = require('path');
const express = require('express');
const tasks = require('../services/taskService');
const { HttpError, methodNotAllowed } = require('../middleware/errors');
const { parseId } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.param('id', parseId('id'));
router.use(authenticate);

async function load(req, action) {
  const a = await tasks.getAttachment(req.resourceId);
  if (!a) throw new HttpError(404, `Файл ${req.resourceId} не найден`);
  tasks.assertAccess(req.user, { ownerId: a.owner_id }, action);
  return a;
}

router
  .route('/:id')
  .get(async (req, res, next) => {
    const a = await load(req, 'read');
    res.download(path.join(tasks.UPLOAD_DIR, a.stored_name), a.original_name, (err) => {
      if (err && !res.headersSent) next(new HttpError(404, 'Файл отсутствует на диске'));
    });
  })
  .delete(async (req, res) => {
    await load(req, 'update');
    await tasks.removeAttachment(req.resourceId);
    res.status(204).end();
  })
  .all(methodNotAllowed(['GET', 'HEAD', 'DELETE']));

module.exports = router;
