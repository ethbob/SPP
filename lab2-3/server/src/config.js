// Все настройки из переменных окружения — в одном месте
require('dotenv').config();

const env = process.env;
const isTest = env.NODE_ENV === 'test';

const config = {
  env: env.NODE_ENV || 'development',
  isTest,
  port: Number(env.PORT) || 4000,
  databaseUrl: env.DATABASE_URL || 'postgres://app:app@localhost:5434/tasks',
  appUrl: env.APP_URL || 'http://localhost:8080', // адрес клиента — для ссылок в письмах
  logLevel: env.LOG_LEVEL || (isTest ? 'silent' : 'info'),
  maxFileSizeMb: Number(env.MAX_FILE_SIZE_MB) || 10,

  jwt: {
    secret: env.JWT_SECRET || 'dev-only-secret-change-me',
    accessTtlSec: Number(env.ACCESS_TOKEN_TTL_SEC) || 15 * 60, // access-токен живёт 15 минут
  },
  session: {
    refreshTtlDays: Number(env.REFRESH_TOKEN_TTL_DAYS) || 7, // refresh-токен — 7 дней
    maxActive: Number(env.MAX_SESSIONS) || 5, // не больше 5 одновременных входов
  },
  security: {
    maxFailedLogins: Number(env.MAX_FAILED_LOGINS) || 5, // после 5 ошибок подряд —
    lockMinutes: Number(env.LOCK_MINUTES) || 15, //          блокировка на 15 минут
    ipLoginLimit: Number(env.IP_LOGIN_LIMIT) || 20, // не больше 20 попыток входа с одного IP
    ipWindowMinutes: Number(env.IP_WINDOW_MINUTES) || 15, // за 15 минут
    resetTtlMinutes: 30, // ссылка восстановления пароля действует 30 минут
  },
  mail: {
    host: env.SMTP_HOST || 'localhost',
    port: Number(env.SMTP_PORT) || 1025,
    from: env.MAIL_FROM || 'Задачи <no-reply@tasks.local>',
  },
  seedDemoUsers: env.SEED_DEMO_USERS !== 'false',
};

if (config.env === 'production' && config.jwt.secret === 'dev-only-secret-change-me') {
  console.warn('ВНИМАНИЕ: JWT_SECRET не задан, используется небезопасный ключ по умолчанию');
}

module.exports = config;
