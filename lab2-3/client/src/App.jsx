// Маршрутизация на клиенте. Страницы задач, сессий и пользователей — только после входа.
import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { useAuth } from './components/Auth.jsx';
import RequireAuth from './components/RequireAuth.jsx';
import RoleBadge from './components/RoleBadge.jsx';
import TaskListPage from './pages/TaskListPage.jsx';
import TaskPage from './pages/TaskPage.jsx';
import TaskFormPage from './pages/TaskFormPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import ForgotPasswordPage from './pages/ForgotPasswordPage.jsx';
import ResetPasswordPage from './pages/ResetPasswordPage.jsx';
import SessionsPage from './pages/SessionsPage.jsx';
import UsersPage from './pages/UsersPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';

function Header() {
  const { user, can, logout } = useAuth();
  return (
    <header className="topbar">
      <div className="wrap topbar-inner">
        <nav className="nav">
          <Link className="brand" to="/">Задачи</Link>
          {user && <NavLink to="/sessions">Сессии</NavLink>}
          {user && can('users:read') && <NavLink to="/users">Пользователи</NavLink>}
        </nav>
        {user && (
          <div className="nav">
            <span className="whoami">{user.name} <RoleBadge role={user.role} /></span>
            <Link className="btn btn-primary" to="/tasks/new">+ Задача</Link>
            <button className="btn btn-ghost" onClick={logout}>Выйти</button>
          </div>
        )}
      </div>
    </header>
  );
}

const guard = (el, permission) => <RequireAuth permission={permission}>{el}</RequireAuth>;

export default function App() {
  return (
    <>
      <Header />
      <main className="wrap">
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/" element={guard(<TaskListPage />)} />
          <Route path="/tasks/new" element={guard(<TaskFormPage />, 'tasks:create')} />
          <Route path="/tasks/:id" element={guard(<TaskPage />)} />
          <Route path="/tasks/:id/edit" element={guard(<TaskFormPage />)} />
          <Route path="/sessions" element={guard(<SessionsPage />)} />
          <Route path="/users" element={guard(<UsersPage />, 'users:read')} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
    </>
  );
}
