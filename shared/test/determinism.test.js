import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shipHash, worldHash, mulberry32 } from '../src/index.js';

// shared імпортується в чистому Node без DOM - цей файл це й доводить

test('той самий сценарій дає той самий хеш (звіряється з консоллю браузера)', () => {
  assert.equal(shipHash(1000), shipHash(1000));
  assert.equal(shipHash(1000), '49a560f0');
});

test('світ з однаковим seed і інпутами детермінований, інший seed дає інший результат', () => {
  assert.equal(worldHash(7, 600), worldHash(7, 600));
  assert.notEqual(worldHash(7, 600), worldHash(8, 600));
  assert.equal(worldHash(7, 600), '7128b497');
});

test('mulberry32 повторюється для одного seed', () => {
  const a = mulberry32(123);
  const b = mulberry32(123);
  for (let i = 0; i < 5; i++) assert.equal(a(), b());
});

test('Math.random у симуляції зламав би детермінізм (сторожовий тест)', () => {
  const original = Math.random;
  let calls = 0;
  Math.random = () => {
    calls++;
    return original();
  };
  try {
    shipHash(200);
    worldHash(7, 200);
  } finally {
    Math.random = original;
  }
  assert.equal(calls, 0, 'симуляція не має викликати Math.random');
});
