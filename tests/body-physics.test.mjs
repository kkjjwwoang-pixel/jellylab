import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { JellyBody } from '../src/body-physics.js';

test('passive reattachment waits for imperceptible motion at mobile and enlarged desktop scales', () => {
  for (const scale of [.7, 1.04, 1.25]) {
    const body = new JellyBody();
    body.advance(1 / 60, { scale });
    const grip = new Vector3(.5, .8, .4);
    body.beginGrip(grip, grip.clone().multiplyScalar(scale).add(body.position).add(new Vector3(.4, 2.7, 0).multiplyScalar(scale)));
    for (let i = 0; i < 240; i++) body.advance(1 / 120, { scale });
    assert.equal(body.attached, false);
    body.release();
    let attached = false;
    let coastSteps = 0;
    for (let i = 0; i < 2400; i++) {
      const speed = body.velocity.length(), spin = body.angularVelocity.length();
      const position = body.position.clone(), orientation = body.orientation.clone();
      body.advance(1 / 120, { scale });
      if (body.grounded && !body.attached && speed < .4 * scale && spin < .5) coastSteps++;
      if (body.attached) {
        assert.ok(speed < .025 * scale, `scale ${scale}: translation must fade before attachment (${speed})`);
        assert.ok(spin < .025, `scale ${scale}: rotation must fade before attachment (${spin})`);
        assert.ok(body.position.distanceTo(position) < .003 * scale);
        assert.ok(body.orientation.angleTo(orientation) < .001);
        attached = true; break;
      }
    }
    assert.equal(attached, true, 'settling still finishes');
    assert.ok(coastSteps > 30, 'the final rolling motion fades over multiple frames');
  }
});

test('a visually peeled footprint transfers to body motion before the stretch limit stalls the grip', () => {
  for (const scale of [1, .7]) {
    const body = new JellyBody();
    body.advance(1 / 60, { scale });
    const grip = new Vector3(.2, .8, .5);
    const origin = grip.clone().multiplyScalar(scale).add(body.position);
    body.beginGrip(grip, origin.clone().add(new Vector3(0, 1.9 * scale, 0)));
    for (let i = 0; i < 180; i++) body.advance(1 / 120, { scale });
    assert.equal(body.attached, true);
    assert.ok(body.peel < .975);
    body.observeSurfaceContact(.004);
    assert.equal(body.attached, true, 'remaining floor contact still holds');
    const pinnedHeight = body.position.y;
    body.observeSurfaceContact(.12 * scale);
    assert.equal(body.attached, false, 'last visible contact releases the center immediately');
    for (let i = 0; i < 20; i++) body.advance(1 / 120, { scale });
    assert.ok(body.position.y > pinnedHeight + .05 * scale, 'a held pull resumes motion without extra drag');
    body.release();
    for (let i = 0; i < 1800; i++) {
      body.advance(1 / 120, { scale });
      body.observeSurfaceContact(body.clearance + .004);
    }
    assert.equal(body.attached, true, 'landing can still form a new contact');
    assert.ok(body.clearance < .03 * scale);
  }
});

test('a resting collider cannot reattach while the visible stretched surface is airborne', () => {
  const body = new JellyBody();
  body.detach();
  body.observeSurfaceContact(.2);
  for (let i = 0; i < 600; i++) body.advance(1 / 120);
  assert.equal(body.attached, false);
  body.observeSurfaceContact(.004);
  for (let i = 0; i < 600; i++) body.advance(1 / 120);
  assert.equal(body.attached, true);
});

test('adhesion resists sustained moderate pulls, peels under load, and re-bonds after landing', () => {
  const body = new JellyBody();
  for (let i = 0; i < 60; i++) body.advance(1 / 120);
  const start = body.position.clone();
  const grip = new Vector3(.2, .8, .5);
  const origin = start.clone().add(grip);
  body.beginGrip(grip, origin.clone().add(new Vector3(.2, 1.1, 0)));
  for (let i = 0; i < 360; i++) body.advance(1 / 120);
  assert.equal(body.attached, true, 'holding a medium pull must not slowly lift the body');
  assert.ok(body.position.distanceTo(start) < .005);
  assert.ok(body.adhesionLoad > .3 && body.adhesionLoad < 1);
  body.target.copy(origin).add(new Vector3(.2, 2.3, 0));
  for (let i = 0; i < 240; i++) body.advance(1 / 120);
  assert.equal(body.attached, false, 'a strong pull must peel the contact patch');
  assert.ok(body.clearance > .3);
  body.release();
  for (let i = 0; i < 1800; i++) body.advance(1 / 120);
  assert.equal(body.attached, true, 'settled gel sticks again');
});

test('a brief pull starts peeling without full release, and the patch relaxes back', () => {
  const body = new JellyBody();
  const grip = new Vector3(.2, .8, .5);
  const origin = body.position.clone().add(grip);
  body.beginGrip(grip, origin.clone().add(new Vector3(0, 3, 0)));
  for (let i = 0; i < 5; i++) body.advance(1 / 120);
  assert.equal(body.attached, true);
  assert.ok(body.peel>0 && body.peel<.975);
  body.target.copy(origin);
  for (let i = 0; i < 60; i++) body.advance(1 / 120);
  assert.equal(body.attached, true);
  assert.ok(body.peel<.02);
});

