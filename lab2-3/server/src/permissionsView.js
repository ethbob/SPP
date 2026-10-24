// Список разрешений роли — клиенту, чтобы прятать недоступные кнопки
const { PERMISSIONS } = require('./permissions');

const permissionsOf = (role) => [...(PERMISSIONS[role] || [])];

module.exports = { permissionsOf };
