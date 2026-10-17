require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const db = require('./db');
const tasks = require('./services/taskService');

// Express 5 сам передаёт ошибки из async-обработчиков в обработчик ошибок
const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: false })); // обычные формы
// В Express 5 req.body может быть undefined, если тела нет
app.use((req, res, next) => {
  req.body ??= {};
  next();
});
app.use(express.static(path.join(__dirname, '..', 'public')));

// Хелперы, доступные во всех шаблонах
app.locals.STATUSES = tasks.STATUSES;
app.locals.formatDate = (d) => {
  if (!d) return '';
  const [y, m, day] = String(d).slice(0, 10).split('-');
  return `${day}.${m}.${y}`;
};
app.locals.formatSize = (bytes) => {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
};

app.get('/', (req, res) => res.redirect('/tasks'));
app.use('/tasks', require('./routes/tasks'));
app.use('/attachments', require('./routes/attachments'));

app.use((req, res) => {
  res.status(404).render('error', { title: 'Не найдено', code: 404, message: 'Такой страницы или задачи нет.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof tasks.ValidationError) {
    const message = Object.values(err.errors).join('. ');
    return res.status(400).render('error', { title: 'Некорректный запрос', code: 400, message });
  }
  console.error(err);
  res.status(500).render('error', { title: 'Ошибка', code: 500, message: 'Что-то пошло не так на сервере.' });
});

const PORT = Number(process.env.PORT) || 3000;

async function start() {
  fs.mkdirSync(tasks.UPLOAD_DIR, { recursive: true });
  await db.init();
  app.listen(PORT, () => console.log(`Сервер запущен: http://localhost:${PORT}`));
}

if (require.main === module) {
  start().catch((err) => {
    console.error('Не удалось запустить приложение. Запущена ли база? (docker compose up -d)');
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = app;
