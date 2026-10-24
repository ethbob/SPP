import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorText } from '../api.js';
import { AuthCard, Field } from './AuthForm.jsx';

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      await api.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setErrors(err.errors || {});
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <AuthCard title="Пароль изменён">
        <div className="alert alert-ok">Новый пароль сохранён. Все прежние сессии завершены.</div>
        <p><Link className="btn btn-primary" to="/login">Войти</Link></p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Новый пароль">
      {!token && <div className="alert">В ссылке нет токена. Откройте ссылку из письма целиком.</div>}
      {error && (
        <div className="alert">
          {errorText(error)} {[400, 410].includes(error.status) && <Link to="/forgot-password">Запросить новую ссылку</Link>}
        </div>
      )}
      <form className="form" onSubmit={submit} noValidate>
        <Field id="password" label="Новый пароль" type="password" autoComplete="new-password" value={password}
          onChange={(e) => setPassword(e.target.value)} error={errors.password} autoFocus />
        <div className="actions">
          <button className="btn btn-primary" type="submit" disabled={busy || !token}>Сохранить</button>
        </div>
      </form>
    </AuthCard>
  );
}
