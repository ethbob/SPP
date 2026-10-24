-- Схема создаётся при каждом старте API; все команды идемпотентны (IF NOT EXISTS),
-- поэтому база из лабы 2 обновляется без потери данных.

-- ---------- Пользователи и доступ (лаба 3) ----------
CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  email           VARCHAR(254) NOT NULL UNIQUE,
  name            VARCHAR(100) NOT NULL,
  password_hash   VARCHAR(100) NOT NULL,
  role            VARCHAR(20)  NOT NULL DEFAULT 'user'
                  CHECK (role IN ('user', 'manager', 'admin')),
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
  -- защита от подбора пароля: счётчик неудачных входов и время блокировки
  failed_logins   INTEGER      NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Активные подключения: одна строка = один вход с устройства (refresh-токен)
CREATE TABLE IF NOT EXISTS sessions (
  id                 UUID PRIMARY KEY,
  user_id            INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash CHAR(64)    NOT NULL UNIQUE, -- храним только SHA-256, не сам токен
  user_agent         VARCHAR(300),
  ip                 VARCHAR(64),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at         TIMESTAMPTZ NOT NULL,
  revoked_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Одноразовые ссылки для восстановления пароля
CREATE TABLE IF NOT EXISTS password_resets (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  CHAR(64)    NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Задачи и файлы (лабы 1–2) ----------
CREATE TABLE IF NOT EXISTS tasks (
  id          SERIAL PRIMARY KEY,
  title       VARCHAR(200) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status      VARCHAR(20)  NOT NULL DEFAULT 'todo'
              CHECK (status IN ('todo', 'in_progress', 'done')),
  due_date    DATE,
  user_id     INTEGER, -- владелец задачи
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Внешний ключ tasks.user_id → users.id (поле было заложено в лабе 1)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_user_id_fkey') THEN
    ALTER TABLE tasks
      ADD CONSTRAINT tasks_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS attachments (
  id            SERIAL PRIMARY KEY,
  task_id       INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  original_name VARCHAR(255) NOT NULL,
  stored_name   VARCHAR(255) NOT NULL UNIQUE,
  mime_type     VARCHAR(255) NOT NULL,
  size          INTEGER NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_attachments_task ON attachments(task_id);
