import { chromium } from 'file:///C:/Users/kkjjw/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const browser = await chromium.launch({channel:'msedge',headless:true});
const report = { errors:[], cases:[] };
mkdirSync('qa/stretch',{recursive:true});
try {
  const page = await browser.newPage({viewport:{width:1440,height:960}});
  page.on('pageerror',e=>report.errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  // Expose live scene objects only in this isolated diagnostic browser, without editing the app.
  await page.route('**/src/main.js',async route=>{
    const response = await route.fetch();
    const original = await response.text();
    await route.fulfill({response,body:original+'\nwindow.__probe = { state, uniforms, THREE, get material(){return material;}, get jelly(){return jelly;}, get scene(){return scene;}, get renderer(){return renderer;}, get camera(){return camera;}, freeze(){paused=true;}, updateHitSurface, get proxy(){return proxy;}, elasticPoint };'});
  });
  await page.goto('http://127.0.0.1:5174',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.__softMatter?.state.ready);
  for(const [name,start,end] of [['moderate',[795,465],[940,310]],['extreme-up',[795,465],[1070,120]]]) {
    await page.locator('#reset').click();
    await page.mouse.move(...start);await page.mouse.down();
    await page.mouse.move(...end,{steps:24});await page.waitForTimeout(1100);
    await page.screenshot({path:`qa/stretch/${name}.png`});
    report.cases.push({name,state:await page.evaluate(()=>window.__softMatter.state)});
    await page.mouse.up();
  }
  await page.locator('#reset').click();await page.mouse.move(795,465);await page.mouse.down();
  await page.mouse.move(1070,120,{steps:24});await page.waitForTimeout(1300);
  await page.evaluate(()=>window.__probe.freeze());
  await page.screenshot({path:'qa/stretch/frozen.png'});
  report.frozen=await page.evaluate(()=>({state:window.__softMatter.state,grabPoint:window.__probe.uniforms.grabPoint.value.toArray()}));
  await page.evaluate(()=>{
    const p=window.__probe;
    p.jelly.material=new p.THREE.MeshNormalMaterial();
    // The CPU picking shell follows the same elastic map and reveals folds without refraction.
    p.updateHitSurface();p.proxy.geometry.computeVertexNormals();p.proxy.material=new p.THREE.MeshNormalMaterial({side:p.THREE.DoubleSide});
    p.jelly.visible=false;p.scene.add(p.proxy);
  });
  await page.waitForTimeout(400);await page.screenshot({path:'qa/stretch/deformed-normals.png'});
  await page.evaluate(()=>{const p=window.__probe;p.scene.remove(p.proxy);p.jelly.visible=true;p.jelly.material=p.material;p.material.envMapIntensity=0;p.material.clearcoat=0;p.material.needsUpdate=true;});
  await page.waitForTimeout(500);await page.screenshot({path:'qa/stretch/no-reflections.png'});
  await page.evaluate(()=>{
    const p=window.__probe;
    // Compare the CPU-deformed surface with matching mesh normals, using the same gel material.
    p.jelly.visible=false;p.scene.add(p.proxy);
    const m=p.material.clone();m.positionNode=null;m.normalNode=null;m.clearcoatNormalNode=null;
    m.thicknessNode=null;m.thickness=2.6;m.envMapIntensity=1.35;m.clearcoat=1;
    p.proxy.material=m;
  });
  await page.waitForTimeout(1000);await page.screenshot({path:'qa/stretch/matching-geometry-normals.png'});
  console.log(JSON.stringify(report,null,2));
} finally {writeFileSync('qa/stretch/report.json',JSON.stringify(report,null,2));await browser.close();}
