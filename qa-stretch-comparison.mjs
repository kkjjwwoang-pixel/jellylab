import { chromium } from 'file:///C:/Users/kkjjw/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const browser = await chromium.launch({channel:'msedge',headless:true});
const report=[];
mkdirSync('qa/stretch',{recursive:true});
try {
  for(const variant of ['current','stable-position']) {
    const page=await browser.newPage({viewport:{width:1440,height:960}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/src/main.js',async route=>{
      const response=await route.fetch();let body=await response.text();
      if(variant==='stable-position')body=body.replaceAll('positionLocal','positionGeometry');
      await route.fulfill({response,body});
    });
    await page.goto('http://127.0.0.1:5174',{waitUntil:'networkidle'});
    await page.waitForFunction(()=>window.__softMatter?.state.ready);
    await page.locator('#reset').click();await page.mouse.move(795,465);await page.mouse.down();
    await page.mouse.move(1070,120,{steps:24});await page.waitForTimeout(1200);
    await page.screenshot({path:`qa/stretch/comparison-${variant}.png`});
    report.push({variant,errors,state:await page.evaluate(()=>window.__softMatter.state)});
    await page.close();
  }
  console.log(JSON.stringify(report,null,2));
  writeFileSync('qa/stretch/comparison.json',JSON.stringify(report,null,2));
} finally {await browser.close();}
