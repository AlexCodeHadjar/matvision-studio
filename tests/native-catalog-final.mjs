import {chromium} from '@playwright/test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const out='work/native-catalog-final-0.3.0';fs.mkdirSync(out,{recursive:true});
const expected=JSON.parse(fs.readFileSync('public/models/catalog/manifest.json','utf8'));
const browser=await chromium.connectOverCDP(process.env.NATIVE_CDP??'http://127.0.0.1:9341');
const page=browser.contexts()[0].pages().find(p=>p.url().includes('tauri.localhost'));
assert.ok(page);page.setDefaultTimeout(45000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
  await page.waitForFunction(()=>document.querySelector('[data-testid="viewport"]')?.dataset.rendererState==='ready');
  const runtime=await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('runtime_info',{}));
  assert.equal(runtime.appVersion,'0.3.0');
  const manifest=await page.evaluate(async()=>{
    const r=await fetch('/models/catalog/manifest.json',{cache:'no-store'});
    if(!r.ok)throw Error('Bundled manifest missing');return r.json();
  });
  assert.equal(manifest.sourceHash,expected.sourceHash,'Native EXE must contain the final source revision');
  assert.deepEqual(manifest.models.map(m=>({id:m.id,sha256:m.sha256})),expected.models.map(m=>({id:m.id,sha256:m.sha256})));
  const switches=[];
  for(const [label,id] of [['Худи','hoodie-white'],['Свитшот','sweatshirt-white'],['Лонгслив','longsleeve-white']]){
    const start=Date.now();await page.getByRole('button',{name:label,exact:true}).click();
    await page.waitForFunction(id=>document.querySelector('[aria-label="Продукт"]').value===id&&!document.querySelector('[aria-label="Продукт"]').disabled,id);
    const readyMs = Date.now()-start;
    assert.ok(readyMs < 6000, `${id} switching exceeded 6 seconds`);
    switches.push({id,readyMs});
    await page.screenshot({path:`${out}/${id}-ui.png`});
  }
  assert.deepEqual(errors,[]);
  fs.writeFileSync(`${out}/report.json`,JSON.stringify({runtime,sourceHash:manifest.sourceHash,models:manifest.models.map(m=>({id:m.id,sha256:m.sha256})),switches,errors},null,2));
  console.log(JSON.stringify({runtime,switches,errors,finalModelsVerified:true}));
}finally{await browser.close()}
