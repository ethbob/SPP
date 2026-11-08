-- Все команды идемпотентны: схема создаётся/обновляется при каждом запуске

-- Игроки. Входа по паролю нет: игрок узнаётся по случайному токену из localStorage
CREATE TABLE IF NOT EXISTS players (
  id              SERIAL PRIMARY KEY,
  token_hash      CHAR(64)    NOT NULL UNIQUE, -- SHA-256 токена, сам токен знает только браузер
  name            VARCHAR(24) NOT NULL,
  color           VARCHAR(7)  NOT NULL,
  total_points    INTEGER     NOT NULL DEFAULT 0,
  total_hits      INTEGER     NOT NULL DEFAULT 0,
  best_reaction_ms INTEGER,
  matches_played  INTEGER     NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Матчи по 60 секунд. Незавершённый матч продолжается после перезапуска сервера
CREATE TABLE IF NOT EXISTS matches (
  id          SERIAL PRIMARY KEY,
  status      VARCHAR(10) NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'finished')),
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at     TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  winner_id   INTEGER REFERENCES players(id) ON DELETE SET NULL
);

-- Очки игрока в конкретном матче
CREATE TABLE IF NOT EXISTS match_scores (
  match_id  INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  points    INTEGER NOT NULL DEFAULT 0,
  hits      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (match_id, player_id)
);

-- Цели на поле. claimed_by + version — защита от одновременного захвата одной цели
CREATE TABLE IF NOT EXISTS targets (
  id          UUID PRIMARY KEY,
  match_id    INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  kind        VARCHAR(10) NOT NULL,
  x           REAL NOT NULL,
  y           REAL NOT NULL,
  r           REAL NOT NULL,
  points      INTEGER NOT NULL,
  spawned_at  TIMESTAMPTZ NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  claimed_by  INTEGER REFERENCES players(id) ON DELETE SET NULL,
  claimed_at  TIMESTAMPTZ,
  reaction_ms INTEGER,
  version     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_targets_match ON targets(match_id);

-- Журнал событий игры. seq — сквозной номер: клиент после обрыва связи
-- сообщает последний полученный seq, и сервер досылает всё, что было после
CREATE TABLE IF NOT EXISTS events (
  seq        BIGSERIAL PRIMARY KEY,
  match_id   INTEGER,
  type       VARCHAR(30) NOT NULL,
  payload    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
