import { STATUSES } from '../api.js';

export default function StatusSelect({ value, onChange, disabled, ...rest }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} {...rest}>
      {Object.entries(STATUSES).map(([key, label]) => (
        <option key={key} value={key}>{label}</option>
      ))}
    </select>
  );
}
