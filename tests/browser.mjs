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
 await until(()=>evaluate('!!document.querySelector("#cloudLogin")'),'initial UI');
 await evaluate('document.querySelector("#cloudPassword").value="local-test-password-23";document.querySelector("#cloudLogin").requestSubmit();true');
 await until(()=>evaluate('document.querySelector("#cloudGate")?.classList.contains("hidden") && document.querySelector("#cloudIndicator")?.classList.contains("connected")'),'cloud login + WebSocket',150);
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/tAAAAABJRU5ErkJggg==';
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
 console.log('Headless Chrome passed: login, WebSocket, original PNG upload, non-destructive crop, editable PNG download/roundtrip.');
} finally {try{ws?.close();}catch{}app.kill('SIGTERM');chrome.kill('SIGTERM');await pause(200);rmSync(dir,{recursive:true,force:true});}
