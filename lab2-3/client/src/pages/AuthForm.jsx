// Общая обёртка для страниц входа/регистрации/восстановления
export function AuthCard({ title, children }) {
  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  );
}

export function Field({ id, label, error, ...props }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} className={error ? 'invalid' : ''} {...props} />
      {error && <div className="error">{error}</div>}
    </div>
  );
}
