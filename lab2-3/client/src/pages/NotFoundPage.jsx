import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="empty">
      <h1>404</h1>
      <p>Такой страницы нет.</p>
      <p><Link to="/">К списку задач</Link></p>
    </div>
  );
}
