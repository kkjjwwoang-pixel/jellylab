import test from 'node:test';
import assert from 'node:assert/strict';
import { peeledFraction } from '../src/contact.js';

test('the grabbed lip peels first, the opposite lip stays bonded, then releases last', () => {
  const direction = { x: 1, z: 0 };
  assert.equal(peeledFraction(1.2, 0, direction, 0), 0);
  assert.ok(peeledFraction(1.2, 0, direction, .4) > .9);
  assert.equal(peeledFraction(-1.2, 0, direction, .4), 0);
  assert.ok(peeledFraction(-1.2, 0, direction, .98) > .99);
  let previous = 0;
  for (let progress = 0; progress <= 1; progress += .005) {
    const peeled = peeledFraction(0, 0, direction, progress);
    assert.ok(peeled >= previous && peeled - previous < .05, 'continuous, monotonic front');
    previous = peeled;
  }
});
