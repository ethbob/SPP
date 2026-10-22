// Бизнес-логика задач: проверка данных и запросы к БД.
// Тот же сервис, что и в лабе 1, только наружу отдаёт объекты для JSON (camelCase).
const fs = require('fs/promises');
const path = require('path');
const db = require('../db');
const { ValidationError } = require('../middleware/errors');

const STATUSES = ['todo', 'in_progress', 'done'];
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads');
const FIELDS = ['title', 'description', 'status', 'dueDate'];

function isValidDate(str) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const d = new Date(`${str}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === str;
}

/**
 * Проверяет тело запроса.
 * partial = false (POST, PUT) — нужен полный набор: обязательно title;
 * partial = true (PATCH) — можно передать только меняемые поля, но хотя бы одно.
 * Возвращает объект только с допустимыми полями или бросает ValidationError (400).
 */
function validate(body, { partial = false } = {}) {
  const errors = {};
  const out = {};

  for (const key of Object.keys(body)) {
    if (!FIELDS.includes(key)) errors[key] = 'Неизвестное поле';
  }

  if ('title' in body || !partial) {
    if (typeof body.title !== 'string' || !body.title.trim()) errors.title = 'Название обязательно и должно быть строкой';
    else if (body.title.trim().length > 200) errors.title = 'Название не длиннее 200 символов';
    else out.title = body.title.trim();
  }

  if ('description' in body) {
    if (body.description !== null && typeof body.description !== 'string') errors.description = 'Описание должно быть строкой';
    else if ((body.description || '').length > 5000) errors.description = 'Описание не длиннее 5000 символов';
    else out.description = (body.description || '').trim();
  } else if (!partial) {
    out.description = '';
  }

  if ('status' in body) {
    if (!STATUSES.includes(body.status)) errors.status = `Статус должен быть одним из: ${STATUSES.join(', ')}`;
    else out.status = body.status;
  } else if (!partial) {
    out.status = 'todo';
  }

  if ('dueDate' in body) {
    const v = body.dueDate;
    if (v === null || v === '') out.dueDate = null;
    else if (typeof v !== 'string' || !isValidDate(v)) errors.dueDate = 'Дата должна быть в формате ГГГГ-ММ-ДД';
    else out.dueDate = v;
  } else if (!partial) {
    out.dueDate = null;
  }

  if (partial && Object.keys(body).length === 0) errors._ = 'Передайте хотя бы одно поле для изменения';

  if (Object.keys(errors).length) throw new ValidationError(errors);
  return out;
}

// Строка БД → объект API
function toTask(row) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    dueDate: row.due_date,
    overdue: Boolean(row.due_date && row.status !== 'done' && row.due_date < today),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.attachments_count !== undefined && { attachmentsCount: row.attachments_count }),
  };
}

function toAttachment(row) {
  return {
    id: row.id,
    taskId: row.task_id,
    name: row.original_name,
    mimeType: row.mime_type,
    size: row.size,
    url: `/api/attachments/${row.id}`,
    createdAt: row.created_at,
  };
}

async function list({ status } = {}) {
  const params = [];
  let where = '';
  if (status) {
    params.push(status);
    where = 'WHERE t.status = $1';
  }
  const { rows } = await db.query(
    `SELECT t.*, COUNT(a.id)::int AS attachments_count
       FROM tasks t
       LEFT JOIN attachments a ON a.task_id = t.id
       ${where}
      GROUP BY t.id
      ORDER BY (t.status = 'done'), t.due_date NULLS LAST, t.id DESC`,
    params,
  );
  return rows.map(toTask);
}

async function exists(id) {
  const { rowCount } = await db.query('SELECT 1 FROM tasks WHERE id = $1', [id]);
  return rowCount > 0;
}

async function get(id) {
  const { rows } = await db.query('SELECT * FROM tasks WHERE id = $1', [id]);
  if (!rows[0]) return null;
  const { rows: files } = await db.query('SELECT * FROM attachments WHERE task_id = $1 ORDER BY id', [id]);
  return { ...toTask(rows[0]), attachments: files.map(toAttachment) };
}

async function create(body) {
  const t = validate(body);
  const { rows } = await db.query(
    `INSERT INTO tasks (title, description, status, due_date)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [t.title, t.description, t.status, t.dueDate],
  );
  return get(rows[0].id);
}

// PUT — полная замена, PATCH — частичное изменение
async function update(id, body, { partial }) {
  const t = validate(body, { partial });
  const columns = { title: 'title', description: 'description', status: 'status', dueDate: 'due_date' };
  const keys = Object.keys(t);
  const sets = keys.map((k, i) => `${columns[k]} = $${i + 1}`);
  const { rowCount } = await db.query(
    `UPDATE tasks SET ${sets.join(', ')}, updated_at = now() WHERE id = $${keys.length + 1}`,
    [...keys.map((k) => t[k]), id],
  );
  return rowCount ? get(id) : null;
}

async function remove(id) {
  const { rows: files } = await db.query('SELECT stored_name FROM attachments WHERE task_id = $1', [id]);
  const { rowCount } = await db.query('DELETE FROM tasks WHERE id = $1', [id]);
  if (rowCount) {
    await Promise.all(files.map((f) => fs.unlink(path.join(UPLOAD_DIR, f.stored_name)).catch(() => {})));
  }
  return rowCount > 0;
}

// file — объект от multer (diskStorage)
async function addAttachment(taskId, file) {
  const { rows } = await db.query(
    `INSERT INTO attachments (task_id, original_name, stored_name, mime_type, size)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [taskId, file.originalname, file.filename, file.mimetype, file.size],
  );
  return toAttachment(rows[0]);
}

async function getAttachment(id) {
  const { rows } = await db.query('SELECT * FROM attachments WHERE id = $1', [id]);
  return rows[0] || null;
}

async function removeAttachment(id) {
  const { rows } = await db.query('DELETE FROM attachments WHERE id = $1 RETURNING *', [id]);
  if (!rows[0]) return false;
  await fs.unlink(path.join(UPLOAD_DIR, rows[0].stored_name)).catch(() => {});
  return true;
}

module.exports = {
  STATUSES,
  UPLOAD_DIR,
  list,
  exists,
  get,
  create,
  update,
  remove,
  addAttachment,
  getAttachment,
  removeAttachment,
};
