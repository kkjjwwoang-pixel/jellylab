import { chromium } from 'file:///C:/Users/kkjjw/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import { BoxGeometry, TorusGeometry } from 'three';
import { makeGLB } from './tests/helpers/glb.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
mkdirSync('qa/models', { recursive: true });
const reports = [];
const ring = Buffer.from(makeGLB(new TorusGeometry(1, .38, 16, 48)));
const box = Buffer.from(makeGLB(new BoxGeometry(2.6, 1.8, 1.5)));
async function upload(page, name, buffer) {
  await page.locator('#model-file').setInputFiles({ name, mimeType: 'model/gltf-binary', buffer });
  await page.waitForFunction(() => !window.__softMatter.model.loading);
}
async function grip(page) {
  const { screen: [x, y] } = await page.evaluate(() => window.__softMatter.contactInspection);
  for (const [dx, dy] of [[0, 0], [-75, 0], [75, 0], [0, -65], [0, 65], [-110, 0], [110, 0]]) {
    await page.mouse.move(x + dx, y + dy); await page.mouse.down();
    if (await page.evaluate(() => window.__softMatter.state.dragging)) return [x + dx, y + dy];
    await page.mouse.up();
  }
  throw new Error('Uploaded surface was not pickable');
}
try {
  for (const backend of ['webgpu', 'webgl']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    const errors = [], requests = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('request', r => { if (r.method() === 'POST') requests.push(r.url()); });
    await page.goto(`http://127.0.0.1:5176/${backend === 'webgl' ? '?webgl' : ''}`);
    await page.waitForFunction(() => window.__softMatter?.state.ready, null, { timeout: 60000 });
    await upload(page, 'ring.glb', ring);
    assert.equal(await page.locator('#model-message').isVisible(), false, await page.locator('#model-message').textContent());
    assert.equal(await page.evaluate(() => window.__softMatter.model.custom), true);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `qa/models/${backend}-ring.png` });
    for (let cycle = 0; cycle < 2; cycle++) {
      const [x, y] = await grip(page);
      await page.mouse.move(x, y - 145, { steps: 20 });
      await page.waitForTimeout(750);
      const partial = await page.evaluate(() => window.__softMatter.state);
      assert.equal(partial.attached, true);
      assert.ok(Math.hypot(...partial.grab) > .2);
      await page.screenshot({ path: `qa/models/${backend}-${cycle}-stretch.png` });
      await page.mouse.move(x, Math.max(8, y - 425), { steps: 35 });
      await page.waitForFunction(() => !window.__softMatter.state.attached, null, { timeout: 8000 });
      await page.mouse.up(); await page.mouse.move(420, 820);
      await page.waitForFunction(() => window.__softMatter.state.attached, null, { timeout: 18000 });
      reports.push({ backend, cycle, partial, settled: await page.evaluate(() => window.__softMatter.state) });
    }
    const beforeError = await page.evaluate(() => window.__softMatter.model);
    await upload(page, 'broken.glb', Buffer.from('not a model'));
    assert.equal(await page.locator('#model-message').isVisible(), true);
    assert.deepEqual(await page.evaluate(() => window.__softMatter.model), beforeError, 'bad upload keeps previous shape');
    await upload(page, 'box.glb', box);
    assert.equal(await page.locator('#model-message').isVisible(), false);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `qa/models/${backend}-box.png` });
    await page.locator('#reset').click();
    assert.equal(await page.evaluate(() => window.__softMatter.model.custom), true, 'reset retains model');
    await page.locator('#model-clear').click();
    assert.equal(await page.evaluate(() => window.__softMatter.model.custom), false);
    await upload(page, 'ring.glb', ring);
    await page.locator('#model-clear').click();
    const memory = await page.evaluate(() => window.__softMatter.renderInfo);
    await upload(page, 'ring.glb', ring);
    await page.locator('#model-clear').click();
    await page.waitForTimeout(250);
    assert.ok((await page.evaluate(() => window.__softMatter.renderInfo.geometries)) <= memory.geometries + 1, 'replacement releases geometry');
    assert.equal(requests.length, 0, 'model never uploads to a server');
    assert.deepEqual(errors, []);
    reports.push({ backend, memory, errors });
    await page.close();
  }
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.goto('http://127.0.0.1:5176/');
  await page.waitForFunction(() => window.__softMatter?.state.ready, null, { timeout: 60000 });
  await upload(page, 'long-model-filename-for-testing.glb', ring);
  await page.screenshot({ path: 'qa/models/mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.close();
  console.log(JSON.stringify(reports, null, 2));
} finally {
  writeFileSync('qa/models/report.json', JSON.stringify(reports, null, 2));
  await browser.close();
}
