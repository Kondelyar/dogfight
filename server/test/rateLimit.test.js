import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBucket } from '../src/rateLimit.js';

test('burst закінчується, потім токени повертаються з часом', () => {
  let time = 0;
  const bucket = createBucket({ perSecond: 2, burst: 3, now: () => time });

  assert.deepEqual(
    [bucket.take(), bucket.take(), bucket.take(), bucket.take()],
    [true, true, true, false],
  );

  time += 500; // +1 токен
  assert.equal(bucket.take(), true);
  assert.equal(bucket.take(), false);
});
