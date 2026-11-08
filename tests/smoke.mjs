import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import net from 'node:net';
import { gunzipSync } from 'node:zlib';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const port=32000+Math.floor(Math.random()*15000),base=`http://127.0.0.1:${port}`;
const temp=mkdtempSync(join(tmpdir(),'buono-assets-'));
const app=spawn(process.execPath,[join(root,'server.mjs')],{env:{...process.env,APP_PASSWORD:'local-test-password-23',SESSION_SECRET:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',DATA_DIR:temp,NODE_ENV:'development',PORT:String(port)},stdio:['ignore','pipe','pipe']});
let failedLog='';app.stderr.on('data',v=>failedLog+=v.toString());
async function waitForHealth(){for(let i=0;i<80;i++){try{const r=await fetch(base+'/health');if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,80));}throw Error('health endpoint failed: '+failedLog);}
async function main(){try{
 await waitForHealth();
 const health=await (await fetch(base+'/health')).json();assert.equal(health.version,14);
 const publicScript=await fetch(base+'/v13-core.js');assert.equal(publicScript.status,200);assert.ok((await publicScript.text()).includes('embedEditablePng'));
 assert.equal((await fetch(base+'/api/backup')).status,401);
 const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'local-test-password-23'})});
 assert.equal(login.status,200);const cookie=login.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
 const original=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGPcEiDyn4GBgYGJAQoAIEgCG7rNw8IAAAAASUVORK5CYII=','base64');
 const forbidden=await fetch(base+'/api/assets',{method:'POST',headers:{Cookie:cookie,Origin:'https://evil.example','Content-Type':'image/png'},body:original});assert.equal(forbidden.status,403);
 const unauthorized=await fetch(base+'/api/assets',{method:'POST',headers:{Origin:base,'Content-Type':'image/png'},body:original});assert.equal(unauthorized.status,401);
 const upload=await fetch(base+'/api/assets',{method:'POST',headers:{Cookie:cookie,Origin:base,'Content-Type':'image/png'},body:original});assert.equal(upload.status,201);
 const data=await upload.json();assert.equal(data.sha256,createHash('sha256').update(original).digest('hex'));assert.equal(data.bytes,original.length);
 const get=await fetch(base+data.url,{headers:{Cookie:cookie}});assert.equal(get.status,200);
 const bytes=Buffer.from(await get.arrayBuffer());assert.deepEqual(bytes,original);
 assert.equal((await fetch(base+data.url)).status,401);
 const uploadAgain=await fetch(base+'/api/assets',{method:'POST',headers:{Cookie:cookie,Origin:base,'Content-Type':'image/png'},body:original});assert.equal((await uploadAgain.json()).url,data.url);
 // Authenticated database + original-asset backup preserves bytes, not previews.
 const backupRes=await fetch(base+'/api/backup',{headers:{Cookie:cookie}});assert.equal(backupRes.status,200);
 const tar=gunzipSync(Buffer.from(await backupRes.arrayBuffer()));let offset=0;const archive=new Map();
 while(offset+512<=tar.length){const name=tar.toString('utf8',offset,offset+100).split('\0')[0];if(!name)break;const len=parseInt(tar.toString('ascii',offset+124,offset+136).replace(/\0/g,'').trim()||'0',8);archive.set(name,tar.subarray(offset+512,offset+512+len));offset+=512+Math.ceil(len/512)*512;}
 assert.ok(archive.has('manifest.json'));assert.ok(archive.has('buonocanvas.sqlite'));assert.deepEqual(archive.get('assets/'+data.sha256+'.png'),original);
 // Verify the separate PDF writer outputs native vector operators and a valid PDF xref/trailer.
 const context={window:{},Blob,Uint8Array,TextEncoder,Number,Math,Array,Map,Set,console};vm.createContext(context);vm.runInContext(readFileSync(join(root,'pdf-vector.js'),'utf8'),context);
 const elements=[{id:'rect',type:'rectangle',x:1,y:1,w:120,h:50,stroke:'#141414',fill:'transparent',opacity:100,strokeWidth:6},{id:'curve',type:'arrow',x:5,y:20,w:160,h:60,stroke:'#ee5500',fill:'transparent',opacity:100,strokeWidth:2}];
 const output=await context.window.BuonoVectorPDF.build({elements,bounds:{x:0,y:0,w:300,h:180},background:'#ffffff',shapePath:e=>e.type==='rectangle'?`M${e.x} ${e.y}H${e.x+e.w}V${e.y+e.h}H${e.x}Z`:'M5 20 C40 50 100 10 165 80',arrowHead:()=> 'M150 65L165 80L153 75',arrowEnds:()=>({a:{x:5,y:20},b:{x:165,y:80}}),textLayout:()=>({}),textMeasure:()=>({})});
 const pdf=Buffer.from(await output.arrayBuffer()),str=pdf.toString('latin1');assert.ok(str.startsWith('%PDF-1.4'));assert.ok(str.includes(' c\n')&&str.includes(' S\n')||str.includes('S\n'));assert.ok(str.includes('xref\n'));
 // Compressed, cacheable static files.
 const page=await fetch(base+'/',{headers:{'accept-encoding':'gzip'}});assert.equal(page.headers.get('content-encoding'),'gzip');const etag=page.headers.get('etag');assert.ok(etag);
 assert.equal((await fetch(base+'/',{headers:{'if-none-match':etag}})).status,304);
 // An upload aborted mid-body (flaky mobile network) must not take the server down.
 await new Promise(resolve=>{const sock=net.connect(port,'127.0.0.1',()=>{sock.write(`POST /api/assets HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: ${base}\r\nCookie: ${cookie}\r\nContent-Type: image/png\r\nContent-Length: 900000\r\n\r\nabc`);setTimeout(()=>{sock.destroy();resolve();},150);});});
 await new Promise(r=>setTimeout(r,200));assert.equal((await fetch(base+'/health')).status,200);
 console.log('Smoke tests passed: auth, original uploads, full photo/database backup, vector PDF, compression/ETag, aborted-upload resilience.');
}finally{app.kill('SIGTERM');rmSync(temp,{recursive:true,force:true});}}
main().catch(err=>{console.error(err);process.exitCode=1;});
