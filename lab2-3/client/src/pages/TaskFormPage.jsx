// Форма создания (POST) и редактирования (PUT) задачи.
// Ошибки проверки приходят с сервера в details и показываются под полями.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import StatusSelect from '../components/StatusSelect.jsx';
import ErrorBox from '../components/ErrorBox.jsx';
import { useToast } from '../components/Toasts.jsx';

const empty = { title: '', description: '', status: 'todo', dueDate: '' };

export default function TaskFormPage() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState(isNew ? empty : null);
  const [files, setFiles] = useState([]);
  const [errors, setErrors] = useState({});
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isNew) {
      setForm(empty);
      return;
    }
    api.getTask(id)
      .then((t) => setForm({ title: t.title, description: t.description, status: t.status, dueDate: t.dueDate || '' }))
      .catch(setLoadError);
  }, [id, isNew]);

  const set = (field) => (value) => setForm((f) => ({ ...f, [field]: value }));

  async function submit(e) {
    e.preventDefault();
    setErrors({});
    setSaving(true);
    const data = { ...form, dueDate: form.dueDate || null };
    try {
      const task = isNew ? await api.createTask(data) : await api.replaceTask(id, data);
      if (isNew && files.length) {
        try {
          await api.uploadFiles(task.id, files);
        } catch (err) {
          toast.error(`Задача создана, но файлы не загрузились — ${err.message}`);
        }
      }
      toast.success(isNew ? 'Задача создана' : 'Изменения сохранены');
      navigate(`/tasks/${task.id}`);
    } catch (err) {
      if (err.errors) setErrors(err.errors);
      toast.error(err);
    } finally {
      setSaving(false);
    }
  }

  const back = isNew ? '/' : `/tasks/${id}`;

  if (loadError) {
    return (
      <>
        <p><Link className="link-muted" to="/">← Все задачи</Link></p>
        <ErrorBox error={loadError} />
      </>
    );
  }
  if (!form) return <div className="empty">Загрузка…</div>;

  return (
    <>
      <p><Link className="link-muted" to={back}>← Назад</Link></p>
      <h1>{isNew ? 'Новая задача' : 'Редактирование задачи'}</h1>

      {Object.keys(errors).length > 0 && <div className="alert">Проверьте поля формы.</div>}

      {/* noValidate: проверку делает сервер, а мы показываем его ответ */}
      <form className="card form" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="title">Название *</label>
          <input id="title" value={form.title} onChange={(e) => set('title')(e.target.value)}
            className={errors.title ? 'invalid' : ''} autoFocus />
          {errors.title && <div className="error">{errors.title}</div>}
        </div>

        <div className="field">
          <label htmlFor="description">Описание</label>
          <textarea id="description" rows={4} value={form.description}
            onChange={(e) => set('description')(e.target.value)} className={errors.description ? 'invalid' : ''} />
          {errors.description && <div className="error">{errors.description}</div>}
        </div>

        <div className="row">
          <div className="field">
            <label htmlFor="status">Статус</label>
            <StatusSelect id="status" value={form.status} onChange={set('status')} />
            {errors.status && <div className="error">{errors.status}</div>}
          </div>
          <div className="field">
            <label htmlFor="dueDate">Ожидаемая дата завершения</label>
            <input id="dueDate" type="date" value={form.dueDate} onChange={(e) => set('dueDate')(e.target.value)}
              className={errors.dueDate ? 'invalid' : ''} />
            {errors.dueDate && <div className="error">{errors.dueDate}</div>}
          </div>
        </div>

        {isNew && (
          <div className="field">
            <label htmlFor="files">Файлы</label>
            <input id="files" type="file" multiple onChange={(e) => setFiles([...e.target.files])} />
            <div className="hint">Загрузятся отдельным запросом (multipart/form-data) сразу после создания задачи.</div>
          </div>
        )}

        <div className="actions">
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? 'Сохранение…' : isNew ? 'Создать' : 'Сохранить'}
          </button>
          <Link className="btn btn-ghost" to={back}>Отмена</Link>
        </div>
      </form>
    </>
  );
}
