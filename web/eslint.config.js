import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'public'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended, reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
  },
  {
    files: ['scripts/**/*.mjs', 'eslint.config.js', 'vite.config.ts'],
    languageOptions: { globals: globals.node },
  },
);
