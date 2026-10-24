# СПП — Лабораторные работы 2–3. Список задач: SPA + REST API + доступ по ролям

- **Лаба 2:** клиент — SPA на React, сервер — REST API на Express + PostgreSQL, всё в Docker.
- **Лаба 3:** роли и временные ключи (JWT), коды ошибок по стандартам HTTP, защита от подбора пароля,
  контроль сессий, восстановление доступа по email, структурированные логи, автоматическая проверка кода (CI).

Версия, сданная как лаба 2, сохранена в git под тегом `lab2` (`git checkout lab2`).

## Запуск

Нужен запущенный Docker Desktop.

```bash
cd lab2-3
docker compose up -d --build
```

| Адрес | Что там |
|---|---|
| http://localhost:8080 | приложение |
| http://localhost:8025 | Mailpit — письма восстановления пароля |

Демо-пользователи (создаются автоматически):

| Роль | Email | Пароль |
|---|---|---|
| Администратор | admin@example.com | Admin12345 |
| Менеджер | manager@example.com | Manager12345 |
| Пользователь | user@example.com | User12345 |

Логи API (JSON): `docker compose logs -f api`. Остановить: `docker compose down` (данные останутся в томах).

## Модель доступа

| Разрешение | user | manager | admin |
|---|:-:|:-:|:-:|
| создавать задачи, видеть/менять/удалять **свои** | ✓ | ✓ | ✓ |
| видеть **все** задачи | | ✓ | ✓ |
| менять **чужие** задачи (статус, поля, файлы) | | ✓ | ✓ |
| удалять **чужие** задачи | | | ✓ |
| видеть список пользователей | | ✓ | ✓ |
| менять роли, блокировать, завершать чужие сессии | | | ✓ |

Права описаны в одном месте — `server/src/permissions.js`. Код проверяет разрешения (`tasks:delete:any`), а не названия ролей.

### Временные ключи

- **access-токен** — JWT на 15 минут (`sub` = id пользователя, `role`, `sid` = id сессии). Клиент держит его в памяти и
  отправляет в заголовке `Authorization: Bearer …`.
- **refresh-токен** — случайная строка на 7 дней в `httpOnly`, `SameSite=Strict` cookie. В БД хранится только SHA-256.
  `POST /api/auth/refresh` выдаёт новый access-токен и **меняет** refresh-токен (ротация).
- При каждом запросе сервер проверяет, что сессия из токена не завершена и пользователь не заблокирован —
  завершение сессии или блокировка действуют сразу.

## Коды ответов (RFC 9110) и формат ошибок (RFC 9457)

Ошибки — `application/problem+json`:
```json
{ "type": "/problems/validation-error", "title": "Unprocessable Entity", "status": 422,
  "detail": "Данные не прошли проверку", "instance": "/api/tasks", "requestId": "…",
  "errors": { "title": "Название обязательно и должно быть строкой" } }
```

| Код | Когда |
|---|---|
| 200 / 201 / 202 / 204 | успех / создано (+`Location`) / принято (письмо) / без тела |
| 400 | синтаксически неверный запрос: битый JSON, нечисловой id, неверный query-параметр |
| 401 | нет или недействителен токен (+ заголовок `WWW-Authenticate: Bearer`), неверный пароль |
| 403 | вход выполнен, но прав нет; учётная запись заблокирована администратором |
| 404 | ресурса нет |
| 405 | метод не поддерживается для этого адреса (+ заголовок `Allow`) |
| 409 | конфликт: email уже зарегистрирован |
| 410 | ссылка восстановления уже использована или истекла |
| 413 | файл больше 10 МБ, больше 5 файлов |
| 415 | неверный `Content-Type` |
| 422 | JSON корректный, но данные не прошли проверку (поля в `errors`) |
| 429 | слишком много попыток (+ заголовок `Retry-After`) |
| 500 / 503 | ошибка сервера / база или почта недоступны (+ `Retry-After`) |

## Защита

- **Подбор пароля:** 5 неверных паролей подряд → учётная запись блокируется на 15 минут (429 + `Retry-After`,
  даже при верном пароле). Плюс лимит по IP: 20 попыток входа за 15 минут. Ответ «неверный email или пароль»
  одинаковый для несуществующего email и неверного пароля; время ответа тоже одинаковое.
- **Активные подключения:** каждая авторизация — запись в таблице `sessions` (устройство, IP, время).
  Страница «Сессии»: завершить одну или все, кроме текущей. Не больше 5 одновременных сессий — старые завершаются.
  Админ может завершить все сессии пользователя или заблокировать его.
