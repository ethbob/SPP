// Настройки из переменных окружения — в одном месте
const env = process.env;
const isTest = env.NODE_ENV === 'test';

module.exports = {
  isTest,
  port: Number(env.PORT) || 3000,
  databaseUrl: env.DATABASE_URL || 'postgres://app:app@localhost:5435/game',
  logLevel: env.LOG_LEVEL || (isTest ? 'silent' : 'info'),
  game: {
    matchMs: Number(env.MATCH_MS) || 60_000, // длительность матча
    breakMs: Number(env.BREAK_MS) || 8_000, //  пауза между матчами
    autoSpawn: env.AUTO_SPAWN !== 'false', //   в тестах цели создаются вручную
    maxTargets: 6, //                            одновременно на поле
    spawnEveryMs: [450, 1100], //                интервал появления целей
  },
  limits: {
    claimsPerSecond: 15, // больше кликов в секунду с одного соединения — игнорируем
    maxMessageBytes: 4096,
    resyncEvents: 300, //   сколько пропущенных событий досылаем после переподключения
  },
};
