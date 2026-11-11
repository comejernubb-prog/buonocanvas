import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../v13-core.js';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const dir=mkdtempSync(join(tmpdir(),'buono-browser-'));
const downloads=join(dir,'downloads');
await import('node:fs/promises').then(x=>x.mkdir(downloads,{recursive:true}));
const port=34500+Math.floor(Math.random()*5000),debugPort=40500+Math.floor(Math.random()*5000);
const base='http://127.0.0.1:'+port;
const app=spawn(process.execPath,[join(root,'server.mjs')],{env:{...process.env,APP_PASSWORD:'local-test-password-23',SESSION_SECRET:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',DATA_DIR:dir,NODE_ENV:'development',PORT:String(port)},stdio:'ignore'});
const chromeBin=process.env.CHROME_BIN||['/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(existsSync);
if(!chromeBin)throw Error('Browser smoke requires Google Chrome installed on CI runner');
const chrome=spawn(chromeBin,['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-first-run','--disable-extensions','--remote-allow-origins=*','--remote-debugging-port='+debugPort,'--user-data-dir='+join(dir,'profile'),'about:blank'],{stdio:'ignore'});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,desc,attempts=100){for(let i=0;i<attempts;i++){try{const v=await fn();if(v)return v;}catch{}await pause(120);}throw Error('Timed out: '+desc);}
let ws,id=0;
const pending=new Map();
function rpc(method,params={}){return new Promise((resolve,reject)=>{const key=++id,p={id:key,method,params};pending.set(key,{resolve,reject});ws.send(JSON.stringify(p));});}
async function evaluate(expression){const out=await rpc('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(out.result?.exceptionDetails)throw Error('Browser JS: '+JSON.stringify(out.result.exceptionDetails));return out.result.result?.value;}
try{
 await until(async()=>{const r=await fetch(base+'/health');return r.ok},'server start');
 const target=await until(async()=>{const r=await fetch('http://127.0.0.1:'+debugPort+'/json/new?'+encodeURIComponent(base),{method:'PUT'});const x=await r.json();return x.webSocketDebuggerUrl&&x;},'Chrome DevTools');
 ws=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
 ws.onmessage=e=>{const msg=JSON.parse(e.data);if(msg.id&&pending.has(msg.id)){const p=pending.get(msg.id);pending.delete(msg.id);if(msg.error)p.reject(Error(msg.error.message));else p.resolve(msg);}};
 await rpc('Page.enable');await rpc('Runtime.enable');
 await rpc('Page.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
 await until(()=>evaluate('!!document.querySelector("#cloudLogin") && document.querySelectorAll("#toolbar .tool").length>5 && document.querySelector("#cloudMessage")?.textContent?.includes("Enter the access code")'),'completed app initialization');
 await evaluate('document.querySelector("#cloudPassword").value="local-test-password-23";document.querySelector("#cloudLogin").requestSubmit();true');
 try{await until(()=>evaluate('document.querySelector("#cloudGate")?.classList.contains("hidden") && document.querySelector("#cloudIndicator")?.classList.contains("connected")'),'cloud login + WebSocket',150);}catch(err){console.error('Login diagnostic',await evaluate('JSON.stringify({gate:document.querySelector("#cloudGate")?.className,message:document.querySelector("#cloudMessage")?.textContent,save:document.querySelector("#saveLabel")?.textContent,session:document.cookie,toolbar:document.querySelectorAll("#toolbar .tool").length})'));throw err;}
 const png='iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGPcEiDyn4GBgYGJAQoAIEgCG7rNw8IAAAAASUVORK5CYII=';
 const upload='(()=>{const bytes=Uint8Array.from(atob("'+png+'"),c=>c.charCodeAt(0));const input=document.querySelector("#imageInput");const transfer=new DataTransfer();transfer.items.add(new File([bytes],"smoke.png",{type:"image/png"}));input.files=transfer.files;input.dispatchEvent(new Event("change",{bubbles:true}));return true})()';
 await evaluate(upload);
 await until(()=>evaluate('document.querySelector("#elementCount")?.textContent?.startsWith("1 ")'),'image imported',120);
 await until(()=>evaluate('!!document.querySelector("[data-v13-crop=left]")'),'image inspector');
 await evaluate('(()=>{const e=document.querySelector("[data-v13-crop=left]");e.value="10";e.dispatchEvent(new Event("change",{bubbles:true}));return true})()');
 await until(()=>evaluate('document.querySelector("[data-v13-crop=left]")?.value==="10"'),'crop saved to inspector');
 await evaluate('document.querySelector("#exportBtn").click();document.querySelector("[data-export=editable-png]").click();true');
 const filepath=await until(()=>{const files=readdirSync(downloads).filter(s=>s.endsWith('-editable.png'));return files.length?join(downloads,files[0]):null},'editable PNG download',140);
 const metadata=globalThis.BuonoV13.readEditablePng(readFileSync(filepath));
 assert.equal(metadata.type,'buonocanvas-editable-png');
 assert.equal(metadata.document.elements.length,1);
 assert.ok(Math.abs(metadata.document.elements[0].crop.x-.1)<.001);

 // Test real Chromium input: Smart Hand defaults to pan and auto-selects when hovering objects.
 assert.equal(await evaluate("document.querySelector('#tool-hand').classList.contains('active')"),true,'Hand is the default tool');
 const stageRect=await evaluate('(()=>{const r=document.querySelector("#drawing").getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()');
 const blank={x:Math.round(stageRect.x+stageRect.w*.12),y:Math.round(stageRect.y+stageRect.h*.78)};
 const camera=async()=>{const raw=await evaluate('document.querySelector("#drawing > g")?.getAttribute("transform")');const values=raw.match(/-?[0-9]+(?:\\.[0-9]+)?/g).map(Number);return{x:values[0],y:values[1],z:values[2]};};
 const move=async(x,y,button='none',buttons=0)=>rpc('Input.dispatchMouseEvent',{type:'mouseMoved',x,y,button,buttons});
 const down=async(x,y,button='left',buttons=1)=>rpc('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button,buttons,clickCount:1});
 const up=async(x,y,button='left')=>rpc('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button,buttons:0,clickCount:1});
 await move(blank.x,blank.y);await pause(50);
 assert.equal(await evaluate("document.querySelector('#drawing').classList.contains('auto-select-hover')"),false);
 const first=await camera();
 await down(blank.x,blank.y);await move(blank.x+64,blank.y+31,'left',1);await up(blank.x+64,blank.y+31);await pause(70);
 const afterLeftPan=await camera();
 assert.ok(Math.abs(afterLeftPan.x-first.x-64)<4,'dragging blank canvas pans smoothly from first pixel');
 assert.ok(Math.abs(afterLeftPan.y-first.y-31)<4,'blank canvas vertical pan follows pointer');
 const mp={x:blank.x+64,y:blank.y+31};
 await down(mp.x,mp.y,'middle',4);await move(mp.x-46,mp.y-24,'middle',4);await up(mp.x-46,mp.y-24,'middle');await pause(75);
 const afterMiddle=await camera();
 assert.ok(Math.abs(afterMiddle.x-afterLeftPan.x+46)<4,'middle drag immediately pans horizontally');
 assert.ok(Math.abs(afterMiddle.y-afterLeftPan.y+24)<4,'middle drag immediately pans vertically');
 const wheel={x:mp.x-46,y:mp.y-24};const beforeZoom=await camera();
 await rpc('Input.dispatchMouseEvent',{type:'mouseWheel',x:wheel.x,y:wheel.y,deltaX:0,deltaY:-120});
 await pause(75);const afterZoom=await camera();
 assert.ok(afterZoom.z>beforeZoom.z,'mouse wheel zooms canvas');
 const wx=wheel.x-stageRect.x,wy=wheel.y-stageRect.y;
 const anchorBefore={x:(wx-beforeZoom.x)/beforeZoom.z,y:(wy-beforeZoom.y)/beforeZoom.z};
 const anchorAfter={x:(wx-afterZoom.x)/afterZoom.z,y:(wy-afterZoom.y)/afterZoom.z};
 assert.ok(Math.hypot(anchorBefore.x-anchorAfter.x,anchorBefore.y-anchorAfter.y)<1.5,'zoom remains anchored below the mouse pointer');
 await rpc('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 await rpc('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 await pause(40);
 const imageRect=await evaluate('(()=>{const e=document.querySelector("#drawing [data-id]");if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()');
 assert.ok(imageRect&&imageRect.w>5&&imageRect.h>5,'imported image is visible');
 const object={x:Math.round(imageRect.x+imageRect.w/2),y:Math.round(imageRect.y+imageRect.h/2)};
 await move(object.x,object.y);await pause(95);
 assert.equal(await evaluate("document.querySelector('#drawing').classList.contains('auto-select-hover')"),true,'hovering an object activates smart selection');
 await down(object.x,object.y);await up(object.x,object.y);await pause(100);
 const title=await evaluate("document.querySelector('#inspectorTitle')?.textContent||''");
 assert.match(title,/Image/i,'clicking an object in Smart Hand selects it');

 console.log('Headless Chrome passed: Smart Hand, left/middle drag, pointer-anchored zoom, image auto-selection, auth, Cloud Sync, PNG export.');
} finally {try{ws?.close();}catch{}app.kill('SIGTERM');chrome.kill('SIGTERM');await pause(200);rmSync(dir,{recursive:true,force:true});}
