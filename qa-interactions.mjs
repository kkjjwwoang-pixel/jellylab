import { chromium } from 'file:///C:/Users/kkjjw/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
mkdirSync('qa', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const report = { desktop: {}, mobile: {}, fallback: {}, reducedMotion: {}, errors: [] };
function captureErrors(page, scope) {
  page.on('pageerror', e => report.errors.push(`${scope}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') report.errors.push(`${scope}: ${m.text()}`); });
}
async function ready(page, suffix = '') {
  await page.goto(`http://127.0.0.1:5176/${suffix}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__softMatter?.state.ready, { timeout: 45000 });
}
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } }); captureErrors(page, 'desktop');
  await ready(page);
  report.desktop.backend = await page.evaluate(() => window.__softMatter.backend);
  await page.mouse.move(795, 465); await page.mouse.down();
  await page.waitForFunction(() => window.__softMatter.state.dragging);
  await page.mouse.move(940, 310, { steps: 18 }); await page.waitForTimeout(700);
  const held = await page.evaluate(() => window.__softMatter.state);
  assert.ok(Math.hypot(...held.grab) > .2, 'drag should deform the surface while excess tension moves the body');
  report.desktop.drag = held.grab;
  await page.screenshot({ path: 'qa/desktop-drag.png' });
  await page.mouse.up(); await page.mouse.move(500, 800);
  await page.waitForFunction(() => !window.__softMatter.state.dragging && Math.hypot(...window.__softMatter.state.grab) < .01);
  report.desktop.recovery = true;
  await page.getByRole('button', {name:'Jade material', exact:true}).click();
  assert.equal(await page.evaluate(() => window.__softMatter.state.palette), 'jade');
  await page.waitForTimeout(700); await page.screenshot({ path: 'qa/desktop-jade.png' });
  await page.getByRole('button', {name:'Amber material', exact:true}).click();
  await page.waitForTimeout(700); await page.screenshot({ path: 'qa/desktop-amber.png' });
  await page.locator('#softness').fill('95');
  assert.equal(await page.evaluate(() => window.__softMatter.state.softness), .95);
  await page.locator('#clarity').fill('25');
  assert.equal(await page.locator('#clarity-value').innerText(), '25%');
  await page.getByRole('button', {name:'Pause motion', exact:true}).click();
  const pausedTime = await page.evaluate(() => window.__softMatter.state.time);
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.__softMatter.state.time), pausedTime);
  await page.getByRole('button', {name:'Nudge'}).click();
  assert.equal(await page.evaluate(() => window.__softMatter.state.paused), false);
  report.desktop.pauseAndNudge = true;
  await page.getByRole('button', {name:'Reset the experiment',exact:true}).click();
  const reset = await page.evaluate(() => window.__softMatter.state);
  assert.equal(reset.palette, 'rose'); assert.equal(reset.softness, .68);
  assert.equal(await page.locator('#clarity').inputValue(), '76');
  await page.mouse.move(795, 465); await page.mouse.wheel(0, 700);
  await page.waitForFunction(() => window.__softMatter.state.morph > .45);
  report.desktop.scrollMorph = true;
  await page.screenshot({ path: 'qa/desktop-morph.png' });
  await page.locator('canvas').focus(); await page.keyboard.press('r');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => Math.abs(window.__softMatter.state.squash) > .05);
  report.desktop.keyboard = true;
  await page.getByRole('button', {name:'About the experiment'}).click();
  assert.equal(await page.locator('dialog').evaluate(el => el.open), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('dialog').evaluate(el => el.open), false);
  report.desktop.about = true;
  await page.getByRole('button', {name:'Reset the experiment',exact:true}).click();
  await page.mouse.move(500, 820); await page.waitForTimeout(1200);
  await page.screenshot({ path: 'qa/desktop.png' });
  report.desktop.frameTiming = await page.evaluate(async () => {
    const times = []; let previous;
    await new Promise(resolve => { function frame(t) { if (previous) times.push(t - previous); previous = t; if (times.length === 90) resolve(); else requestAnimationFrame(frame); } requestAnimationFrame(frame); });
    times.sort((a,b) => a-b); return { medianMs: times[45], p90Ms: times[81] };
  });
  await page.close();

  const mobile = await browser.newPage({ viewport: {width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true }); captureErrors(mobile,'mobile');
  await ready(mobile); await mobile.waitForTimeout(700);
  await mobile.screenshot({path:'qa/mobile.png',fullPage:true});
  report.mobile.noHorizontalOverflow = await mobile.evaluate(()=>document.documentElement.scrollWidth <= innerWidth);
  assert.ok(report.mobile.noHorizontalOverflow);
  await mobile.touchscreen.tap(195,450);
  await mobile.waitForFunction(()=>Math.abs(window.__softMatter.state.squash)>.02);
  report.mobile.touchImpact = true;
  await mobile.getByRole('button',{name:'Jade material',exact:true}).tap();
  assert.equal(await mobile.evaluate(()=>window.__softMatter.state.palette),'jade');
  report.mobile.controls = true;
  await mobile.close();

  const fallback = await browser.newPage({viewport:{width:1280,height:900}}); captureErrors(fallback,'webgl');
  await ready(fallback,'?webgl');
  assert.equal(await fallback.evaluate(()=>window.__softMatter.backend),'WEBGL 2');
  report.fallback.backend = 'WEBGL 2';
  await fallback.getByRole('button',{name:'Nudge'}).click();
  await fallback.waitForFunction(()=>Math.abs(window.__softMatter.state.squash)>.04);
  await fallback.screenshot({path:'qa/fallback.png'}); report.fallback.interaction = true;
  await fallback.close();

  const reduced = await browser.newPage({viewport:{width:1440,height:960},reducedMotion:'reduce'}); captureErrors(reduced,'reduced-motion');
  await ready(reduced);
  assert.equal(await reduced.evaluate(()=>window.__softMatter.state.paused),true);
  report.reducedMotion.startsPaused = true;
  await reduced.getByRole('button',{name:'Nudge'}).click();
  assert.equal(await reduced.evaluate(()=>window.__softMatter.state.paused),false);
  report.reducedMotion.explicitPlay = true;
  await reduced.close();
  assert.equal(report.errors.length,0);
  console.log(JSON.stringify(report,null,2));
} finally {
  writeFileSync('qa/interaction-report.json',JSON.stringify(report,null,2));
  await browser.close();
}
