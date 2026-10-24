// Ограничение частоты запросов с одного IP (защита от перебора паролей и спама письмами).
// Скользящее окно в памяти процесса: для одного экземпляра API этого достаточно,
// при нескольких экземплярах счётчики нужно хранить в Redis.
const { tooManyRequests } = require('./errors');

function rateLimit({ windowMs, max, name, message }) {
  const hits = new Map(); // ключ → массив времён запросов

  // периодически чистим старые ключи, чтобы Map не рос бесконечно
  setInterval(() => {
    const border = Date.now() - windowMs;
    for (const [key, times] of hits) {
      const fresh = times.filter((t) => t > border);
      if (fresh.length) hits.set(key, fresh);
      else hits.delete(key);
    }
  }, windowMs).unref();

  const middleware = (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    const times = (hits.get(key) || []).filter((t) => t > now - windowMs);

    if (times.length >= max) {
      const retryAfterSec = (times[0] + windowMs - now) / 1000;
      req.log.warn({ event: 'security.rate_limited', limiter: name, ip: key }, 'Превышен лимит запросов');
      throw tooManyRequests(message, retryAfterSec);
    }
    times.push(now);
    hits.set(key, times);
    res.set('RateLimit-Limit', String(max));
    res.set('RateLimit-Remaining', String(max - times.length));
    next();
  };
  middleware.reset = () => hits.clear(); // для тестов
  return middleware;
}

module.exports = { rateLimit };
