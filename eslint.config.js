import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const browser = {
  window: 'readonly',
  document: 'readonly',
  console: 'readonly',
  performance: 'readonly',
  devicePixelRatio: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  fetch: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  Image: 'readonly',
  AudioContext: 'readonly',
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  WebSocket: 'readonly',
  TextEncoder: 'readonly',
};

const node = {
  process: 'readonly',
  Buffer: 'readonly',
  console: 'readonly',
  performance: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  setImmediate: 'readonly',
  URL: 'readonly',
  fetch: 'readonly',
  AbortController: 'readonly',
  TextEncoder: 'readonly',
  NodeJS: 'readonly',
};

// shared працює і в браузері, і в Node, тому тут лише те, що є в обох
const shared = {
  console: 'readonly',
  performance: 'readonly',
  TextEncoder: 'readonly',
};

export default tseslint.config(
  { ignores: ['**/dist', '**/logs', '**/coverage'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      // жодного any: помилка, а не попередження
      '@typescript-eslint/no-explicit-any': 'error',
      // у catch тип unknown, а не any
      '@typescript-eslint/no-unsafe-function-type': 'error',
    },
  },
  { files: ['client/**/*.ts'], languageOptions: { globals: browser } },
  { files: ['server/**/*.ts'], languageOptions: { globals: node } },
  { files: ['shared/**/*.ts'], languageOptions: { globals: shared } },
);
