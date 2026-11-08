const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js', 'test/**/*.js', 'eslint.config.js'],
    languageOptions: { sourceType: 'commonjs', ecmaVersion: 2023, globals: globals.node },
  },
  {
    files: ['public/**/*.js'],
    languageOptions: { sourceType: 'module', ecmaVersion: 2023, globals: globals.browser },
  },
];
