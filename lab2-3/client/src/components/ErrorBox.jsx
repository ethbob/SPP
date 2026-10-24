// Блок ошибки загрузки страницы с кнопкой «Повторить»
import { errorText } from '../api.js';

export default function ErrorBox({ error, onRetry }) {
  return (
    <div className="alert">
      <span>{errorText(error)}</span>
      {onRetry && <button className="btn btn-small" onClick={onRetry}>Повторить</button>}
    </div>
  );
}
