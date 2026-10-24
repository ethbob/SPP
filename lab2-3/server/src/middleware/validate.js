const { HttpError } = require('./errors');

// :id должен быть положительным целым числом
function parseId(name) {
  return (req, res, next, value) => {
    if (!/^[1-9]\d{0,9}$/.test(value)) {
      return next(new HttpError(400, `Параметр ${name} должен быть положительным целым числом`));
    }
    req.resourceId = Number(value); // не req.id — там id запроса для логов
    next();
  };
}

// Для POST/PUT/PATCH с JSON требуем Content-Type: application/json
function requireJson(req, res, next) {
  if (!req.is('application/json')) {
    return next(new HttpError(415, 'Ожидается Content-Type: application/json', { headers: { 'Accept-Post': 'application/json' } }));
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

// Разрешены только перечисленные поля
function onlyFields(body, allowed, errors) {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) errors[key] = 'Неизвестное поле';
  }
}

module.exports = { parseId, requireJson, requireMultipart, onlyFields };
