import { STATUSES } from '../api.js';

export default function StatusBadge({ status }) {
  return <span className={`badge badge-${status}`}>{STATUSES[status]}</span>;
}
