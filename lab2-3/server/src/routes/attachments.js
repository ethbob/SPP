//   GET    /api/attachments/:id   скачать файл (200 / 404)
//   DELETE /api/attachments/:id   удалить файл (204 / 404)
const path = require('path');
const express = require('express');
const tasks = require('../services/taskService');
const { HttpError } = require('../middleware/errors');
const { parseId } = require('../middleware/validate');

const router = express.Router();
router.param('id', parseId('id'));

router.get('/:id', async (req, res, next) => {
  const a = await tasks.getAttachment(req.id);
  if (!a) throw new HttpError(404, `Файл ${req.id} не найден`);
  res.download(path.join(tasks.UPLOAD_DIR, a.stored_name), a.original_name, (err) => {
    if (err && !res.headersSent) next(new HttpError(404, 'Файл отсутствует на диске'));
  });
});

router.delete('/:id', async (req, res) => {
  if (!(await tasks.removeAttachment(req.id))) throw new HttpError(404, `Файл ${req.id} не найден`);
  res.status(204).end();
});

module.exports = router;
