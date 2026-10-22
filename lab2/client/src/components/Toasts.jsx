// Всплывающие уведомления: успех и ошибки API.
import { createContext, useCallback, useContext, useState } from 'react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const remove = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const push = useCallback((type, text) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t.slice(-2), { id, type, text }]); // на экране не больше трёх
    setTimeout(() => remove(id), type === 'error' ? 6000 : 3000);
  }, [remove]);

  const value = {
    success: (text) => push('success', text),
    // принимает ApiError или строку; показывает код ответа сервера
    error: (err) => push('error', typeof err === 'string' ? err : `${err.status ? `${err.status}: ` : ''}${err.message}`),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`} onClick={() => remove(t.id)}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
