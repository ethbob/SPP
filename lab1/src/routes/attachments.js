const path = require('path');
const express = require('express');
const tasks = require('../services/taskService');

const router = express.Router();

router.param('id', (req, res, next, id) => (/^\d+$/.test(id) ? next() : next('route')));

// Скачивание с оригинальным именем файла
router.get('/:id', async (req, res, next) => {
  const a = await tasks.getAttachment(Number(req.params.id));
  if (!a) return next();
  res.download(path.join(tasks.UPLOAD_DIR, a.stored_name), a.original_name, (err) => {
    if (err && !res.headersSent) next(); // файла нет на диске — 404
  });
});

router.post('/:id/delete', async (req, res, next) => {
  const a = await tasks.removeAttachment(Number(req.params.id));
  if (!a) return next();
  res.redirect(`/tasks/${a.task_id}`);
});

module.exports = router;
