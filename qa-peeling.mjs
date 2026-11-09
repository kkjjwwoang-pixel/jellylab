import { chromium } from 'file:///C:/Users/kkjjw/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const browser = await chromium.launch({channel:'msedge',headless:true});
const reports=[];
mkdirSync('qa/peeling',{recursive:true});
try {
  for(const backend of ['webgpu','webgl']) {
    const page=await browser.newPage({viewport:{width:1440,height:960}});
    const errors=[];
    page.on('pageerror',e=>{errors.push(e.message);console.log(e.message);});
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.goto(`http://127.0.0.1:5176/${backend==='webgl'?'?webgl':''}`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.__softMatter?.state.ready,null,{timeout:60000});
    await page.waitForTimeout(700);
    for(let cycle=0;cycle<3;cycle++) {
      const before=await page.evaluate(()=>({state:window.__softMatter.state,contact:window.__softMatter.contactInspection}));
      const [x,y]=before.contact.screen;
      await page.mouse.move(x,y);await page.mouse.down();
      await page.waitForFunction(()=>window.__softMatter.state.dragging);
      await page.mouse.move(x,y-160,{steps:24});await page.waitForTimeout(700);
      const partial=await page.evaluate(()=>({state:window.__softMatter.state,contact:window.__softMatter.contactInspection}));
      await page.screenshot({path:`qa/peeling/${backend}-${cycle}-partial.png`});
      console.log(backend,cycle,'partial',JSON.stringify(partial));
      assert.equal(partial.state.attached,true,'partial contact remains during peeling');
      assert.ok(partial.state.peel>.15 && partial.state.peel<.9);
      assert.ok(partial.contact.near>partial.contact.far+.06,'grabbed lip lifts before opposite lip');
      await page.mouse.move(x,y-430,{steps:40});await page.waitForTimeout(1100);
      const lifted=await page.evaluate(()=>window.__softMatter.state);
      await page.screenshot({path:`qa/peeling/${backend}-${cycle}-lift.png`});
      assert.equal(lifted.attached,false,'the final contact patch releases');
      assert.ok(lifted.clearance>.05);
      await page.mouse.up();await page.mouse.move(450,800);
      await page.waitForFunction(()=>window.__softMatter.state.grounded,{timeout:12000});
      // No reset: the next cycle uses the landed pose and existing momentum.
      await page.waitForTimeout(600);
      reports.push({backend,cycle,before,partial,lifted,errors});
    }
    assert.equal(errors.length,0);
    await page.close();
  }
} finally {
  writeFileSync('qa/peeling/report.json',JSON.stringify(reports,null,2));
  await browser.close();
}
