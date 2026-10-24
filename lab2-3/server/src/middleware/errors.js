// Ошибки API в стандартном формате Problem Details (RFC 9457), Content-Type: application/problem+json
// {
//   "type": "/problems/validation-error", "title": "Unprocessable Content", "status": 422,
//   "detail": "Данные не прошли проверку", "instance": "/api/tasks", "requestId": "…",
//   "errors": { "title": "Название обязательно" }
// }
const http = require('http');
const logger = require('../logger');

class HttpError extends Error {
  /**
   * @param {number} status  HTTP-код
   * @param {string} detail  понятное человеку описание
   * @param {object} [opts]  { type, errors, headers }
   */
  constructor(status, detail, opts = {}) {
    super(detail);
    this.status = status;
    this.detail = detail;
    this.type = opts.type;
    this.errors = opts.errors;
    this.headers = opts.headers;
  }
}

// 422 — запрос корректный синтаксически (валидный JSON), но данные не проходят проверку
class ValidationError extends HttpError {
  constructor(errors) {
    super(422, 'Данные не прошли проверку', { type: '/problems/validation-error', errors });
  }
}

const unauthorized = (detail = 'Требуется вход в систему') =>
  new HttpError(401, detail, {
    type: '/problems/unauthorized',
    // RFC 9110: ответ 401 обязан содержать WWW-Authenticate
    headers: { 'WWW-Authenticate': 'Bearer realm="tasks-api"' },
  });

const forbidden = (detail = 'Недостаточно прав') => new HttpError(403, detail, { type: '/problems/forbidden' });

const tooManyRequests = (detail, retryAfterSec) =>
  new HttpError(429, detail, {
    type: '/problems/too-many-requests',
    headers: { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterSec))) },
  });

// 405 — путь существует, но метод не поддерживается; заголовок Allow обязателен (RFC 9110)
const methodNotAllowed = (allowed) => (req, res, next) =>
  next(new HttpError(405, `Метод ${req.method} не поддерживается для ${req.originalUrl.split('?')[0]}`, {
    headers: { Allow: allowed.join(', ') },
  }));

function notFound(req, res, next) {
  next(new HttpError(404, `Ресурс ${req.method} ${req.originalUrl} не найден`));
}

function errorHandler(err, req, res, next) {
  let e = err;

  if (!(e instanceof HttpError)) {
    if (err.type === 'entity.parse.failed') e = new HttpError(400, 'Тело запроса — некорректный JSON');
    else if (err.type === 'entity.too.large') e = new HttpError(413, 'Слишком большое тело запроса');
    else if (err.name === 'MulterError') {
      const map = {
        LIMIT_FILE_SIZE: [413, `Файл больше ${process.env.MAX_FILE_SIZE_MB || 10} МБ`],
        LIMIT_FILE_COUNT: [413, 'Не больше 5 файлов за раз'],
        LIMIT_UNEXPECTED_FILE: [400, 'Файлы нужно передавать в поле "files"'],
      };
      const [status, detail] = map[err.code] || [400, 'Ошибка загрузки файла'];
      e = new HttpError(status, detail);
    } else if (['ECONNREFUSED', '57P01', '57P03'].includes(err.code)) {
      // база недоступна — временная проблема на нашей стороне
      e = new HttpError(503, 'Сервис временно недоступен', { headers: { 'Retry-After': '10' } });
    } else {
      e = new HttpError(500, 'Внутренняя ошибка сервера');
    }
  }

  const log = req.log || logger;
  if (e.status >= 500) log.error({ err, event: 'http.error' }, err.message);
  else log.warn({ status: e.status, event: 'http.client_error', detail: e.detail }, e.detail);

  if (e.headers) res.set(e.headers);
  res
    .status(e.status)
    .type('application/problem+json')
    .json({
      type: e.type || 'about:blank',
      title: http.STATUS_CODES[e.status],
      status: e.status,
      detail: e.detail,
      instance: req.originalUrl,
      requestId: req.id,
      ...(e.errors && { errors: e.errors }),
    });
}

module.exports = {
  HttpError,
  ValidationError,
  unauthorized,
  forbidden,
  tooManyRequests,
  methodNotAllowed,
  notFound,
  errorHandler,
};
