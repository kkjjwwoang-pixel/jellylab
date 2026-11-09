import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Group, Mesh, TorusGeometry, Vector3 } from 'three';
import { geometryOnlyGLB, prepareModel, MAX_TRIANGLES } from '../src/model-geometry.js';
import { JellyBody } from '../src/body-physics.js';
import { makeGLB } from './helpers/glb.mjs';

test('GLB import strips original appearance and rejects broken, external and excessive inputs', () => {
  const box = new BoxGeometry();
  const input = makeGLB(box, json => {
    json.materials = [{}]; json.textures = [{ source: 0 }]; json.images = [{ uri: 'https://example.invalid/texture.png' }];
    json.meshes[0].primitives[0].material = 0;
    json.extensionsRequired = ['KHR_texture_basisu', 'KHR_materials_transmission'];
  });
  const output = geometryOnlyGLB(input);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(output, 20, new DataView(output).getUint32(12, true))));
  assert.equal(json.images, undefined); assert.equal(json.materials, undefined);
  assert.deepEqual(json.extensionsRequired, []);
  assert.throws(() => geometryOnlyGLB(new ArrayBuffer(5)), /GLB/);
  assert.throws(() => geometryOnlyGLB(input.slice(0, -4)), /GLB/);
  assert.throws(() => geometryOnlyGLB(makeGLB(box, j => { j.buffers[0].uri = 'remote.bin'; })), /외부/);
  assert.throws(() => geometryOnlyGLB(makeGLB(box, j => { j.accessors[1].count = (MAX_TRIANGLES + 1) * 3; })), /복잡/);
});

test('uploaded geometry retains holes, merges world transforms and refines sparse surfaces', () => {
  const ring = new Mesh(new TorusGeometry(2, .6, 12, 32));
  ring.position.set(20, -50, 7); ring.scale.setScalar(100);
  const result = prepareModel(ring);
  assert.ok(Math.abs(Math.max(...result.size.toArray()) - 3) < 1e-5);
  const points = result.geometry.attributes.position;
  for (let i = 0; i < points.count; i++) assert.ok(Math.hypot(points.getX(i), points.getY(i)) > .7, 'torus hole must remain open');
  const root = new Group();
  const left = new Mesh(new BoxGeometry()); left.position.x = -1;
  const right = new Mesh(new BoxGeometry()); right.position.x = 1; right.scale.x = -1;
  root.add(left, right);
  const boxes = prepareModel(root);
  assert.ok(boxes.geometry.index.count > 72, 'sparse faces are subdivided for local stretch');
  assert.deepEqual(boxes.size.toArray(), [3, 1, 1]);
  assert.ok(boxes.geometry.attributes.normal.array.every(Number.isFinite));
  assert.throws(() => prepareModel(new Group()), /表面|표면/);
});

test('custom contact follows actual shape and repeated lift/land cycles retain adhesion', () => {
  const model = prepareModel(new Mesh(new BoxGeometry(3, 1.4, 1.2)));
  const body = new JellyBody(); body.setShape(model.supportPositions, model.size.y);
  assert.ok(Math.abs(body.position.y - (.7 - body.contactInset)) < 1e-5);
  body.orientation.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2);
  assert.ok(Math.abs(body.support().y + 1.5) < 1e-5, 'rotated width now supports the body');
  body.reset();
  for (let cycle = 0; cycle < 3; cycle++) {
    const grip = new Vector3(.3, .5, .4);
    const origin = grip.clone().applyQuaternion(body.orientation).add(body.position);
    body.beginGrip(grip, origin.clone().add(new Vector3(.1, 1.1, 0)));
    for (let i = 0; i < 120; i++) body.advance(1 / 120);
    assert.equal(body.attached, true);
    body.target.copy(origin).add(new Vector3(.2, 3, 0));
    for (let i = 0; i < 240; i++) body.advance(1 / 120);
    assert.equal(body.attached, false); assert.ok(body.clearance > .1);
    body.release();
    for (let i = 0; i < 2400; i++) body.advance(1 / 120);
    assert.equal(body.attached, true); assert.ok(body.clearance < .03);
    assert.ok(body.position.toArray().every(Number.isFinite));
  }
  body.setShape(); assert.equal(body.supportPositions, null);
});
