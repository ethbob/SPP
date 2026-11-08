# СПП — Лабораторная работа 4. «Кто быстрее» — многопользовательская игра в реальном времени

На поле появляются круги. Кто кликнул первым — забирает очки: обычный круг — 1, маленький — 2, золотой — 5.
Матч длится 60 секунд, потом 8 секунд перерыв с итогами. Все игроки видят одно и то же поле и счёт в реальном времени.

**Без фреймворков:** сервер — встроенный модуль `http` Node.js, клиент — обычные HTML/CSS/JS (ES-модули браузера,
`<canvas>`), без сборщика. Сторонние пакеты на сервере: `ws` (протокол WebSocket) и `pg` (драйвер PostgreSQL).

## Запуск

```bash
cd lab4
docker compose up -d --build
```
Игра: http://localhost:8090 (для проверки откройте в двух браузерах или во второй вкладке в режиме инкогнито).

Без Docker: `docker compose up -d db`, затем `npm install && npm run dev` → http://localhost:3000.

## Как выполнены требования

| Требование | Реализация |
|---|---|
| Синхронизация через WebSockets | Сервер — единственный источник правды. Клик → `claim` на сервер → сервер решает и рассылает событие `target.claimed` всем. У каждого события сквозной номер `seq`, порядок у всех одинаковый |
| Только JavaScript, без фреймворков | `http` + `ws` на сервере, DOM + canvas на клиенте |
| Сохранение между запусками | PostgreSQL: игроки, матчи, очки, цели, журнал событий. После перезапуска сервер продолжает незавершённый матч (время, очки, цели на поле) |
| **Доп. 1.** Конкурентный доступ | Двое кликнули по одной цели: сервер обрабатывает сообщения по очереди, проверка «цель свободна» и пометка «занята» идут без `await` между ними. Второй получает `conflict` с именем победителя и на сколько мс он опоздал. В БД — `UPDATE … WHERE claimed_by IS NULL` (оптимистичная блокировка), версия цели. Повтор своего клика — `duplicate`, очки не начисляются дважды |
| **Доп. 2.** Потеря соединения | Клиент хранит в `localStorage` токен игрока, последний снимок, номер последнего события и очередь кликов. Без связи: баннер, клики копятся в очереди. Переподключение — автоматически (0.5 → 1 → 2 … 10 с, плюс событие браузера `online`). После переподключения сервер присылает актуальное состояние и пропущенные события (`lastSeq`), клиент отправляет очередь — каждый клик сервер проверяет честно |
| **Доп. 3.** Хостинг | Render (веб-сервис) + Neon (PostgreSQL), инструкция ниже |

## Протокол (JSON через WebSocket `/ws`)

Клиент → сервер: `hello {token?, name?, lastSeq?}`, `claim {actionId, targetId, x, y, queued?}`, `rename {name}`, `ping {t}`.

Сервер → клиент: `welcome {you, token?, snapshot, online, missed}`, `event {seq, event, data}`
(`match.started`, `match.ended`, `match.resumed`, `target.spawned`, `target.claimed`, `target.expired`, `player.renamed`),
`claim.result {actionId, ok, reason?, by?, lateMs?}`, `presence {online}`, `pong`, `error {code}`.

## Структура

```
lab4/
  src/
    index.js       запуск (с повторами подключения к БД)
    server.js      HTTP + WebSocket на одном порту
    http.js        статические файлы, /health, /api/leaderboard
    realtime.js    WebSocket: протокол, проверка сообщений, лимит кликов, heartbeat
    game.js        игровая логика: матчи, цели, захват и разрешение конфликтов
    store.js       SQL-запросы
    db.js          пул PostgreSQL (+ SSL для Neon)
    schema.sql     players, matches, match_scores, targets, events
    logger.js      JSON-логи
  public/
    index.html, style.css
    js/main.js         связывает всё вместе
    js/connection.js   WebSocket + автопереподключение + сверка часов
    js/state.js        состояние игры, кэш в localStorage
    js/render.js       отрисовка на canvas
    js/ui.js           панели, лента событий, уведомления
  test/game.test.js    интеграционные тесты (несколько WebSocket-клиентов + PostgreSQL)
```

## Тесты и CI

```bash
docker exec spp_lab4_db createdb -U app game_test     # один раз
DATABASE_URL=postgres://app:app@localhost:5435/game_test npm test
npm run lint
```
GitHub Actions: `.github/workflows/lab4.yml` (линтер, тесты на временной PostgreSQL, сборка Docker-образа).

## Развёртывание (Render + Neon)

1. **База.** https://neon.tech → Sign up → Create project → скопировать *Connection string*
   (`postgresql://…neon.tech/neondb?sslmode=require…`).
2. **Сервер.** https://render.com → Sign up через GitHub → **New → Web Service** → репозиторий `SPP`:
   - Root Directory: `lab4`
   - Runtime: Node · Build Command: `npm ci --omit=dev` · Start Command: `npm start`
   - Instance Type: **Free**
   - Environment: `DATABASE_URL` = строка из Neon, `NODE_VERSION` = `22`
   - Advanced → Health Check Path: `/health`
3. **Create Web Service** → через 2–3 минуты игра доступна по адресу вида `https://who-is-faster.onrender.com`.

Бесплатный сервис Render засыпает после 15 минут без посетителей; первое открытие после этого занимает ~30–50 секунд.
Данные при этом не теряются — они в Neon.
