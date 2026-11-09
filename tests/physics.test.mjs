import test from 'node:test';
import assert from 'node:assert/strict';
import { JellyPhysics } from '../src/physics.js';

test('an impact overshoots and then settles at all firmness settings', () => {
  for (const softness of [0, .68, 1]) {
    const model = new JellyPhysics(); model.softness = softness; model.impact();
    let minimum = 0, maximum = 0;
    for (let i = 0; i < 1200; i++) {
      model.advance(1 / 60);
      minimum = Math.min(minimum, model.squash.value);
      maximum = Math.max(maximum, model.squash.value);
    }
    assert.ok(minimum < -.05, 'a click should visibly compress');
    assert.ok(maximum > .01, 'the rebound should overshoot');
    assert.ok(Math.abs(model.squash.value) < 1e-6, 'the spring should settle');
  }
});

test('held deformation follows a target and recovers after release', () => {
  const model = new JellyPhysics(); model.grab[0].target = 1.5;
  for (let i = 0; i < 240; i++) model.advance(1 / 60);
  assert.ok(Math.abs(model.grab[0].value - 1.5) < .001);
  model.grab[0].target = 0;
  for (let i = 0; i < 600; i++) model.advance(1 / 60);
  assert.ok(Math.abs(model.grab[0].value) < 1e-6);
});

test('different display frame rates produce the same spring result', () => {
  const fast = new JellyPhysics(), slow = new JellyPhysics(); fast.impact(); slow.impact();
  for (let i = 0; i < 120; i++) fast.advance(1 / 120);
  for (let i = 0; i < 30; i++) slow.advance(1 / 30);
  assert.ok(Math.abs(fast.squash.value - slow.squash.value) < 1e-9);
});

test('repeated input and a suspended-tab frame remain bounded', () => {
  const model = new JellyPhysics(); model.softness = 1;
  for (let i = 0; i < 300; i++) {
    model.impact(1); model.advance(1 / 60);
    assert.ok(model.squash.value >= -.48 && model.squash.value <= .55);
    assert.ok(Number.isFinite(model.squash.velocity));
  }
  const before = model.time; model.advance(300);
  assert.ok(model.time - before <= .06);
  model.reset(); assert.equal(model.squash.velocity, 0); assert.equal(model.squash.value, 0);
});
