import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { errorText } from '../api.js';
import { useAuth } from '../components/Auth.jsx';
import { AuthCard, Field } from './AuthForm.jsx';

export default function RegisterPage() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      await register(form);
      navigate('/', { replace: true });
    } catch (err) {
      setErrors(err.errors || {});
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Регистрация">
      {error && <div className="alert">{errorText(error)}</div>}
      <form className="form" onSubmit={submit} noValidate>
        <Field id="name" label="Имя" value={form.name} onChange={set('name')} error={errors.name} autoFocus />
        <Field id="email" label="Email" type="email" autoComplete="username" value={form.email} onChange={set('email')} error={errors.email} />
        <Field id="password" label="Пароль" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} error={errors.password} />
        <div className="hint">Не короче 8 символов, буквы и цифры. Новый пользователь получает роль «Пользователь».</div>
        <div className="actions">
          <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Создание…' : 'Зарегистрироваться'}</button>
        </div>
      </form>
      <p className="hint">Уже есть аккаунт? <Link to="/login">Войти</Link></p>
    </AuthCard>
  );
}
