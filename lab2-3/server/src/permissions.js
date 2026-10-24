// Модель доступа: роль → набор разрешений.
// Проверки в коде всегда идут через разрешения, а не через имена ролей,
// поэтому права ролей меняются в одном месте.
const PERMISSIONS = {
  user: [
    'tasks:create',
    'tasks:read:own',
    'tasks:update:own',
    'tasks:delete:own',
  ],
  manager: [
    'tasks:create',
    'tasks:read:own',
    'tasks:update:own',
    'tasks:delete:own',
    'tasks:read:any', //   видит задачи всех пользователей
    'tasks:update:any', // может менять чужие задачи (статус, срок, файлы)
    'users:read', //       видит список пользователей
  ],
  admin: [
    'tasks:create',
    'tasks:read:own',
    'tasks:update:own',
    'tasks:delete:own',
    'tasks:read:any',
    'tasks:update:any',
    'tasks:delete:any', // может удалять чужие задачи
    'users:read',
    'users:manage', //     меняет роли, блокирует пользователей, завершает их сессии
  ],
};

const ROLES = Object.keys(PERMISSIONS);

const can = (role, permission) => Boolean(PERMISSIONS[role]?.includes(permission));

module.exports = { PERMISSIONS, ROLES, can };
