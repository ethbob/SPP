// Пользователи: manager — только просмотр, admin — роли, блокировка, завершение сессий
import { useCallback, useEffect, useState } from 'react';
import { api, ROLES } from '../api.js';
import { useAuth } from '../components/Auth.jsx';
import RoleBadge from '../components/RoleBadge.jsx';
import ErrorBox from '../components/ErrorBox.jsx';
import { useToast } from '../components/Toasts.jsx';

export default function UsersPage() {
  const { user: me, can } = useAuth();
  const manage = can('users:manage');
  const toast = useToast();
  const [users, setUsers] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setUsers(await api.listUsers());
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function update(u, data, message) {
    try {
      const updated = await api.updateUser(u.id, data);
      setUsers((list) => list.map((x) => (x.id === u.id ? { ...x, ...updated, activeSessions: data.isActive === false ? 0 : x.activeSessions } : x)));
      toast.success(message);
    } catch (err) {
      toast.error(err);
    }
  }

  async function kick(u) {
    try {
      await api.revokeUserSessions(u.id);
      setUsers((list) => list.map((x) => (x.id === u.id ? { ...x, activeSessions: 0 } : x)));
      toast.success(`Сессии пользователя ${u.email} завершены`);
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <>
      <h1>Пользователи</h1>
      {!manage && <p className="link-muted">Роль «Менеджер» может только просматривать список. Менять роли может администратор.</p>}
      {error && <ErrorBox error={error} onRetry={load} />}
      {!users && !error && <div className="empty">Загрузка…</div>}
      {users && (
        <table className="tasks">
          <thead>
            <tr><th>Пользователь</th><th>Роль</th><th>Сессии</th><th>Состояние</th>{manage && <th />}</tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const self = u.id === me.id;
              return (
                <tr key={u.id} className={u.isActive ? '' : 'is-done'}>
                  <td>
                    <div className="task-title">{u.name}{self && ' (вы)'}</div>
                    <div className="task-desc">{u.email}</div>
                  </td>
                  <td>
                    {manage && !self ? (
                      <select className="small-select" value={u.role} aria-label="Роль"
                        onChange={(e) => update(u, { role: e.target.value }, `Роль ${u.email}: ${ROLES[e.target.value]}`)}>
                        {Object.entries(ROLES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                    ) : <RoleBadge role={u.role} />}
                  </td>
                  <td className="nowrap">{u.activeSessions}</td>
                  <td className="nowrap">
                    {!u.isActive ? <span className="overdue">заблокирован</span>
                      : u.lockedUntil ? <span className="overdue">вход заблокирован до {new Date(u.lockedUntil).toLocaleTimeString('ru-RU')}</span>
                        : 'активен'}
                  </td>
                  {manage && (
                    <td>
                      {!self && (
                        <div className="row-actions">
                          <button className="btn btn-small" disabled={!u.activeSessions} onClick={() => kick(u)}>Завершить сессии</button>
                          {u.isActive
                            ? <button className="btn btn-small btn-danger" onClick={() => update(u, { isActive: false }, `${u.email} заблокирован`)}>Заблокировать</button>
                            : <button className="btn btn-small" onClick={() => update(u, { isActive: true }, `${u.email} разблокирован`)}>Разблокировать</button>}
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
