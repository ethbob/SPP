// Все запросы к REST API в одном месте. Компоненты не знают про fetch и URL.

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status; // HTTP-код ответа (0 — сервер недоступен)
    this.details = details; // ошибки по полям: { title: '...', dueDate: '...' }
  }
}

async function request(method, url, { json, formData } = {}) {
  const options = { method, headers: { Accept: 'application/json' } };
  if (json !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(json);
  } else if (formData) {
    options.body = formData; // Content-Type с boundary браузер выставит сам
  }

  let res;
  try {
    res = await fetch(url, options);
  } catch {
    throw new ApiError(0, 'Сервер недоступен. Проверьте, что API запущен.');
  }

  if (res.status === 204) return null;

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await res.json() : null;

  if (!res.ok) {
    // 502/503/504 без JSON — это ответ прокси (nginx/vite), а не нашего API: API не запущен
    if (!body && [502, 503, 504].includes(res.status)) {
      throw new ApiError(res.status, 'Сервер API недоступен. Попробуйте позже.');
    }
    const err = body?.error;
    throw new ApiError(res.status, err?.message || `Ошибка ${res.status}`, err?.details);
  }
  return body;
}

export const api = {
  listTasks: (status) => request('GET', `/api/tasks${status ? `?status=${encodeURIComponent(status)}` : ''}`),
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
  deleteAttachment: (id) => request('DELETE', `/api/attachments/${id}`),
};

export const STATUSES = {
  todo: 'Нужно сделать',
  in_progress: 'В работе',
  done: 'Выполнено',
};
