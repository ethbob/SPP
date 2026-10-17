// Вся работа с задачами: валидация и запросы к БД.
// Маршруты ничего не знают про SQL
const fs = require('fs/promises');
const path = require('path');
const db = require('../db');

const STATUSES = {
  todo: 'Нужно сделать',
  in_progress: 'В работе',
  done: 'Выполнено',
};

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');

class ValidationError extends Error {
  constructor(errors) {
    super('Validation failed');
    this.errors = errors;
  }
}

function isValidDate(str) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const d = new Date(`${str}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === str;
}

// Приводит данные формы к виду для БД или бросает ValidationError
function validate(input) {
  const errors = {};
  const title = String(input.title ?? '').trim();
  const description = String(input.description ?? '').trim();
  const status = String(input.status ?? 'todo');
  const dueDate = String(input.due_date ?? '').trim();

  if (!title) errors.title = 'Введите название задачи';
  else if (title.length > 200) errors.title = 'Название не длиннее 200 символов';

  if (description.length > 5000) errors.description = 'Описание не длиннее 5000 символов';

  if (!STATUSES[status]) errors.status = 'Неизвестный статус';

  if (dueDate && !isValidDate(dueDate)) errors.due_date = 'Некорректная дата';

  if (Object.keys(errors).length) throw new ValidationError(errors);

  return { title, description, status, due_date: dueDate || null };
}

function isOverdue(task) {
  if (!task.due_date || task.status === 'done') return false;
  const today = new Date().toISOString().slice(0, 10);
  return task.due_date < today;
}

function decorate(task) {
  return { ...task, status_label: STATUSES[task.status], overdue: isOverdue(task) };
}

async function list({ status } = {}) {
  const params = [];
  let where = '';
  if (status && STATUSES[status]) {
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
  return rows.map(decorate);
}

async function counts() {
  const { rows } = await db.query('SELECT status, COUNT(*)::int AS n FROM tasks GROUP BY status');
  const result = { all: 0, todo: 0, in_progress: 0, done: 0 };
  for (const r of rows) {
    result[r.status] = r.n;
    result.all += r.n;
  }
  return result;
}

async function get(id) {
  const { rows } = await db.query('SELECT * FROM tasks WHERE id = $1', [id]);
  if (!rows[0]) return null;
  const { rows: attachments } = await db.query(
    'SELECT * FROM attachments WHERE task_id = $1 ORDER BY created_at',
    [id],
  );
  return { ...decorate(rows[0]), attachments };
}

async function create(input) {
  const t = validate(input);
  const { rows } = await db.query(
    `INSERT INTO tasks (title, description, status, due_date)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [t.title, t.description, t.status, t.due_date],
  );
  return rows[0];
}

async function update(id, input) {
  const t = validate(input);
  const { rows } = await db.query(
    `UPDATE tasks SET title = $1, description = $2, status = $3, due_date = $4, updated_at = now()
      WHERE id = $5 RETURNING *`,
    [t.title, t.description, t.status, t.due_date, id],
  );
  return rows[0] || null;
}

async function setStatus(id, status) {
  if (!STATUSES[status]) throw new ValidationError({ status: 'Неизвестный статус' });
  const { rows } = await db.query(
    'UPDATE tasks SET status = $1, updated_at = now() WHERE id = $2 RETURNING *',
    [status, id],
  );
  return rows[0] || null;
}

async function remove(id) {
  const { rows: files } = await db.query('SELECT stored_name FROM attachments WHERE task_id = $1', [id]);
  const { rowCount } = await db.query('DELETE FROM tasks WHERE id = $1', [id]);
  await Promise.all(files.map((f) => fs.unlink(path.join(UPLOAD_DIR, f.stored_name)).catch(() => {})));
  return rowCount > 0;
}

// file — объект от multer (diskStorage)
async function addAttachment(taskId, file) {
  const { rows } = await db.query(
    `INSERT INTO attachments (task_id, original_name, stored_name, mime_type, size)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [taskId, file.originalname, file.filename, file.mimetype, file.size],
  );
  return rows[0];
}

async function getAttachment(id) {
  const { rows } = await db.query('SELECT * FROM attachments WHERE id = $1', [id]);
  return rows[0] || null;
}

async function removeAttachment(id) {
  const { rows } = await db.query('DELETE FROM attachments WHERE id = $1 RETURNING *', [id]);
  if (!rows[0]) return null;
  await fs.unlink(path.join(UPLOAD_DIR, rows[0].stored_name)).catch(() => {});
  return rows[0];
}

module.exports = {
  STATUSES,
  UPLOAD_DIR,
  ValidationError,
  list,
  counts,
  get,
  create,
  update,
  setStatus,
  remove,
  addAttachment,
  getAttachment,
  removeAttachment,
};
