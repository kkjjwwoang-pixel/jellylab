import { chromium } from 'file:///C:/Users/kkjjw/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync('qa', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error' || message.type() === 'warn') errors.push(message.text()); });
try {
  await page.goto('http://127.0.0.1:5176', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__softMatter?.state.ready || !document.querySelector('#render-error').hidden, { timeout: 45000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'qa/desktop.png', fullPage: true });
  console.log(JSON.stringify({ state: await page.evaluate(() => ({backend: window.__softMatter?.backend,state: window.__softMatter?.state, info: window.__softMatter?.renderInfo})), errors }, null, 2));
  writeFileSync('qa/initial-report.json',JSON.stringify({ errors },null,2));
} finally { await browser.close(); }
