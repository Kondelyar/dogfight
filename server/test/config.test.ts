import { test } from 'vitest';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.ts';

test('конфіг: значення за замовчуванням і приведення рядків до чисел', () => {
  const config = loadConfig({});
  assert.equal(config.port, 3000);
  assert.equal(config.maxPlayers, 8);
  assert.equal(config.seed, null);

  const custom = loadConfig({
    PORT: '8080',
    MAX_ROOMS: '3',
    SEED: '42',
    DEBUG_ROUTES: '1',
    HOST: '',
  });
  assert.equal(custom.port, 8080);
  assert.equal(custom.maxRooms, 3);
  assert.equal(custom.seed, 42);
  assert.equal(custom.debugRoutes, true);
  assert.equal(custom.host, '0.0.0.0', 'порожній рядок = не задано');
});

test('конфіг: погане значення дає зрозумілу помилку з назвою змінної', () => {
  assert.throws(() => loadConfig({ PORT: 'abc' }), /PORT/);
  assert.throws(() => loadConfig({ PORT: '70000' }), /PORT/);
  assert.throws(() => loadConfig({ MAX_ROOMS: '0' }), /MAX_ROOMS/);
  assert.throws(() => loadConfig({ SEED: '-1' }), /SEED/);
});
