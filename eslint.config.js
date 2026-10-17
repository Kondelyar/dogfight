import js from '@eslint/js';

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
  EventTarget: 'readonly',
  CustomEvent: 'readonly',
  WebSocket: 'readonly',
};

const node = {
  process: 'readonly',
  Buffer: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  setImmediate: 'readonly',
  URL: 'readonly',
  fetch: 'readonly',
  AbortController: 'readonly',
};

export default [
  { ignores: ['**/dist', '**/logs'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
    rules: { 'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }] },
  },
  { files: ['client/**/*.js'], languageOptions: { globals: browser } },
  { files: ['server/**/*.js'], languageOptions: { globals: node } },
];
