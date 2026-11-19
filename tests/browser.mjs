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
const workerUrl=process.env.BUONOCANVAS_TEST_WORKER_URL;
const base=workerUrl||'http://127.0.0.1:'+port;
const app=workerUrl?null:spawn(process.execPath,[join(root,'server.mjs')],{env:{...process.env,APP_PASSWORD:'local-test-password-23',SESSION_SECRET:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',DATA_DIR:dir,NODE_ENV:'development',PORT:String(port)},stdio:'ignore'});
const chromeBin=process.env.CHROME_BIN||['/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(existsSync);
if(!chromeBin)throw Error('Browser smoke requires Google Chrome installed on CI runner');
const chrome=spawn(chromeBin,['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-first-run','--disable-extensions','--remote-allow-origins=*','--remote-debugging-port='+debugPort,'--user-data-dir='+join(dir,'profile'),'about:blank'],{stdio:'ignore'});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,desc,attempts=100){for(let i=0;i<attempts;i++){try{const v=await fn();if(v)return v;}catch{}await pause(120);}throw Error('Timed out: '+desc);}
let ws,id=0;
const pending=new Map();
function rpc(method,params={}){return new Promise((resolve,reject)=>{const key=++id,p={id:key,method,params};pending.set(key,{resolve,reject,method});ws.send(JSON.stringify(p));});}
async function evaluate(expression){const out=await rpc('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(out.result?.exceptionDetails)throw Error('Browser JS: '+JSON.stringify(out.result.exceptionDetails));return out.result.result?.value;}
try{
 await until(async()=>{const r=await fetch(base+'/health');return r.ok},'server start');
 const target=await until(async()=>{const r=await fetch('http://127.0.0.1:'+debugPort+'/json/new?'+encodeURIComponent('about:blank'),{method:'PUT'});const x=await r.json();return x.webSocketDebuggerUrl&&x;},'Chrome DevTools');
 ws=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
 ws.onmessage=e=>{const msg=JSON.parse(e.data);if(msg.id&&pending.has(msg.id)){const p=pending.get(msg.id);pending.delete(msg.id);if(msg.error)p.reject(Error(p.method+': '+msg.error.message));else p.resolve(msg);}};
 await rpc('Page.enable');await rpc('Runtime.enable');
 await rpc('Page.addScriptToEvaluateOnNewDocument',{source:`
  const NativeSocket=window.WebSocket;
  window.WebSocket=class extends NativeSocket {
   constructor(...args){
    super(...args);
    this.addEventListener('message',event=>{
     const message=JSON.parse(event.data);
     if(window.dropUndoAck&&message.type==='delta'&&message.ops.some(op=>op.id===window.testStroke&&op.value===null)){
      window.dropUndoAck=false;
      event.stopImmediatePropagation();
      document.querySelector('#tool-redo').click();
      this.close();
     }
    });
   }
  };
 `});
 await rpc('Page.navigate',{url:base});
 await until(()=>evaluate('document.querySelectorAll("#toolbar .tool").length>5'),'completed app initialization');
 await rpc('Page.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
 if(!workerUrl){
  await until(()=>evaluate('!!document.querySelector("#cloudLogin") && document.querySelectorAll("#toolbar .tool").length>5 && document.querySelector("#cloudMessage")?.textContent?.includes("Enter the access code")'),'completed app initialization');
  await evaluate('document.querySelector("#cloudPassword").value="local-test-password-23";document.querySelector("#cloudLogin").requestSubmit();true');
 }
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
 await evaluate(`(() => {
  window.testMessages=[];
  window.testPeer=new WebSocket(location.origin.replace(/^http/,'ws')+'/ws');
  testPeer.onopen=()=>testPeer.send(JSON.stringify({type:'intro',name:'Second device'}));
  testPeer.onmessage=({data})=>testMessages.push(JSON.parse(data));
  window.testPointer=(type,id,device,x,y)=>{
   const canvas=document.querySelector('#drawing'),rect=canvas.getBoundingClientRect();
   canvas.dispatchEvent(new PointerEvent(type,{
    bubbles:true,pointerId:id,pointerType:device,clientX:rect.left+x,clientY:rect.top+y,
    button:type==='pointermove'?-1:0,buttons:type==='pointerdown'||type==='pointermove'?1:0
   }));
  };
  return true;
 })()`);
 const boardId=await until(()=>evaluate("testMessages.find(m=>m.type==='welcome')?.boards[0]?.id"),'second device connected');
 const countIs=n=>evaluate(`document.querySelector('#elementCount').textContent.startsWith('${n} ')`);
 const strokeOp=rev=>evaluate(`testMessages.flatMap(m=>m.ops||[]).find(op=>op.rev===${rev}&&op.id===window.testStroke)`);
 await evaluate(`document.querySelector('#tool-pencil').click();
  testPointer('pointerdown',21,'touch',60,90);
  testPointer('pointerdown',22,'touch',85,90);
  testPointer('pointerdown',23,'pen',100,100);
  testPointer('pointermove',21,'touch',180,160);
  testPointer('pointermove',23,'pen',120,130);
  testPointer('pointerup',21,'touch',180,160);
  testPointer('pointerup',22,'touch',85,90);
  true;`);
 await until(()=>countIs(2),'local pencil preview');
 await pause(250);
 assert.equal(await evaluate("testMessages.some(m=>m.ops?.some(op=>op.value?.type==='pencil'))"),false,'unfinished strokes stay local');
 await evaluate("testPointer('pointerup',23,'pen',155,140);true");
 const original=await until(()=>evaluate("testMessages.flatMap(m=>m.ops||[]).find(op=>op.value?.type==='pencil')"),'completed pencil stroke reaches second device');
 assert.equal(original.value.points.at(-1).x-original.value.points[0].x,55);
 assert.equal(original.value.points.at(-1).y-original.value.points[0].y,40);
 await evaluate(`window.testStroke=${JSON.stringify(original.id)};
  testPeer.send(JSON.stringify({
   type:'patch',reqId:'peer-add',boardId:${JSON.stringify(boardId)},
   ops:[{id:'peerShape',baseRev:0,value:{id:'peerShape',type:'rectangle',x:30,y:40,w:90,h:40}}]
  }));true;`);
 await until(()=>countIs(3),'second device edit visible');
 await evaluate("window.dropUndoAck=true;document.querySelector('#tool-undo').click();true");
 await until(()=>strokeOp(3),'redo survives missing undo acknowledgement and reconnect');
 assert.equal(await countIs(3),true,'redo preserves second device edit');
 await evaluate("document.querySelector('#tool-undo').click();true");
 assert.equal((await until(()=>strokeOp(4),'undo after reconnection')).value,null);
 await until(()=>countIs(2),'undo preserves second device edit');
 await evaluate("testPointer('pointerdown',24,'pen',80,80);testPointer('pointercancel',24,'pen',100,100);true");
 await until(()=>countIs(2),'cancelled pencil input leaves no stroke');
 await evaluate("document.querySelector('#tool-redo').click();true");
 assert.ok((await until(()=>strokeOp(5),'redo after acknowledged deletion')).value);
 await evaluate('testPeer.close();true');
 console.log('Headless Chrome passed: login, WebSocket, original PNG upload, non-destructive crop, editable PNG roundtrip, pen and palm input, two-client sync, and undo/redo across reconnect.');
} finally {try{ws?.close();}catch{}app?.kill('SIGTERM');chrome.kill('SIGTERM');await pause(200);rmSync(dir,{recursive:true,force:true});}
