import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const output='work/native-merch-0.2.1';fs.mkdirSync(output,{recursive:true});
const browser=await chromium.connectOverCDP('http://127.0.0.1:9337');
const page=browser.contexts()[0].pages().find(p=>p.url().includes('tauri.localhost'));
assert.ok(page,'Native WebView must be running');page.setDefaultTimeout(90000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const materials=[];page.on('response',r=>{if(r.url().includes('cotton-jersey'))materials.push({url:r.url(),status:r.status()})});
await page.waitForFunction(()=>document.querySelector('[data-testid="viewport"]')?.dataset.rendererState==='ready');
const runtime=await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('runtime_info',{}));
assert.equal(runtime.appVersion,'0.2.1');
for(const [label,id]of [['Футболка','tshirt-gildan-5000'],['Кружка','mug-11oz'],['Коврик','deskmat-900x400']]){
 await page.getByRole('button',{name:label,exact:true}).click();
 await page.waitForFunction(id=>document.querySelector('[aria-label="Продукт"]')?.value===id&&!document.querySelector('[aria-label="Продукт"]').disabled,id,{timeout:90000});
 await page.waitForTimeout(500);await page.screenshot({path:`${output}/${id}.png`});
}
assert.deepEqual(errors,[]);assert.ok(materials.length>=3);assert.ok(materials.every(m=>m.status===200));
await page.getByRole('button',{name:'Футболка',exact:true}).click();
await page.waitForFunction(()=>document.querySelector('[aria-label="Продукт"]')?.value==='tshirt-gildan-5000'&&!document.querySelector('[aria-label="Продукт"]').disabled);
await page.getByLabel('Продукт',{exact:true}).selectOption('tshirt-bella-3001');
await page.waitForFunction(()=>document.querySelector('[aria-label="Продукт"]').value==='tshirt-bella-3001'&&!document.querySelector('[aria-label="Продукт"]').disabled);
await page.screenshot({path:`${output}/tshirt-bella-3001.png`});
fs.writeFileSync(`${output}/report.json`,JSON.stringify({runtime,materials,errors,productSwitching:true},null,2));
console.log(JSON.stringify({runtime,materialRequests:materials.length,errors,productSwitching:true}));
await browser.close();
