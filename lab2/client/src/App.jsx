// Маршрутизация на клиенте: адрес в браузере меняется, но страница не перезагружается —
// React Router просто показывает другой компонент.
import { Link, Route, Routes } from 'react-router-dom';
import TaskListPage from './pages/TaskListPage.jsx';
import TaskPage from './pages/TaskPage.jsx';
import TaskFormPage from './pages/TaskFormPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';

export default function App() {
  return (
    <>
      <header className="topbar">
        <div className="wrap topbar-inner">
          <Link className="brand" to="/">Задачи</Link>
          <Link className="btn btn-primary" to="/tasks/new">+ Новая задача</Link>
        </div>
      </header>
      <main className="wrap">
        <Routes>
          <Route path="/" element={<TaskListPage />} />
          <Route path="/tasks/new" element={<TaskFormPage />} />
          <Route path="/tasks/:id" element={<TaskPage />} />
          <Route path="/tasks/:id/edit" element={<TaskFormPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
    </>
  );
}
