import { chromium } from 'file:///C:/Users/kkjjw/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { createReadStream, statSync, mkdirSync, writeFileSync } from 'node:fs';
const file = 'C:/Users/kkjjw/Downloads/SaveTwitter.Net_LiHyRV7gDMN4Stbx_(1080p).mp4';
const size = statSync(file).size;
const server = createServer((req,res) => {
  if(req.url !== '/video') { res.setHeader('Content-Type','text/html'); res.end('<video src="/video" muted></video>'); return; }
  const range = req.headers.range;
  if(range) {
    const [startText,endText] = range.replace('bytes=','').split('-');
    const start = Number(startText), end = endText ? Number(endText) : size-1;
    res.writeHead(206, {'Content-Type':'video/mp4','Accept-Ranges':'bytes','Content-Range':`bytes ${start}-${end}/${size}`,'Content-Length':end-start+1});
    createReadStream(file,{start,end}).pipe(res);
  } else { res.writeHead(200,{'Content-Type':'video/mp4','Content-Length':size}); createReadStream(file).pipe(res); }
});
await new Promise(resolve=>server.listen(5175,'127.0.0.1',resolve));
let browser;
try {
  browser = await chromium.launch({channel:'msedge',headless:true});
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5175');
  await page.waitForFunction(()=>document.querySelector('video').readyState>=2);
  const meta = await page.evaluate(()=>{ const v=document.querySelector('video'); return {duration:v.duration,width:v.videoWidth,height:v.videoHeight}; });
  console.log(JSON.stringify(meta));
  mkdirSync('qa',{recursive:true});
  for(let i=0;i<5;i++) {
    const data=await page.evaluate(async t=>{
      const v=document.querySelector('video');
      await new Promise(resolve=>{v.onseeked=resolve;v.currentTime=t;});
      const c=document.createElement('canvas'); c.width=v.videoWidth;c.height=v.videoHeight;
      c.getContext('2d').drawImage(v,0,0);return c.toDataURL('image/jpeg',.85).split(',')[1];
    },Math.max(.1,meta.duration*(.06+i*.21)));
    writeFileSync(`qa/reference-${i}.jpg`,Buffer.from(data,'base64'));
  }
} finally { await browser?.close(); server.close(); }
