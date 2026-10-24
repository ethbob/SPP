# СПП — Лабораторная работа 2. Список задач: SPA + REST API

Клиент — **SPA на React** (страница не перезагружается, данные приходят через `fetch` в JSON).
Сервер — **REST API на Node.js (Express)** с базой **PostgreSQL**. Всё упаковано в **Docker**.

## Запуск (Docker)

Нужен запущенный Docker Desktop.

```bash
cd lab2
docker compose up -d --build
```

Откройте http://localhost:8080. Первая сборка занимает 1–3 минуты.

Остановить: `docker compose down` (данные останутся в томах `pgdata` и `uploads`; `docker compose down -v` удалит и их).
Логи API: `docker compose logs -f api`.

## Архитектура

```
браузер ──► web (nginx, :8080) ──► отдаёт собранный React (index.html + JS)
               │
               └── /api/* ──► api (Node.js + Express, :4000) ──► db (PostgreSQL)
                                    └── файлы в томе uploads
```

| Контейнер | Что внутри | Зачем |
|---|---|---|
| `web` | nginx + собранный React | Отдаёт SPA и проксирует `/api` на API — клиент и API на одном адресе, без CORS |
| `api` | Node.js + Express | REST API, проверка данных, работа с БД и файлами |
| `db` | PostgreSQL 16 | Хранит задачи и сведения о файлах |

## REST API

Все ответы — JSON. Ошибки в едином формате:
`{ "error": { "status": 400, "message": "...", "details": { "title": "..." } } }`

| Метод | Путь | Тело | Успех | Ошибки |
|---|---|---|---|---|
| GET | `/api/tasks?status=` | — | 200 + массив | 400 (неверный status) |
| POST | `/api/tasks` | JSON | 201 + задача, заголовок `Location` | 400, 415 |
| GET | `/api/tasks/:id` | — | 200 + задача с файлами | 400 (неверный id), 404 |
| PUT | `/api/tasks/:id` | JSON (все поля) | 200 + задача | 400, 404, 415 |
| PATCH | `/api/tasks/:id` | JSON (часть полей) | 200 + задача | 400, 404, 415 |
| DELETE | `/api/tasks/:id` | — | 204 | 404 |
| POST | `/api/tasks/:id/attachments` | multipart/form-data, поле `files` | 201 + массив файлов | 400, 404, 413, 415 |
| GET | `/api/attachments/:id` | — | 200 + файл | 404 |
| DELETE | `/api/attachments/:id` | — | 204 | 404 |

Поля задачи: `title` (строка, обязательно, ≤200), `description` (строка), `status` (`todo` / `in_progress` / `done`),
`dueDate` (`ГГГГ-ММ-ДД` или `null`). Неизвестные поля → 400.

Примеры:
```bash
curl localhost:8080/api/tasks
curl -X POST localhost:8080/api/tasks -H 'Content-Type: application/json' -d '{"title":"Купить хлеб","dueDate":"2026-11-01"}'
curl -X PATCH localhost:8080/api/tasks/1 -H 'Content-Type: application/json' -d '{"status":"done"}'
curl -X POST localhost:8080/api/tasks/1/attachments -F files=@report.pdf
curl -X DELETE localhost:8080/api/tasks/1 -i
```

## Структура

```
lab2/
  docker-compose.yml     db + api + web
  server/                REST API
    Dockerfile
    src/index.js         запуск: подключение к БД (с повторами) и listen
    src/app.js           Express: express.json, маршруты, 404, обработчик ошибок
    src/routes/          tasks.js, attachments.js — HTTP-методы и коды ответов
    src/services/        taskService.js — проверка данных и SQL
    src/middleware/      errors.js (формат ошибок), validate.js (id, Content-Type)
    src/db/              подключение и schema.sql
  client/                SPA на React (Vite)
    Dockerfile           сборка → nginx
    nginx.conf           раздача SPA + прокси /api
    src/api.js           все запросы к API (fetch), разбор ошибок
    src/App.jsx          клиентские маршруты (React Router)
    src/pages/           список, страница задачи, форма
    src/components/      уведомления, статус, блок ошибки
```

## Разработка без Docker (по желанию)

```bash
docker compose up -d db                 # только база, на порту 5434
cd server && cp .env.example .env && npm install && npm run dev   # API на :4000
cd client && npm install && npm run dev                           # клиент на :5173
```
