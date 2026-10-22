const { HttpError } = require('./errors');

// :id и :attachmentId должны быть положительными целыми числами
function parseId(name) {
  return (req, res, next, value) => {
    if (!/^[1-9]\d{0,9}$/.test(value)) {
      return next(new HttpError(400, `Параметр ${name} должен быть положительным целым числом`));
    }
    req[name] = Number(value);
    next();
  };
}

// Для POST/PUT/PATCH с JSON требуем Content-Type: application/json
function requireJson(req, res, next) {
  if (!req.is('application/json')) {
    return next(new HttpError(415, 'Ожидается Content-Type: application/json'));
  }
  if (req.body === null || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return next(new HttpError(400, 'Тело запроса должно быть JSON-объектом'));
  }
  next();
}

function requireMultipart(req, res, next) {
  if (!req.is('multipart/form-data')) {
    return next(new HttpError(415, 'Ожидается Content-Type: multipart/form-data'));
  }
  next();
}

module.exports = { parseId, requireJson, requireMultipart };
