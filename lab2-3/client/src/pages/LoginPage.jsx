import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { errorText } from '../api.js';
import { useAuth } from '../components/Auth.jsx';
import { AuthCard, Field } from './AuthForm.jsx';

const DEMO = [
  ['admin@example.com', 'Admin12345', 'Администратор'],
  ['manager@example.com', 'Manager12345', 'Менеджер'],
  ['user@example.com', 'User12345', 'Пользователь'],
];

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={location.state?.from || '/'} replace />;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      await login(email, password);
      navigate(location.state?.from || '/', { replace: true });
    } catch (err) {
      setErrors(err.errors || {});
      if (!err.errors) setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Вход">
      {error && (
        <div className={`alert ${error.status === 429 ? 'alert-warn' : ''}`}>
          {errorText(error)}
          {error.status === 429 && <> <Link to="/forgot-password">Восстановить пароль</Link></>}
        </div>
      )}
      <form className="form" onSubmit={submit} noValidate>
        <Field id="email" label="Email" type="email" autoComplete="username" value={email}
          onChange={(e) => setEmail(e.target.value)} error={errors.email} autoFocus />
        <Field id="password" label="Пароль" type="password" autoComplete="current-password" value={password}
          onChange={(e) => setPassword(e.target.value)} error={errors.password} />
        <div className="actions">
          <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Вход…' : 'Войти'}</button>
          <Link to="/forgot-password" className="link-muted">Забыли пароль?</Link>
        </div>
      </form>
      <p className="hint">Нет аккаунта? <Link to="/register">Зарегистрироваться</Link></p>
      <details className="demo">
        <summary>Демо-аккаунты</summary>
        <ul>
          {DEMO.map(([e, p, r]) => (
            <li key={e}>
              <button type="button" className="btn btn-small" onClick={() => { setEmail(e); setPassword(p); }}>{r}</button>
              <code>{e}</code> / <code>{p}</code>
            </li>
          ))}
        </ul>
      </details>
    </AuthCard>
  );
}
