// Контроль активных подключений: где выполнен вход, завершение сессий
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import ErrorBox from '../components/ErrorBox.jsx';
import { useToast } from '../components/Toasts.jsx';

// Грубое определение браузера и системы по User-Agent
function device(ua = '') {
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : /curl/.test(ua) ? 'curl' : 'Неизвестный клиент';
  const os = /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android'
    : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser}, ${os}` : browser;
}

const fmt = (d) => new Date(d).toLocaleString('ru-RU');

export default function SessionsPage() {
  const toast = useToast();
  const [sessions, setSessions] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setSessions(await api.sessions());
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function revoke(s) {
    try {
      await api.revokeSession(s.id);
      setSessions((list) => list.filter((x) => x.id !== s.id));
      toast.success('Сессия завершена');
    } catch (err) {
      toast.error(err);
    }
  }

  async function revokeOthers() {
    try {
      await api.revokeOtherSessions();
      setSessions((list) => list.filter((x) => x.current));
      toast.success('Все другие сессии завершены');
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <>
      <h1>Активные сессии</h1>
      <p className="link-muted">
        Каждая сессия — это вход с отдельного устройства или браузера. Завершённая сессия перестаёт работать сразу.
      </p>
      {error && <ErrorBox error={error} onRetry={load} />}
      {!sessions && !error && <div className="empty">Загрузка…</div>}
      {sessions && (
        <>
          <table className="tasks">
            <thead>
              <tr><th>Устройство</th><th>IP</th><th>Вход</th><th>Активность</th><th /></tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td>
                    {device(s.userAgent)}
                    {s.current && <span className="badge badge-done badge-inline">текущая</span>}
                  </td>
                  <td className="nowrap">{s.ip || '—'}</td>
                  <td className="nowrap">{fmt(s.createdAt)}</td>
                  <td className="nowrap">{fmt(s.lastUsedAt)}</td>
                  <td>{!s.current && <button className="btn btn-small btn-danger" onClick={() => revoke(s)}>Завершить</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {sessions.length > 1 && (
            <div className="actions">
              <button className="btn btn-danger" onClick={revokeOthers}>Завершить все, кроме текущей</button>
            </div>
          )}
        </>
      )}
    </>
  );
}
