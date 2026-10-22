// Блок ошибки загрузки страницы с кнопкой «Повторить»
export default function ErrorBox({ error, onRetry }) {
  return (
    <div className="alert">
      <strong>{error.status ? `Ошибка ${error.status}` : 'Ошибка'}:</strong> {error.message}
      {onRetry && <button className="btn btn-small" onClick={onRetry}>Повторить</button>}
    </div>
  );
}
