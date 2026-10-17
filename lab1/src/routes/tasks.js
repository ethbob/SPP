// HTTP-слой: принимает формы, вызывает сервис, рендерит HTML или делает редирект.
// После каждого успешного POST — редирект (Post/Redirect/Get), чтобы F5 не отправлял форму повторно.
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const multer = require('multer');
const tasks = require('../services/taskService');

const router = express.Router();

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
function fixName(name) {
  return Buffer.from(name, 'latin1').toString('utf8');
}

// Пропускаем только числовые id, иначе — 404
router.param('id', (req, res, next, id) => {
  if (!/^\d+$/.test(id)) return next('route');
  req.taskId = Number(id);
  next();
});

// Для формы: значение по умолчанию у пустой задачи
const emptyTask = { title: '', description: '', status: 'todo', due_date: '' };

// Список + фильтр по статусу (?status=done)
router.get('/', async (req, res) => {
  const status = tasks.STATUSES[req.query.status] ? req.query.status : '';
  const [list, counts] = await Promise.all([tasks.list({ status }), tasks.counts()]);
  res.render('tasks/index', { title: 'Задачи', tasks: list, counts, status });
});

router.get('/new', (req, res) => {
  res.render('tasks/form', { title: 'Новая задача', task: emptyTask, errors: {}, action: '/tasks' });
});

// Создание: можно сразу приложить файлы (форма multipart/form-data)
router.post('/', upload.array('files'), async (req, res) => {
  try {
    const task = await tasks.create(req.body);
    for (const f of req.files || []) {
      await tasks.addAttachment(task.id, { ...f, originalname: fixName(f.originalname) });
    }
    res.redirect(`/tasks/${task.id}`);
  } catch (err) {
    await removeUploaded(req.files);
    if (!(err instanceof tasks.ValidationError)) throw err;
    res.status(400).render('tasks/form', {
      title: 'Новая задача',
      task: { ...emptyTask, ...req.body },
      errors: err.errors,
      action: '/tasks',
    });
  }
});

router.get('/:id', async (req, res, next) => {
  const task = await tasks.get(req.taskId);
  if (!task) return next();
  res.render('tasks/show', { title: task.title, task, uploadError: null, maxFileSize: MAX_FILE_SIZE_MB });
});

router.get('/:id/edit', async (req, res, next) => {
  const task = await tasks.get(req.taskId);
  if (!task) return next();
  res.render('tasks/form', {
    title: 'Редактирование',
    task: { ...task, due_date: task.due_date || '' },
    errors: {},
    action: `/tasks/${task.id}`,
  });
});

router.post('/:id', async (req, res, next) => {
  try {
    const task = await tasks.update(req.taskId, req.body);
    if (!task) return next();
    res.redirect(`/tasks/${task.id}`);
  } catch (err) {
    if (!(err instanceof tasks.ValidationError)) throw err;
    res.status(400).render('tasks/form', {
      title: 'Редактирование',
      task: { ...req.body, id: req.taskId },
      errors: err.errors,
      action: `/tasks/${req.taskId}`,
    });
  }
});

// Быстрая смена статуса прямо из списка. redirect — куда вернуться (только локальные пути)
router.post('/:id/status', async (req, res, next) => {
  const task = await tasks.setStatus(req.taskId, req.body.status);
  if (!task) return next();
  const back = String(req.body.redirect || '');
  res.redirect(back.startsWith('/') && !back.startsWith('//') ? back : `/tasks/${task.id}`);
});

router.post('/:id/delete', async (req, res, next) => {
  const ok = await tasks.remove(req.taskId);
  if (!ok) return next();
  res.redirect('/tasks');
});

// Загрузка файлов к существующей задаче
router.post('/:id/attachments', (req, res, next) => {
  upload.array('files')(req, res, async (err) => {
    try {
      const task = await tasks.get(req.taskId);
      if (!task) {
        await removeUploaded(req.files);
        return next();
      }
      let uploadError = null;
      if (err instanceof multer.MulterError) {
        uploadError = err.code === 'LIMIT_FILE_SIZE'
          ? `Файл больше ${MAX_FILE_SIZE_MB} МБ`
          : err.code === 'LIMIT_FILE_COUNT' ? 'Не больше 5 файлов за раз' : 'Ошибка загрузки файла';
      } else if (err) {
        throw err;
      } else if (!req.files || req.files.length === 0) {
        uploadError = 'Выберите хотя бы один файл';
      }
      if (uploadError) {
        await removeUploaded(req.files);
        return res.status(400).render('tasks/show', { title: task.title, task, uploadError, maxFileSize: MAX_FILE_SIZE_MB });
      }
      for (const f of req.files) {
        await tasks.addAttachment(task.id, { ...f, originalname: fixName(f.originalname) });
      }
      res.redirect(`/tasks/${task.id}`);
    } catch (e) {
      next(e);
    }
  });
});

async function removeUploaded(files) {
  const fs = require('fs/promises');
  await Promise.all((files || []).map((f) => fs.unlink(f.path).catch(() => {})));
}

module.exports = router;