- **Восстановление по email:** `POST /api/auth/forgot-password` → письмо со ссылкой (токен на 30 минут, одноразовый,
  в БД — только хеш). Ответ всегда 202, даже если email не найден. После смены пароля завершаются все сессии.
- Пароли — bcrypt; секреты (`Authorization`, cookie, пароли, токены) в логах маскируются.

## Логирование

pino, одна JSON-строка на событие: уровень, время, `req.id` (он же заголовок `X-Request-Id` и поле `requestId`
в ошибках), метод, путь, код, время ответа, `userId`. События безопасности: `auth.login.success`,
`auth.login.failure`, `auth.account.locked`, `security.rate_limited`, `session.revoked`, `user.role_changed`,
`user.blocked`, `auth.reset.requested`, `auth.reset.completed`.

```bash
docker compose logs api | grep '"event":"auth'      # все события входа
```

## CI

`.github/workflows/lab2-3.yml` (в корне репозитория). На каждый push/PR с изменениями в `lab2-3/`:
1. **API:** `npm ci` → ESLint → интеграционные тесты (`node --test` + supertest) на временной PostgreSQL;
2. **клиент:** `npm ci` → ESLint → сборка Vite;
3. **Docker:** `docker compose build`.

Локально: `cd server && npm run lint && npm test` (нужна база, см. ниже), `cd client && npm run lint && npm run build`.

## REST API

| Метод | Путь | Кто | Ответ |
|---|---|---|---|
| POST | `/api/auth/register` | все | 201 |
| POST | `/api/auth/login` | все | 200 / 401 / 403 / 429 |
| POST | `/api/auth/refresh` | по cookie | 200 / 401 |
| POST | `/api/auth/logout` | по cookie | 204 |
| GET | `/api/auth/me` | вошедшие | 200 |
| GET / DELETE | `/api/auth/sessions` | вошедшие | 200 / 204 |
| DELETE | `/api/auth/sessions/:id` | вошедшие | 204 / 404 |
| POST | `/api/auth/forgot-password` | все | 202 |
| POST | `/api/auth/reset-password` | все | 204 / 400 / 410 / 422 |
| GET | `/api/users` | manager, admin | 200 / 403 |
| PATCH | `/api/users/:id` | admin | 200 / 403 / 404 |
| DELETE | `/api/users/:id/sessions` | admin | 204 / 403 / 404 |
| GET | `/api/tasks?status=&scope=all\|mine` | вошедшие | 200 |
| POST | `/api/tasks` | вошедшие | 201 |
| GET / PUT / PATCH / DELETE | `/api/tasks/:id` | по правам | 200 / 204 / 403 / 404 |
| POST | `/api/tasks/:id/attachments` | по правам | 201 / 403 / 404 / 413 |
| GET / DELETE | `/api/attachments/:id` | по правам | 200 / 204 / 403 / 404 |
| GET | `/api/health` | все | 200 / 503 |

## Структура

```
lab2-3/
  docker-compose.yml       db + mailpit + api + web
  server/
    src/config.js          настройки из переменных окружения
    src/logger.js          pino: JSON-логи, маскирование секретов
    src/permissions.js     роли → разрешения
    src/app.js             Express: логи запросов, cookie, маршруты, ошибки
    src/routes/            auth, users, tasks, attachments
    src/services/          authService (токены, сессии, блокировка, сброс), userService, taskService, mailer
    src/middleware/        errors (Problem Details), auth (токен, права), rateLimit, validate
    src/db/schema.sql      users, sessions, password_resets, tasks, attachments
    test/api.test.js       интеграционные тесты
  client/
    src/api.js             fetch, токен в памяти, автообновление по 401, разбор ошибок
    src/components/Auth.jsx  состояние входа и права
    src/pages/             задачи, вход, регистрация, восстановление, сессии, пользователи
.github/workflows/lab2-3.yml  CI (в корне репозитория)
```

## Разработка без Docker

```bash
docker compose up -d db mailpit
cd server && cp .env.example .env && npm install && npm run dev   # API на :4000
cd client && npm install && npm run dev                           # клиент на :5173
# тесты: один раз создать базу tasks_test (docker exec spp_lab2_db createdb -U app tasks_test), затем
DATABASE_URL=postgres://app:app@localhost:5434/tasks_test npm test
```
