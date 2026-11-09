import { chromium } from 'file:///C:/Users/kkjjw/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [], layouts = [];
try {
  const page = await browser.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('http://127.0.0.1:5176', {waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.__softMatter?.state.ready);
  for (const [width,height] of [[1440,960],[1024,768],[768,1024],[390,844],[320,740]]) {
    await page.setViewportSize({width,height});
    await page.waitForTimeout(400);
    const layout = await page.evaluate(()=>{
      const bounds = s=>{const r=document.querySelector(s).getBoundingClientRect();return {top:r.top,right:r.right,bottom:r.bottom,left:r.left};};
      return {width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,hint:bounds('.touch-hint'),panel:bounds('.material-panel'),footer:bounds('.footer'),pausedControlVisible:!!document.querySelector('#pause').offsetParent};
    });
    assert.ok(layout.scrollWidth<=width,`${width}: horizontal overflow`);
    assert.ok(layout.panel.bottom<=layout.footer.top,`${width}: panel overlaps footer`);
    if(width<=900) assert.ok(layout.hint.bottom<layout.panel.top,`${width}: hint overlaps panel`);
    assert.ok(layout.pausedControlVisible);
    await page.screenshot({path:`qa/production-${width}.png`,fullPage:true}); layouts.push(layout);
  }
  assert.equal(errors.length,0);
  console.log(JSON.stringify({productionBackend:await page.evaluate(()=>window.__softMatter.backend),layouts,errors},null,2));
  writeFileSync('qa/layout-report.json',JSON.stringify({layouts,errors},null,2));
} finally { await browser.close(); }
