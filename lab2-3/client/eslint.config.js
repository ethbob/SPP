import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['dist/', 'node_modules/'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error', // хуки только на верхнем уровне компонента
      'react-hooks/exhaustive-deps': 'warn', //  все зависимости useEffect/useCallback указаны
      // переменные, используемые только в JSX, ESLint без плагина React не видит — шаблон Upper-case пропускаем
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z]' }],
    },
  },
  { files: ['vite.config.js', 'eslint.config.js'], languageOptions: { globals: globals.node } },
];
