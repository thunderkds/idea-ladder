import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['experiments/', 'dist/', 'node_modules/', 'test-results/', 'playwright-report/', '.claude/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.node } } },
  { files: ['public/**/*.js'], languageOptions: { globals: { ...globals.browser } } },
);
