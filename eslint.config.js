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
  EventTarget: 'readonly',
  CustomEvent: 'readonly',
};

// shared працює і в браузері, і в Node, тому тут лише те, що є в обох
const shared = {
  console: 'readonly',
  performance: 'readonly',
  EventTarget: 'readonly',
  CustomEvent: 'readonly',
  TextEncoder: 'readonly',
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
  { files: ['shared/**/*.js'], languageOptions: { globals: shared } },
];
