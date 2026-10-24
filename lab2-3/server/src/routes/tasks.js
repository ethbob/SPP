// REST API ресурса «задачи».
//   GET    /api/tasks?status=      список (200)
//   POST   /api/tasks              создать (201 + Location)
//   GET    /api/tasks/:id          одна задача с файлами (200 / 404)
//   PUT    /api/tasks/:id          заменить целиком (200 / 404)
//   PATCH  /api/tasks/:id          изменить часть полей, например статус (200 / 404)
//   DELETE /api/tasks/:id          удалить вместе с файлами (204 / 404)
//   POST   /api/tasks/:id/attachments   загрузить файлы, multipart/form-data (201 / 404)
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const express = require('express');
const multer = require('multer');
const tasks = require('../services/taskService');
const { HttpError } = require('../middleware/errors');
const { parseId, requireJson, requireMultipart } = require('../middleware/validate');

const router = express.Router();
router.param('id', parseId('id'));

const MAX_FILE_SIZE_MB = Number(process.env.MAX_FILE_SIZE_MB) || 10;

const upload = multer({
  storage: multer.diskStorage({
    destination: tasks.UPLOAD_DIR,
    // на диске — случайное имя, оригинальное хранится в БД
    filename: (req, file, cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024, files: 5 },
});

// Браузеры присылают имя файла в UTF-8, а multer читает его как latin1 — чиним кириллицу
const fixName = (name) => Buffer.from(name, 'latin1').toString('utf8');

async function loadTask(id) {
  const task = await tasks.get(id);
  if (!task) throw new HttpError(404, `Задача ${id} не найдена`);
  return task;
}

router.get('/', async (req, res) => {
  const { status } = req.query;
  if (status !== undefined && !tasks.STATUSES.includes(status)) {
    throw new HttpError(400, `Параметр status должен быть одним из: ${tasks.STATUSES.join(', ')}`);
  }
  res.json(await tasks.list({ status }));
});

router.post('/', requireJson, async (req, res) => {
  const task = await tasks.create(req.body);
  res.status(201).location(`/api/tasks/${task.id}`).json(task);
});

router.get('/:id', async (req, res) => {
  res.json(await loadTask(req.id));
});

router.put('/:id', requireJson, async (req, res) => {
  const task = await tasks.update(req.id, req.body, { partial: false });
  if (!task) throw new HttpError(404, `Задача ${req.id} не найдена`);
  res.json(task);
});

router.patch('/:id', requireJson, async (req, res) => {
  const task = await tasks.update(req.id, req.body, { partial: true });
  if (!task) throw new HttpError(404, `Задача ${req.id} не найдена`);
  res.json(task);
});

router.delete('/:id', async (req, res) => {
  if (!(await tasks.remove(req.id))) throw new HttpError(404, `Задача ${req.id} не найдена`);
  res.status(204).end();
});

router.post(
  '/:id/attachments',
  requireMultipart,
  // сначала проверяем, что задача есть, — чтобы не сохранять файлы зря
  async (req, res, next) => {
    if (!(await tasks.exists(req.id))) throw new HttpError(404, `Задача ${req.id} не найдена`);
    next();
  },
  upload.array('files'),
  async (req, res) => {
    const files = req.files || [];
    if (files.length === 0) throw new HttpError(400, 'Не передано ни одного файла (поле "files")');
    try {
      const saved = [];
      for (const f of files) saved.push(await tasks.addAttachment(req.id, { ...f, originalname: fixName(f.originalname) }));
      res.status(201).json(saved);
    } catch (err) {
      await Promise.all(files.map((f) => fs.unlink(f.path).catch(() => {})));
      throw err;
    }
  },
);

module.exports = router;
