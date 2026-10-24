import { ROLES } from '../api.js';

export default function RoleBadge({ role }) {
  return <span className={`badge role-${role}`}>{ROLES[role] || role}</span>;
}
