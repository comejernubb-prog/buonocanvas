import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import net from 'node:net';

const port=34000+Math.floor(Math.random()*18000),base='http://127.0.0.1:'+port;
const folder=mkdtempSync(join(tmpdir(),'buonocanvas-realtime-test-'));
const env={...process.env,APP_PASSWORD:'realtime-test-only-1234',SESSION_SECRET:'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',DATA_DIR:folder,NODE_ENV:'development',PORT:String(port)};
const child=spawn(process.execPath,['server.mjs'],{env,stdio:['ignore','pipe','pipe']});
let stderr='';child.stderr.on('data',x=>stderr+=x.toString());
async function health(){for(let n=0;n<100;n++){try{const r=await fetch(base+'/health');if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,70));}throw Error('Server did not start: '+stderr);}

class Peer{
 constructor(socket){this.socket=socket;this.buffer=Buffer.alloc(0);this.messages=[];this.waiters=[];this.open=false;
  socket.on('data',chunk=>this.onData(chunk));
  socket.on('error',()=>{});
 }
 static connect(cookie){
  return new Promise((resolve,reject)=>{
   let peer,done=false;
   const socket=net.connect(port,'127.0.0.1',()=>{
    const key=randomBytes(16).toString('base64');
    socket.write('GET /ws HTTP/1.1\r\nHost: 127.0.0.1:'+port+'\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: '+key+'\r\nSec-WebSocket-Version: 13\r\nOrigin: '+base+'\r\nCookie: '+cookie+'\r\n\r\n');
   });
   peer=new Peer(socket);
   peer.onOpen=()=>{if(!done){done=true;clearTimeout(timer);resolve(peer);}};
   const timer=setTimeout(()=>{if(!done){done=true;socket.destroy();reject(Error('Handshake timeout'));}},3500);
   socket.on('close',()=>{if(!done){done=true;clearTimeout(timer);reject(Error('Websocket closed before handshake'));}});
  });
 }
 onData(chunk){
  this.buffer=Buffer.concat([this.buffer,chunk]);
  if(!this.open){
   const end=this.buffer.indexOf('\r\n\r\n');if(end===-1)return;
   const head=this.buffer.subarray(0,end).toString('latin1');assert.match(head,/^HTTP\/1\.1 101 Switching Protocols/m);
   this.buffer=this.buffer.subarray(end+4);this.open=true;this.onOpen?.();
  }
  while(this.buffer.length>=2){
   const b0=this.buffer[0],opcode=b0&15,masked=!!(this.buffer[1]&0x80);
   assert.equal(masked,false,'server websocket frames must not be masked');
   let len=this.buffer[1]&127,off=2;
   if(len===126){if(this.buffer.length<4)return;len=this.buffer.readUInt16BE(2);off=4;}
   else if(len===127){if(this.buffer.length<10)return;len=Number(this.buffer.readBigUInt64BE(2));off=10;}
   if(this.buffer.length<off+len)return;
   const data=this.buffer.subarray(off,off+len);this.buffer=this.buffer.subarray(off+len);
   if(opcode===9){this.sendFrame(10,data);continue;}
   if(opcode===8)continue;
   if(opcode!==1)continue;
   const msg=JSON.parse(data.toString('utf8'));
   const index=this.waiters.findIndex(w=>w.type===msg.type);
   if(index===-1)this.messages.push(msg);
   else{const [waiter]=this.waiters.splice(index,1);clearTimeout(waiter.timer);waiter.resolve(msg);}
  }
 }
 sendFrame(opcode,buf){
  buf=Buffer.isBuffer(buf)?buf:Buffer.from(buf);
  const mask=randomBytes(4),ext=buf.length<126?0:buf.length<65536?2:8;
  const frame=Buffer.alloc(2+ext+4+buf.length);frame[0]=0x80|opcode;frame[1]=0x80|(ext?ext===2?126:127:buf.length);
  if(ext===2)frame.writeUInt16BE(buf.length,2);else if(ext===8)frame.writeBigUInt64BE(BigInt(buf.length),2);
  const offset=2+ext;mask.copy(frame,offset);
  for(let i=0;i<buf.length;i++)frame[offset+4+i]=buf[i]^mask[i&3];
  this.socket.write(frame);
 }
 send(obj){this.sendFrame(1,Buffer.from(JSON.stringify(obj)));}
 wait(type,ms=3500){const at=this.messages.findIndex(m=>m.type===type);if(at>=0)return Promise.resolve(this.messages.splice(at,1)[0]);
  return new Promise((resolve,reject)=>{const entry={type,resolve,timer:null};entry.timer=setTimeout(()=>{this.waiters=this.waiters.filter(w=>w!==entry);reject(Error('Timeout waiting '+type+' '+stderr));},ms);this.waiters.push(entry);});}
 close(){this.socket.destroy();}
}

