import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorText } from '../api.js';
import { AuthCard, Field } from './AuthForm.jsx';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      const res = await api.forgotPassword(email);
      setDone(res.detail);
    } catch (err) {
      setErrors(err.errors || {});
      if (!err.errors) setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Восстановление доступа">
      {done ? (
        <>
          <div className="alert alert-ok">{done}</div>
          <p className="hint">В Docker письма приходят в Mailpit: <a href="http://localhost:8025" target="_blank" rel="noreferrer">localhost:8025</a></p>
          <p><Link to="/login">Вернуться ко входу</Link></p>
        </>
      ) : (
        <>
          {error && <div className="alert">{errorText(error)}</div>}
          <form className="form" onSubmit={submit} noValidate>
            <Field id="email" label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} autoFocus />
            <div className="actions">
              <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Отправка…' : 'Отправить ссылку'}</button>
              <Link to="/login" className="link-muted">Назад</Link>
            </div>
          </form>
        </>
      )}
    </AuthCard>
  );
}
