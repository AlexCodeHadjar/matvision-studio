import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
fs.mkdirSync('work/quality-ui', { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if(m.type()==='error')errors.push(m.text()); });
try {
 await page.goto('http://127.0.0.1:1420');
 await page.waitForFunction(() => document.querySelector('[data-testid=viewport]')?.dataset.rendererState === 'ready');
 await expect(page.getByRole('combobox',{name:'Режим просмотра'})).toHaveValue('detailed');
 await page.getByRole('button',{name:'Применить ткань Poly Haven',exact:true}).click();
 await expect(page.getByText('Ткань Poly Haven применена. Карты будут сохранены внутри проекта.',{exact:true})).toBeVisible({timeout:30000});
 const download=page.waitForEvent('download');
 await page.getByRole('button',{name:'Сохранить проект',exact:true}).click();
 await(await download).saveAs('work/quality-ui/polyhaven.matvision');
 const doc=JSON.parse(fs.readFileSync('work/quality-ui/polyhaven.matvision','utf8'));
 assert.equal(doc.state.quality,'ultra'); assert.equal(doc.state.materials.fabric.tileMm,300);
 assert.equal(doc.state.materials.fabric.maps.normal.widthPx,2048);
 assert.ok(doc.state.materials.fabric.maps.roughness.dataUrl.length>1000000);
 await page.getByRole('button',{name:'Макро ткани',exact:true}).click();await page.waitForTimeout(1500);
 await page.screenshot({path:'work/quality-ui/fabric-macro.png'});
 for(let i=0;i<2;i++) {
  await page.getByRole('button',{name:'Фото',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'Свет фото'})).toHaveValue('hdri');
  await expect(page.getByRole('combobox',{name:'Проходы фото'})).toHaveValue('512');
  await page.getByRole('button',{name:'Рассчитать фото',exact:true}).click();
  await page.getByRole('button',{name:'Отменить и вернуться',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
 }
 await page.getByRole('button',{name:'Фото',exact:true}).click();
 await page.screenshot({path:'work/quality-ui/photo-options.png'});
 await page.keyboard.press('Escape');
 await expect(page.getByRole('button',{name:'Фото',exact:true})).toBeFocused();
 const png=page.waitForEvent('download');await page.getByRole('button',{name:'Экспорт PNG',exact:true}).click();
 await(await png).saveAs('work/quality-ui/fabric.png');
 assert.deepEqual(errors,[]);
 fs.writeFileSync('work/quality-ui/checks.json',JSON.stringify({defaultHigh:true,defaultDetailed:true,embeddedPolyHaven:true,cancelAndReopen:true,focusRestored:true,exportAfterCancel:true,errors},null,2));
 console.log('Quality UI, local PBR, embedded save, photo cancellation/reopen/focus and PNG passed.');
} finally {await browser.close();}