async function main(){
 let alice,bob,alice2;
 try{
  await health();
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:env.APP_PASSWORD})});
  assert.equal(login.status,200);const cookie=login.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
  alice=await Peer.connect(cookie);alice.send({type:'intro',name:'Windows'});
  const w1=await alice.wait('welcome');assert.ok(w1.actor);
  bob=await Peer.connect(cookie);bob.send({type:'intro',name:'iPad'});
  const w2=await bob.wait('welcome');assert.ok(w2.actor);assert.notEqual(w1.actor,w2.actor);
  const diagnostics=await (await fetch(base+'/api/diagnostics',{headers:{Cookie:cookie}})).json();assert.ok(diagnostics.activeWebSockets>=2);assert.ok(diagnostics.webSocketsOpened>=2);
  alice.send({type:'ping',t:12345});assert.equal((await alice.wait('pong')).t,12345);
  const boardId='device_test_'+Date.now();
  alice.send({type:'boardCreate',reqId:'r1',board:{id:boardId,name:'Devices',background:'#ffffff',grid:false}});
  const [madeA,madeB]=await Promise.all([alice.wait('boardCreated'),bob.wait('boardCreated')]);
  assert.equal(madeA.board.id,boardId);assert.equal(madeB.board.id,boardId);
  const shape={id:'rect1',type:'rectangle',x:20,y:30,w:120,h:90,stroke:'#222222',fill:'transparent',strokeWidth:2};
  alice.send({type:'patch',reqId:'r2',boardId,ops:[{id:'rect1',baseRev:0,value:shape}],meta:null,baseMetaRev:1});
  const [deltaA,deltaB]=await Promise.all([alice.wait('delta'),bob.wait('delta')]);
  assert.equal(deltaA.ops[0].id,'rect1');assert.equal(deltaB.ops[0].value.x,20);
  const updated={...shape,x:82};
  bob.send({type:'patch',reqId:'r3',boardId,ops:[{id:'rect1',baseRev:1,value:updated}],meta:null,baseMetaRev:1});
  const [changedA,changedB]=await Promise.all([alice.wait('delta'),bob.wait('delta')]);
  assert.equal(changedA.ops[0].value.x,82);assert.equal(changedB.ops[0].rev,2);
  alice.close(); // simulate a Windows tab losing its network connection
  await new Promise(r=>setTimeout(r,100));
  alice2=await Peer.connect(cookie);alice2.send({type:'intro',name:'Windows reconnected'});
  const rejoined=await alice2.wait('welcome');const board=rejoined.boards.find(b=>b.id===boardId);
  assert.ok(board,'board persisted across WebSocket reconnection');
  assert.equal(board.elements.find(e=>e.id==='rect1').x,82);
  console.log('Realtime WebSocket tests passed: 2 clients, shared board, revisions, ping/pong and reconnect snapshot.');
 }finally{
  for(const c of [alice,bob,alice2])c?.close();
  child.kill('SIGTERM');await new Promise(r=>setTimeout(r,160));
  rmSync(folder,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;child.kill('SIGTERM');});