test('small pulls stretch locally; larger off-center pulls roll the body', () => {
  const body = new JellyBody();
  const grip = new Vector3(.6, .45, 1.1);
  body.beginGrip(grip, grip.clone().add(body.position));
  body.target.x += .2;
  for (let i=0;i<120;i++) body.advance(1/120);
  assert.ok(body.orientation.angleTo(new JellyBody().orientation)<.08);
  body.target.add(new Vector3(1.5, .8, -.8));
  for (let i=0;i<180;i++) body.advance(1/120);
  assert.equal(body.attached, true, 'the former release distance must now remain bonded');
  body.target.x += 1;
  for (let i=0;i<180;i++) body.advance(1/120);
  assert.ok(body.orientation.angleTo(new JellyBody().orientation)>.35, 'the body should turn, not stay glued to the ground');
  assert.ok(Math.hypot(body.position.x,body.position.z)>.2, 'the center should move');
});

test('edge grips cannot bypass adhesion through torque, at desktop or mobile scale', () => {
  for (const scale of [1, .7]) for (const point of [[0,.3,1.1],[.3,1,0],[1.3,.6,.7]]) {
    const body = new JellyBody();
    body.advance(1/60, { scale });
    const grip = new Vector3(...point);
    const origin = grip.clone().multiplyScalar(scale).add(body.position);
    body.beginGrip(grip, origin.clone().add(new Vector3(1.8, .4, 0).multiplyScalar(scale)));
    for (let i=0;i<360;i++) body.advance(1/120, { scale });
    assert.equal(body.attached, true);
    assert.ok(body.orientation.angleTo(new JellyBody().orientation) < .001);
    body.target.copy(origin).add(new Vector3(2.8,.5,0).multiplyScalar(scale));
    for (let i=0;i<120;i++) body.advance(1/120, { scale });
    assert.equal(body.attached, false);
  }
});

test('lifting leaves the ground and release lands with retained rotation', () => {
  const body = new JellyBody();
  const grip = new Vector3(.5,.8,.4);
  body.beginGrip(grip,grip.clone().add(body.position).add(new Vector3(.4,2.2,0)));
  for(let i=0;i<240;i++)body.advance(1/120);
  assert.ok(body.clearance>.2,'upward pulling should lift the body');
  const released = body.orientation.clone();
  body.release();
  let landed=false;
  for(let i=0;i<1800;i++){body.advance(1/120);landed ||= body.impact>0;}
  assert.ok(landed,'landing should drive a jelly impact');
  assert.ok(body.clearance<.03);
  assert.ok(body.angularVelocity.length()<.15,'rolling should settle');
  assert.ok(body.orientation.angleTo(released)>.05,'release preserves momentum');
  assert.ok(Math.abs(body.orientation.length()-1)<1e-9);
});

test('extreme pulls remain bounded and reset clears linear and angular motion', () => {
  const body = new JellyBody();body.beginGrip(new Vector3(1,1,1),new Vector3(10,12,-10));
  for(let i=0;i<1200;i++)body.advance(1/120);
  assert.ok(body.velocity.length()<=5.001);
  assert.ok(body.angularVelocity.length()<=6.1);
  assert.ok(body.position.toArray().every(Number.isFinite));
  body.reset();assert.equal(body.orientation.w,1);assert.equal(body.angularVelocity.length(),0);
  assert.equal(body.velocity.length(),0);assert.equal(body.held,false);
});

test('lowering a held jelly back onto the floor also re-bonds', () => {
  const body = new JellyBody();
  const grip = new Vector3(.2,.8,.3);
  body.beginGrip(grip,grip.clone().add(body.position).add(new Vector3(.2,2.7,0)));
  for(let i=0;i<240;i++)body.advance(1/120);
  assert.equal(body.attached,false);
  assert.ok(body.clearance>.3);
  // Keep holding with no residual tension while gravity brings it down.
  for(let i=0;i<1200;i++){
    body.target.copy(grip).applyQuaternion(body.orientation).add(body.position);
    body.advance(1/120);
  }
  assert.equal(body.held,true);
  assert.equal(body.attached,true);
});

test('six peel / land / re-grip cycles work without reset, including residual rolling', () => {
  const body = new JellyBody();
  const grip = new Vector3(.3,.65,.8);
  for(let cycle=0;cycle<6;cycle++) {
    const origin = grip.clone().applyQuaternion(body.orientation).add(body.position);
    body.beginGrip(grip, origin);
    assert.equal(body.attached,true, `cycle ${cycle}: fresh landed contact`);
    body.target.copy(origin).add(new Vector3(.2,1.25,0));
    for(let i=0;i<100;i++)body.advance(1/120);
    assert.ok(body.peel>.2 && body.peel<.85, `cycle ${cycle}: partial peel`);
    assert.equal(body.attached,true);
    body.target.copy(origin).add(new Vector3(.2,2.9,0));
    for(let i=0;i<160;i++)body.advance(1/120);
    assert.equal(body.attached,false, `cycle ${cycle}: full peel`);
    body.release();
    for(let i=0;i<1000 && !body.grounded;i++)body.advance(1/120);
    // Deliberately re-grip before the old velocity/settling gate was satisfied.
    body.angularVelocity.set(.6,.3,.2);
    body.velocity.y=0;
  }
});
