// REST API ресурса «задачи». Все маршруты — только для вошедших пользователей.
//   GET    /api/tasks?status=&scope=   список (200); user видит свои, manager/admin — все
//   POST   /api/tasks                  создать (201 + Location)
//   GET    /api/tasks/:id              одна задача с файлами (200 / 403 / 404)
//   PUT    /api/tasks/:id              заменить целиком (200 / 403 / 404)
//   PATCH  /api/tasks/:id              изменить часть полей (200 / 403 / 404)
//   DELETE /api/tasks/:id              удалить вместе с файлами (204 / 403 / 404)
//   POST   /api/tasks/:id/attachments  загрузить файлы, multipart/form-data (201 / 403 / 404)
// Любой другой метод на этих путях → 405 Method Not Allowed с заголовком Allow.
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const express = require('express');
const multer = require('multer');
const config = require('../config');
const tasks = require('../services/taskService');
const { HttpError, methodNotAllowed } = require('../middleware/errors');
const { parseId, requireJson, requireMultipart } = require('../middleware/validate');
const { authenticate, requirePermission } = require('../middleware/auth');

const router = express.Router();
router.param('id', parseId('id'));

const upload = multer({
  storage: multer.diskStorage({
    destination: tasks.UPLOAD_DIR,
    // на диске — случайное имя, оригинальное хранится в БД
    filename: (req, file, cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: config.maxFileSizeMb * 1024 * 1024, files: 5 },
});

// Браузеры присылают имя файла в UTF-8, а multer читает его как latin1 — чиним кириллицу
const fixName = (name) => Buffer.from(name, 'latin1').toString('utf8');

router.use(authenticate); // всё ниже — только с действующим access-токеном

router
  .route('/')
  .get(async (req, res) => {
    const { status, scope } = req.query;
    if (status !== undefined && !tasks.STATUSES.includes(status)) {
      throw new HttpError(400, `Параметр status должен быть одним из: ${tasks.STATUSES.join(', ')}`);
    }
    if (scope !== undefined && !['all', 'mine'].includes(scope)) {
      throw new HttpError(400, 'Параметр scope должен быть all или mine');
    }
    res.json(await tasks.list({ status, scope }, req.user));
  })
  .post(requirePermission('tasks:create'), requireJson, async (req, res) => {
    const task = await tasks.create(req.body, req.user);
    req.log.info({ event: 'task.created', taskId: task.id }, 'Задача создана');
    res.status(201).location(`/api/tasks/${task.id}`).json(task);
  })
  .all(methodNotAllowed(['GET', 'HEAD', 'POST']));

router
  .route('/:id')
  .get(async (req, res) => {
    res.json(await tasks.getFor(req.user, req.resourceId, 'read'));
  })
  .put(requireJson, async (req, res) => {
    await tasks.getFor(req.user, req.resourceId, 'update');
    res.json(await tasks.update(req.resourceId, req.body, { partial: false }));
  })
  .patch(requireJson, async (req, res) => {
    await tasks.getFor(req.user, req.resourceId, 'update');
    res.json(await tasks.update(req.resourceId, req.body, { partial: true }));
  })
  .delete(async (req, res) => {
    await tasks.getFor(req.user, req.resourceId, 'delete');
    await tasks.remove(req.resourceId);
    req.log.info({ event: 'task.deleted', taskId: req.resourceId }, 'Задача удалена');
    res.status(204).end();
  })
  .all(methodNotAllowed(['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE']));

router
  .route('/:id/attachments')
  .post(
    requireMultipart,
    // сначала проверяем задачу и права — чтобы не сохранять файлы зря
    async (req, res, next) => {
      await tasks.getFor(req.user, req.resourceId, 'update');
      next();
    },
    upload.array('files'),
    async (req, res) => {
      const files = req.files || [];
      if (files.length === 0) throw new HttpError(400, 'Не передано ни одного файла (поле "files")');
      try {
        const saved = [];
        for (const f of files) saved.push(await tasks.addAttachment(req.resourceId, { ...f, originalname: fixName(f.originalname) }));
        res.status(201).json(saved);
      } catch (err) {
        await Promise.all(files.map((f) => fs.unlink(f.path).catch(() => {})));
        throw err;
      }
    },
  )
  .all(methodNotAllowed(['POST']));

module.exports = router;
