// Список задач. Фильтр хранится в адресе (?status=done), данные грузятся через fetch —
// при смене фильтра или статуса страница не перезагружается, меняется только таблица.
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, STATUSES } from '../api.js';
import { formatDate } from '../format.js';
import StatusSelect from '../components/StatusSelect.jsx';
import ErrorBox from '../components/ErrorBox.jsx';
import { useToast } from '../components/Toasts.jsx';

export default function TaskListPage() {
  const [params, setParams] = useSearchParams();
  const status = STATUSES[params.get('status')] ? params.get('status') : '';
  const [tasks, setTasks] = useState(null);
  const [error, setError] = useState(null);
  const [savingId, setSavingId] = useState(null);
  const toast = useToast();

  const load = useCallback(async () => {
    setError(null);
    try {
      setTasks(await api.listTasks(status));
    } catch (err) {
      setError(err);
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  function changeFilter(value) {
    setParams(value ? { status: value } : {});
  }

  async function changeStatus(task, newStatus) {
    setSavingId(task.id);
    try {
      const updated = await api.patchTask(task.id, { status: newStatus });
      setTasks((list) =>
        list
          .map((t) => (t.id === task.id ? { ...t, ...updated } : t))
          .filter((t) => !status || t.status === status), // задача ушла из текущего фильтра
      );
      toast.success(`Статус «${updated.title}»: ${STATUSES[newStatus]}`);
    } catch (err) {
      toast.error(err);
    } finally {
      setSavingId(null);
    }
  }

  return (
    <>
      <h1>Список задач</h1>

      <div className="filter">
        <label htmlFor="status-filter">Статус:</label>
        <select id="status-filter" value={status} onChange={(e) => changeFilter(e.target.value)}>
          <option value="">Все</option>
          {Object.entries(STATUSES).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        {status && <button className="btn btn-ghost" onClick={() => changeFilter('')}>Сбросить</button>}
      </div>

      {error && <ErrorBox error={error} onRetry={load} />}

      {!error && tasks === null && <div className="empty">Загрузка…</div>}

      {tasks && tasks.length === 0 && (
        <div className="empty">
          {status ? `Задач со статусом «${STATUSES[status]}» нет.` : <>Задач пока нет. <Link to="/tasks/new">Создайте первую</Link>.</>}
        </div>
      )}

      {tasks && tasks.length > 0 && (
        <table className="tasks">
          <thead>
            <tr>
              <th>Задача</th>
              <th>Срок</th>
              <th>Файлы</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr key={task.id} className={task.status === 'done' ? 'is-done' : ''}>
                <td>
                  <Link className="task-title" to={`/tasks/${task.id}`}>{task.title}</Link>
                  {task.description && (
                    <div className="task-desc">
                      {task.description.length > 90 ? `${task.description.slice(0, 90)}…` : task.description}
                    </div>
                  )}
                </td>
                <td className={`nowrap ${task.overdue ? 'overdue' : ''}`}>
                  {task.dueDate ? formatDate(task.dueDate) : '—'}
                  {task.overdue && <div className="overdue-note">просрочена</div>}
                </td>
                <td className="nowrap">{task.attachmentsCount || '—'}</td>
                <td>
                  <StatusSelect
                    className="small-select"
                    aria-label="Статус задачи"
                    value={task.status}
                    disabled={savingId === task.id}
                    onChange={(v) => changeStatus(task, v)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
