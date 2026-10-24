const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/', 'uploads/'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { sourceType: 'commonjs', ecmaVersion: 2023, globals: globals.node },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_|^next$|^req$|^res$' }],
    },
  },
];
