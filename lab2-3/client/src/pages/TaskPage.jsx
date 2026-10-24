// Страница задачи: детали, смена статуса, удаление, файлы.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { formatDate, formatSize } from '../format.js';
import StatusBadge from '../components/StatusBadge.jsx';
import StatusSelect from '../components/StatusSelect.jsx';
import ErrorBox from '../components/ErrorBox.jsx';
import { useToast } from '../components/Toasts.jsx';
import { useAuth } from '../components/Auth.jsx';

export default function TaskPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [task, setTask] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const fileInput = useRef(null);
  const { user, can } = useAuth();

  const load = useCallback(async () => {
    setError(null);
    try {
      setTask(await api.getTask(id));
    } catch (err) {
      setError(err);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function changeStatus(status) {
    setBusy(true);
    try {
      setTask(await api.patchTask(id, { status }));
      toast.success('Статус изменён');
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm('Удалить задачу вместе с файлами?')) return;
    try {
      await api.deleteTask(id);
      toast.success('Задача удалена');
      navigate('/');
    } catch (err) {
      toast.error(err);
    }
  }

  async function upload(e) {
    e.preventDefault(); // не даём форме отправиться обычным способом и перезагрузить страницу
    const files = [...fileInput.current.files];
    if (files.length === 0) {
      setUploadError('Выберите хотя бы один файл');
      return;
    }
    setBusy(true);
    setUploadError(null);
    try {
      const added = await api.uploadFiles(id, files);
      setTask((t) => ({ ...t, attachments: [...t.attachments, ...added] }));
      fileInput.current.value = '';
      toast.success(added.length > 1 ? `Загружено файлов: ${added.length}` : 'Файл загружен');
    } catch (err) {
      setUploadError(`${err.status ? `${err.status}: ` : ''}${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function removeFile(file) {
    try {
      await api.deleteAttachment(file.id);
      setTask((t) => ({ ...t, attachments: t.attachments.filter((a) => a.id !== file.id) }));
      toast.success(`Файл «${file.name}» удалён`);
    } catch (err) {
      toast.error(err);
    }
  }

  if (error) {
    return (
      <>
        <p><Link className="link-muted" to="/">← Все задачи</Link></p>
        {[403, 404].includes(error.status)
          ? <div className="empty"><h1>{error.status}</h1><p>{error.message}</p></div>
          : <ErrorBox error={error} onRetry={load} />}
      </>
    );
  }
  if (!task) return <div className="empty">Загрузка…</div>;

  // Кнопки показываем по правам; сервер всё равно проверяет их сам
  const own = task.ownerId === user.id;
  const canEdit = own || can('tasks:update:any');
  const canDelete = own ? can('tasks:delete:own') : can('tasks:delete:any');

  async function download(file) {
    try {
      await api.downloadFile(file);
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <>
      <p><Link className="link-muted" to="/">← Все задачи</Link></p>

      <div className="task-head">
        <h1>{task.title}</h1>
        <StatusBadge status={task.status} />
      </div>

      <div className="card">
        <dl className="meta">
          <dt>Срок</dt>
          <dd className={task.overdue ? 'overdue' : ''}>
            {task.dueDate ? formatDate(task.dueDate) : 'не указан'}
            {task.overdue && ' · просрочена'}
          </dd>
          <dt>Владелец</dt>
          <dd>{task.owner ? `${task.owner.name} (${task.owner.email})` : '—'}{own && ' — вы'}</dd>
          <dt>Создана</dt>
          <dd>{new Date(task.createdAt).toLocaleString('ru-RU')}</dd>
        </dl>

        {task.description
          ? <div className="description">{task.description}</div>
          : <p className="link-muted">Описания нет.</p>}

        <div className="actions">
          <StatusSelect value={task.status} onChange={changeStatus} disabled={busy || !canEdit} aria-label="Статус задачи" />
          {canEdit && <Link className="btn" to={`/tasks/${task.id}/edit`}>Редактировать</Link>}
          {canDelete && <button className="btn btn-danger" onClick={remove}>Удалить</button>}
          {!canEdit && <span className="link-muted">Только просмотр</span>}
        </div>
      </div>

      <h2>Файлы</h2>
      <div className="card">
        {task.attachments.length === 0 ? (
          <p className="link-muted">Файлов пока нет.</p>
        ) : (
          <ul className="files">
            {task.attachments.map((a) => (
              <li key={a.id}>
                <button className="link-btn" onClick={() => download(a)}>{a.name}</button>
                <span className="link-muted">{formatSize(a.size)}</span>
                {canEdit && <button className="btn btn-small btn-ghost" title="Удалить файл" onClick={() => removeFile(a)}>✕</button>}
              </li>
            ))}
          </ul>
        )}

        {canEdit && (<>
        <form className="upload" onSubmit={upload}>
          <input type="file" ref={fileInput} multiple />
          <button className="btn" type="submit" disabled={busy}>{busy ? 'Загрузка…' : 'Загрузить'}</button>
        </form>
        <div className="hint">До 5 файлов за раз, каждый не больше 10 МБ.</div>
        {uploadError && <div className="error">{uploadError}</div>}
        </>)}
      </div>
    </>
  );
}
