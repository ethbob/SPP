// Защищённый маршрут: без входа — на страницу входа, без прав — сообщение 403
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './Auth.jsx';

export default function RequireAuth({ permission, children }) {
  const { user, ready, can, signedOut } = useAuth();
  const location = useLocation();

  if (!ready) return <div className="empty">Загрузка…</div>;
  // сессия истекла → после входа вернём на ту же страницу; сам вышел → просто на вход
  if (!user) return <Navigate to="/login" replace state={signedOut ? undefined : { from: location.pathname + location.search }} />;
  if (permission && !can(permission)) {
    return (
      <div className="empty">
        <h1>403</h1>
        <p>У вашей роли нет доступа к этой странице.</p>
      </div>
    );
  }
  return children;
}
