import fs from 'node:fs';
import {PNG} from 'pngjs';
import {chromium} from '@playwright/test';
const out=process.argv[2]??'work/reference-silhouette';fs.mkdirSync(out,{recursive:true});
const measurements=fs.existsSync('work/clothing-reference/measurements.json')?'work/clothing-reference/measurements.json':'docs/release/clothing-reference-measurements-0.3.0.json';
const references=JSON.parse(fs.readFileSync(measurements,'utf8')).references;
const selected=process.argv.slice(3);
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--force_high_performance_gpu']});
const page=await browser.newPage({viewport:{width:1000,height:1000}});await page.routeWebSocket('**',()=>{});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
function mask(png,reference){
  const pixels=new Uint8Array(png.width*png.height);let x0=png.width,y0=png.height,x1=0,y1=0;
  for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++){
    const i=(y*png.width+x)*4;
    const inside=reference?png.data[i+3]>=128:(png.data[i]+png.data[i+1]+png.data[i+2])>384;
    if(inside){pixels[y*png.width+x]=1;x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y)}
  }
  const w=1600,h=1000,result=new Uint8Array(w*h),scale=900/(y1-y0+1),center=(x0+x1)/2;
  for(let y=50;y<950;y++)for(let x=0;x<w;x++){
    const px=Math.round(center+(x-w/2)/scale),py=Math.round(y0+(y-50)/scale);
    if(px>=0&&px<png.width&&py>=0&&py<png.height)result[y*w+x]=pixels[py*png.width+px];
  }
  return {pixels:result,aspect:(x1-x0+1)/(y1-y0+1)};
}
const report={errors,products:[]};
try{
  await page.goto('http://127.0.0.1:1420/tests/realism-probe.html');
  for(const ref of references.filter(r=>!selected.length||selected.includes(r.id))){
    const capture=await page.evaluate(async id=>{
      const {StudioScene}=await import('/src/scene/StudioScene.ts');
      const {createDefaultProject}=await import('/src/project/index.ts');
      const {Color,Box3,Vector3,MeshBasicMaterial,DoubleSide}=await import('/node_modules/.vite/deps/three.js');
      const s=createDefaultProject(id);s.realism.mode='fast';
      const live=new StudioScene(document.querySelector('#host'),s,()=>{});await live.loadProject(s);
      const box=new Box3().setFromObject(live.mat),size=box.getSize(new Vector3()),center=box.getCenter(new Vector3());
      live.floor.visible=false;live.background.visible=false;live.references.visible=false;
      live.scene.background=new Color(0);live.scene.fog=null;
      const flat=new MeshBasicMaterial({color:0xffffff,side:DoubleSide});live.scene.overrideMaterial=flat;
      live.camera.far=200;live.rig.controls.maxDistance=150;
      const distance=Math.max(size.x,size.y)/(2*.87*Math.tan(Math.PI/360));
      live.rig.restore({preset:'perspective',position:[center.x,center.y,distance],target:[center.x,center.y,0],fovDeg:1});
      const bytes=Array.from(new Uint8Array(await(await live.exportPng({widthPx:1000,heightPx:1000})).arrayBuffer()));
      live.scene.overrideMaterial=null;flat.dispose();live.dispose();return {bytes,geometryAspect:size.x/size.y};
    },ref.id);
    const rendered=PNG.sync.read(Buffer.from(capture.bytes));fs.writeFileSync(`${out}/${ref.id}-silhouette.png`,Buffer.from(capture.bytes));
    const source=PNG.sync.read(fs.readFileSync(`C:/Users/alast/OneDrive/Рабочий стол/DTF — белые заготовки/${ref.file}`));
    const a=mask(source,true),b=mask(rendered,false);let intersection=0,union=0;
    const comparison=new PNG({width:1600,height:1000});
    for(let i=0;i<a.pixels.length;i++){
      const photo=a.pixels[i],model=b.pixels[i];intersection+=photo&&model?1:0;union+=photo||model?1:0;
      comparison.data.set(photo&&model?[235,235,235,255]:photo?[210,80,150,255]:model?[70,170,220,255]:[25,28,32,255],i*4);
    }
    fs.writeFileSync(`${out}/${ref.id}-comparison.png`,PNG.sync.write(comparison));
    const result={id:ref.id,photoAspect:a.aspect,renderAspect:b.aspect,geometryAspect:capture.geometryAspect,intersectionOverUnion:intersection/union};
    report.products.push(result);console.log(JSON.stringify(result));
  }
  fs.writeFileSync(`${out}/silhouette-report.json`,JSON.stringify(report,null,2));
}finally{await browser.close()}
