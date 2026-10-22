// Единый формат ошибок API:
// { "error": { "status": 400, "message": "...", "details": { поле: "что не так" } } }

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

class ValidationError extends HttpError {
  constructor(details) {
    super(400, 'Данные не прошли проверку', details);
  }
}

// Неизвестный адрес внутри /api
function notFound(req, res, next) {
  next(new HttpError(404, `Ресурс ${req.method} ${req.originalUrl} не найден`));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = 500;
  let message = 'Внутренняя ошибка сервера';
  let details;

  if (err instanceof HttpError) {
    ({ status, message, details } = err);
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'Тело запроса — некорректный JSON';
  } else if (err.type === 'entity.too.large') {
    status = 413;
    message = 'Слишком большое тело запроса';
  } else if (err.name === 'MulterError') {
    const multerErrors = {
      LIMIT_FILE_SIZE: [413, `Файл больше ${process.env.MAX_FILE_SIZE_MB || 10} МБ`],
      LIMIT_FILE_COUNT: [400, 'Не больше 5 файлов за раз'],
      LIMIT_UNEXPECTED_FILE: [400, 'Файлы нужно передавать в поле "files"'],
    };
    [status, message] = multerErrors[err.code] || [400, 'Ошибка загрузки файла'];
  }

  if (status >= 500) console.error(err);
  res.status(status).json({ error: { status, message, ...(details && { details }) } });
}

module.exports = { HttpError, ValidationError, notFound, errorHandler };
