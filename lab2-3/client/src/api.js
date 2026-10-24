// Все запросы к REST API в одном месте.
// Access-токен хранится только в памяти (не в localStorage — так его не украсть через XSS).
// Refresh-токен лежит в httpOnly-cookie, браузер отправляет его сам.

export class ApiError extends Error {
  constructor(status, message, { errors, retryAfter, requestId } = {}) {
    super(message);
    this.status = status; // HTTP-код (0 — сервер недоступен)
    this.errors = errors; // ошибки по полям: { title: '...', email: '...' }
    this.retryAfter = retryAfter; // секунды из заголовка Retry-After (для 429/503)
    this.requestId = requestId; // id запроса — по нему ошибку легко найти в логах сервера
  }
}

let accessToken = null;
let onAuthLost = () => {};
let refreshing = null;

export const setAccessToken = (token) => {
  accessToken = token;
};
export const setOnAuthLost = (fn) => {
  onAuthLost = fn;
};

// Получить новый access-токен по refresh-cookie. Параллельные вызовы ждут один запрос.
export function refreshSession() {
  if (!refreshing) {
    refreshing = fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' })
      .then(async (res) => {
        if (!res.ok) return null;
        const data = await res.json();
        accessToken = data.accessToken;
        return data.user;
      })
      .catch(() => null)
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

async function request(method, url, { json, formData, raw = false, retry = true } = {}) {
  const headers = { Accept: 'application/json' };
  const options = { method, headers, credentials: 'same-origin' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(json);
  } else if (formData) {
    options.body = formData; // Content-Type с boundary браузер выставит сам
  }

  let res;
  try {
    res = await fetch(url, options);
  } catch {
    throw new ApiError(0, 'Сервер недоступен. Проверьте подключение.');
  }

  // 401: access-токен истёк — тихо обновляем его и повторяем запрос один раз
  if (res.status === 401 && retry && !url.startsWith('/api/auth/')) {
    const user = await refreshSession();
    if (user) return request(method, url, { json, formData, raw, retry: false });
    onAuthLost();
  }

  if (res.ok && raw) return res;
  if (res.status === 204) return null;

  const type = res.headers.get('content-type') || '';
  const body = type.includes('json') ? await res.json() : null;

  if (!res.ok) {
    const retryAfter = Number(res.headers.get('retry-after')) || undefined;
    if (!body && [502, 503, 504].includes(res.status)) {
      throw new ApiError(res.status, 'Сервер API недоступен. Попробуйте позже.', { retryAfter });
    }
    // тело ошибки — Problem Details (RFC 9457): { title, status, detail, errors, requestId }
    throw new ApiError(res.status, body?.detail || body?.title || `Ошибка ${res.status}`, {
      errors: body?.errors,
      retryAfter,
      requestId: body?.requestId,
    });
  }
  return body;
}

// Скачивание файла: обычная ссылка не передаст заголовок Authorization,
// поэтому получаем файл через fetch и сохраняем из памяти
async function download(url, filename) {
  const res = await request('GET', url, { raw: true });
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export const api = {
  // авторизация
  login: (email, password) => request('POST', '/api/auth/login', { json: { email, password } }),
  register: (data) => request('POST', '/api/auth/register', { json: data }),
  logout: () => request('POST', '/api/auth/logout'),
  me: () => request('GET', '/api/auth/me'),
  forgotPassword: (email) => request('POST', '/api/auth/forgot-password', { json: { email } }),
  resetPassword: (token, password) => request('POST', '/api/auth/reset-password', { json: { token, password } }),
  sessions: () => request('GET', '/api/auth/sessions'),
  revokeSession: (id) => request('DELETE', `/api/auth/sessions/${id}`),
  revokeOtherSessions: () => request('DELETE', '/api/auth/sessions'),

  // пользователи (manager — просмотр, admin — управление)
  listUsers: () => request('GET', '/api/users'),
  updateUser: (id, data) => request('PATCH', `/api/users/${id}`, { json: data }),
  revokeUserSessions: (id) => request('DELETE', `/api/users/${id}/sessions`),

  // задачи
  listTasks: ({ status, scope } = {}) => {
    const q = new URLSearchParams();
    if (status) q.set('status', status);
    if (scope) q.set('scope', scope);
    return request('GET', `/api/tasks${q.size ? `?${q}` : ''}`);
  },
  getTask: (id) => request('GET', `/api/tasks/${id}`),
  createTask: (data) => request('POST', '/api/tasks', { json: data }),
  replaceTask: (id, data) => request('PUT', `/api/tasks/${id}`, { json: data }),
  patchTask: (id, data) => request('PATCH', `/api/tasks/${id}`, { json: data }),
  deleteTask: (id) => request('DELETE', `/api/tasks/${id}`),
  uploadFiles: (id, files) => {
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    return request('POST', `/api/tasks/${id}/attachments`, { formData: fd });
  },
  downloadFile: (file) => download(file.url, file.name),
  deleteAttachment: (id) => request('DELETE', `/api/attachments/${id}`),
};

export const STATUSES = {
  todo: 'Нужно сделать',
  in_progress: 'В работе',
  done: 'Выполнено',
};

export const ROLES = {
  user: 'Пользователь',
  manager: 'Менеджер',
  admin: 'Администратор',
};

// Текст ошибки для уведомления: код + описание (+ когда повторить)
export function errorText(err) {
  if (typeof err === 'string') return err;
  let text = `${err.status ? `${err.status}: ` : ''}${err.message}`;
  if (err.status === 429 && err.retryAfter && !/мин\./.test(err.message)) text += ` Повторите через ${err.retryAfter} с.`;
  return text;
}
