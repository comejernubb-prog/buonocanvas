import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

// Single Railway replica + one persistent volume. The volume is the source of truth.
const dataDir = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || '/data';
const password = process.env.APP_PASSWORD;
const secret = process.env.SESSION_SECRET;
if (!password || password.length < 12 || !secret || secret.length < 32) {
  console.error('Missing APP_PASSWORD (12+ chars) or SESSION_SECRET (32+ chars)');
  process.exit(1);
}
mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(join(dataDir, 'buonocanvas.sqlite'), { timeout: 5000 });
db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;
CREATE TABLE IF NOT EXISTS boards (id TEXT PRIMARY KEY, name TEXT NOT NULL, background TEXT NOT NULL, grid INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1, deleted INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS elements (board_id TEXT NOT NULL, id TEXT NOT NULL, content TEXT, revision INTEGER NOT NULL DEFAULT 1, deleted INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY(board_id,id), FOREIGN KEY(board_id) REFERENCES boards(id));
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, board_id TEXT NOT NULL, actor TEXT NOT NULL, kind TEXT NOT NULL, objects INTEGER NOT NULL, time INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_elements_board ON elements(board_id,deleted);`);
const stmt = {
  listBoards:db.prepare('SELECT id,name,background,grid,revision,updated_at FROM boards WHERE deleted=0 ORDER BY created_at ASC'),
  board:db.prepare('SELECT * FROM boards WHERE id=?'),
  allElements:db.prepare('SELECT id,content,revision FROM elements WHERE board_id=? AND deleted=0 ORDER BY rowid ASC'),
  element:db.prepare('SELECT * FROM elements WHERE board_id=? AND id=?'),
  newBoard:db.prepare('INSERT INTO boards (id,name,background,grid,revision,deleted,created_at,updated_at) VALUES (?,?,?,?,1,0,?,?)'),
  updateBoard:db.prepare('UPDATE boards SET name=?, background=?, grid=?, revision=revision+1, updated_at=? WHERE id=?'),
  deleteBoard:db.prepare('UPDATE boards SET deleted=1, revision=revision+1, updated_at=? WHERE id=?'),
  upsertElement:db.prepare('INSERT INTO elements (board_id,id,content,revision,deleted,updated_at) VALUES (?,?,?,1,0,?) ON CONFLICT(board_id,id) DO UPDATE SET content=excluded.content,revision=elements.revision+1,deleted=0,updated_at=excluded.updated_at'),
  deleteElement:db.prepare('UPDATE elements SET deleted=1, revision=revision+1, updated_at=? WHERE board_id=? AND id=?'),
  audit:db.prepare('INSERT INTO audit(board_id,actor,kind,objects,time) VALUES(?,?,?,?,?)'),
};
const now=()=>Date.now();
// Create one shared starter canvas atomically, so the first two visitors join the same board.
if (!stmt.listBoards.all().length) { const t=now(); stmt.newBoard.run('workspace_main','Untitled canvas','#FFFFFF',0,t,t); }
const eq=(a,b)=>{const a1=Buffer.from(String(a)),b1=Buffer.from(String(b));return a1.length===b1.length && timingSafeEqual(a1,b1);};
const json=(res,status,obj,headers={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(obj));};
function cookieMap(header){const obj={};for(const item of String(header||'').split(';')){const p=item.indexOf('=');if(p>=0)obj[item.slice(0,p).trim()]=item.slice(p+1).trim();}return obj;}
function sign(value){return createHmac('sha256',secret).update(value).digest('base64url');}
function makeToken(){const id=randomBytes(12).toString('hex'),expires=now()+30*86400000;const val=`${id}.${expires}`;return `${val}.${sign(val)}`;}
function getActor(req){const tok=cookieMap(req.headers.cookie).bc_session;if(!tok)return null;const parts=tok.split('.');if(parts.length!==3||!/^\d{13}$/.test(parts[1]))return null;const val=parts.slice(0,2).join('.');if(!eq(parts[2],sign(val))||Number(parts[1])<now())return null;return parts[0];}
const attempts=new Map();
const html=readFileSync(new URL('./index.html',import.meta.url));
const server=createServer(async(req,res)=>{
  const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`),path=url.pathname;
  if(path==='/health'){json(res,200,{ok:true,database:'sqlite',cloud:true});return;}
  if(path==='/api/session'){json(res,200,{authenticated:!!getActor(req),version:8});return;}
  if(path==='/api/login'&&req.method==='POST'){
    const ip=(req.headers['x-forwarded-for']||req.socket.remoteAddress||'unknown').toString().split(',')[0].trim();
    const current=attempts.get(ip)||{count:0,until:0};
    if(current.until>now()){json(res,429,{error:'Too many attempts. Try again later.'});return;}
    let bytes=0,chunks=[];
    for await(const c of req){bytes+=c.length;if(bytes>4096){json(res,413,{error:'Request too large'});return;}chunks.push(c);}
    let body={};try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{}
    if(!eq(body.password??'',password)){
      current.count++;if(current.count>=8){current.until=now()+10*60000;current.count=0;}
      attempts.set(ip,current);json(res,401,{error:'Incorrect access code'});return;
    }
    attempts.delete(ip);
    const secure=(req.headers['x-forwarded-proto']==='https'||req.socket.encrypted)||process.env.NODE_ENV==='production';
    json(res,200,{ok:true},{'Set-Cookie':`bc_session=${makeToken()}; HttpOnly; Path=/; SameSite=Strict; Max-Age=2592000${secure?'; Secure':''}`});return;
  }
  if(path==='/api/logout'&&req.method==='POST'){json(res,200,{ok:true},{'Set-Cookie':'bc_session=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0; Secure'});return;}
  if((path==='/'||path==='/index.html')&&['GET','HEAD'].includes(req.method||'')){
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache, must-revalidate','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'});
    res.end(req.method==='HEAD'?'':html);return;
  }
  json(res,404,{error:'Not found'});
});

// Minimal standards-compliant RFC6455 server implementation; no npm dependencies.
const GUID='258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const clients=new Set(),locks=new Map();
const MAX_FRAME=16*1024*1024,MAX_MESSAGE=16*1024*1024;
function frame(opcode,payload){const buf=Buffer.isBuffer(payload)?payload:Buffer.from(payload||'');const size=buf.length;const h=Buffer.alloc(size<126?2:size<65536?4:10);h[0]=0x80|opcode;if(size<126)h[1]=size;else if(size<65536){h[1]=126;h.writeUInt16BE(size,2);}else{h[1]=127;h.writeBigUInt64BE(BigInt(size),2);}return Buffer.concat([h,buf]);}
function socketSend(c,data){if(!c.alive||c.socket.destroyed)return;const raw=JSON.stringify(data);if(c.socket.writableLength>24*1024*1024){c.socket.destroy();return;}c.socket.write(frame(1,raw));}
function broadcast(data,except=null){for(const c of clients)if(c!==except)socketSend(c,data);}
function closeClient(c){if(!c.alive)return;c.alive=false;clients.delete(c);for(const [key,v] of locks)if(v.actor===c.actor){locks.delete(key);broadcast({type:'unlock',key,actor:c.actor});}broadcast({type:'presence',users:[...clients].map(x=>({id:x.actor,name:x.name}))});}
const idOK=x=>typeof x==='string'&&x.length>=1&&x.length<=100&&/^[a-zA-Z0-9_-]+$/.test(x);
const metaValid=m=>m&&typeof m==='object'&&typeof m.name==='string'&&m.name.length<=220&&typeof m.background==='string'&&m.background.length<=60&&typeof m.grid==='boolean';
function boardData(id){const b=stmt.board.get(id);if(!b||b.deleted)return null;return {id:b.id,name:b.name,background:b.background,grid:!!b.grid,revision:b.revision,updatedAt:b.updated_at,elements:stmt.allElements.all(id).map(e=>({...JSON.parse(e.content),_rev:e.revision}))};}
function allBoards(){return stmt.listBoards.all().map(b=>boardData(b.id));}
function lockKey(b,id){return `${b}:${id}`;}
function lockState(key){const v=locks.get(key);if(!v)return null;if(v.expires<now()){locks.delete(key);return null;}return v;}
function acquire(c,boardId,ids){const denied=[];for(const id of ids){const key=lockKey(boardId,id),v=lockState(key);if(v&&v.actor!==c.actor)denied.push(id);}if(denied.length){socketSend(c,{type:'lockDenied',boardId,ids:denied});return false;}
  for(const id of ids){const key=lockKey(boardId,id);locks.set(key,{actor:c.actor,expires:now()+12000});}
  broadcast({type:'locks',boardId,ids,actor:c.actor});socketSend(c,{type:'lockGranted',boardId,ids});return true;
}
function allowed(c,boardId,ids){for(const id of ids){const held=lockState(lockKey(boardId,id));if(held&&held.actor!==c.actor)return false;}return true;}
function handlePatch(c,msg){const id=msg.boardId,reqId=msg.reqId,ops=Array.isArray(msg.ops)?msg.ops:[];
  if(!idOK(id)||ops.length>300||!Number.isInteger(msg.baseMetaRev)&&msg.meta){socketSend(c,{type:'error',message:'Invalid edit request',reqId});return;}
  const b=stmt.board.get(id);if(!b||b.deleted){socketSend(c,{type:'rejected',boardId:id,reqId,reason:'Canvas not found',snapshot:null});return;}
  if(msg.meta&&(!metaValid(msg.meta)||b.revision!==msg.baseMetaRev)){
    socketSend(c,{type:'rejected',boardId:id,reqId,reason:'Canvas settings changed on another device',snapshot:boardData(id)});return;
  }
  let results=[],ids=[];
  for(const op of ops){if(!op||!idOK(op.id)||!Number.isInteger(op.baseRev)||op.baseRev<0){socketSend(c,{type:'error',reqId,message:'Invalid object revision'});return;}
    const existing=stmt.element.get(id,op.id),realRev=existing?.revision||0;
    if(realRev!==op.baseRev){socketSend(c,{type:'rejected',boardId:id,reqId,reason:'Another device edited the same object',snapshot:boardData(id)});return;}
    if(op.value!==null){if(!op.value||typeof op.value!=='object'||op.value.id!==op.id){socketSend(c,{type:'error',reqId,message:'Invalid element'});return;}
      const size=Buffer.byteLength(JSON.stringify(op.value));if(size>8*1024*1024){socketSend(c,{type:'error',reqId,message:'Image or element too large (8 MB max)'});return;}}
    ids.push(op.id);results.push({id:op.id,baseRev:realRev,value:op.value,rev:realRev+1});
  }
  if(!allowed(c,id,ids)){socketSend(c,{type:'rejected',boardId:id,reqId,reason:'Object is being edited by someone else',snapshot:boardData(id)});return;}
  const stamp=now();
  try{db.exec('BEGIN IMMEDIATE');
    if(msg.meta)stmt.updateBoard.run(msg.meta.name,msg.meta.background,msg.meta.grid?1:0,stamp,id);
    for(const o of results){if(o.value===null){if(o.baseRev)stmt.deleteElement.run(stamp,id,o.id);}
      else{const val={...o.value};delete val._rev;stmt.upsertElement.run(id,o.id,JSON.stringify(val),stamp);}}
    stmt.audit.run(id,c.actor,'patch',results.length,stamp);db.exec('COMMIT');
  }catch(err){try{db.exec('ROLLBACK');}catch{};console.error('DB error',err);socketSend(c,{type:'error',reqId,message:'Database save failed'});return;}
  const ev={type:'delta',boardId:id,reqId,sender:c.actor,ops:results.map(o=>({id:o.id,rev:o.rev,value:o.value===null?null:{...o.value,_rev:o.rev}})),meta:msg.meta?{...msg.meta,revision:b.revision+1}:null};
  broadcast(ev); // send to origin too, works as ACK
}
function handleCreate(c,msg){const d=msg.board;if(!d||!idOK(d.id)||!metaValid(d))return socketSend(c,{type:'error',reqId:msg.reqId,message:'Invalid canvas'});
  if(stmt.board.get(d.id))return socketSend(c,{type:'rejected',reqId:msg.reqId,reason:'Canvas already exists',snapshot:boardData(d.id)});
  const stamp=now();try{stmt.newBoard.run(d.id,d.name,d.background,d.grid?1:0,stamp,stamp);}catch(err){return socketSend(c,{type:'error',reqId:msg.reqId,message:'Could not create canvas'});}
  const ev={type:'boardCreated',reqId:msg.reqId,sender:c.actor,board:{id:d.id,name:d.name,background:d.background,grid:d.grid,revision:1,updatedAt:stamp,elements:[]}};broadcast(ev);
}
function handleDelete(c,msg){const b=stmt.board.get(msg.boardId);if(!b||b.deleted){socketSend(c,{type:'rejected',reqId:msg.reqId,reason:'Already deleted',snapshot:null});return;}
  if(b.revision!==msg.baseRev){socketSend(c,{type:'rejected',reqId:msg.reqId,reason:'Canvas changed elsewhere',snapshot:boardData(b.id)});return;}
  stmt.deleteBoard.run(now(),msg.boardId);broadcast({type:'boardDeleted',reqId:msg.reqId,sender:c.actor,boardId:msg.boardId});
}
function wsMessage(c,raw){let msg;try{msg=JSON.parse(raw);}catch{return;}if(!msg||typeof msg!=='object')return;
 if(msg.type==='intro'){c.name=String(msg.name||'Collaborator').slice(0,38);socketSend(c,{type:'welcome',actor:c.actor,boards:allBoards(),users:[...clients].map(x=>({id:x.actor,name:x.name}))});broadcast({type:'presence',users:[...clients].map(x=>({id:x.actor,name:x.name}))});return;}
 if(msg.type==='patch'){handlePatch(c,msg);return;}
 if(msg.type==='boardCreate'){handleCreate(c,msg);return;}
 if(msg.type==='boardDelete'){handleDelete(c,msg);return;}
 if(msg.type==='lock'&&idOK(msg.boardId)&&Array.isArray(msg.ids)&&msg.ids.length<=100){acquire(c,msg.boardId,msg.ids.filter(idOK));return;}
 if(msg.type==='unlock'&&idOK(msg.boardId)&&Array.isArray(msg.ids)){for(const id of msg.ids.filter(idOK)){const key=lockKey(msg.boardId,id);if(locks.get(key)?.actor===c.actor)locks.delete(key);}broadcast({type:'unlock',boardId:msg.boardId,ids:msg.ids,actor:c.actor});return;}
 if(msg.type==='cursor'&&idOK(msg.boardId)&&Number.isFinite(msg.x)&&Number.isFinite(msg.y)){broadcast({type:'cursor',actor:c.actor,name:c.name,boardId:msg.boardId,x:msg.x,y:msg.y},c);return;}
}
server.on('upgrade',(req,socket,head)=>{
  const path=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`).pathname;
  const host=req.headers.host||'',origin=req.headers.origin||'';
  if(path!=='/ws'||!getActor(req)||!req.headers['sec-websocket-key']||!origin||new URL(origin).host!==host){socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');socket.destroy();return;}
  const accept=createHash('sha1').update(req.headers['sec-websocket-key']+GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
  const c={socket,actor:getActor(req)+'-'+randomBytes(5).toString('hex'),name:'Collaborator',buffer:Buffer.alloc(0),fragment:[],fragmentSize:0,alive:true};clients.add(c);
  socket.on('data',data=>{
    c.buffer=Buffer.concat([c.buffer,data]);if(c.buffer.length>MAX_FRAME+100){socket.destroy();return;}
    while(c.buffer.length>=2){const b0=c.buffer[0],b1=c.buffer[1],opcode=b0&15,fin=!!(b0&0x80),masked=!!(b1&0x80);let len=b1&127,at=2;
      if(!masked){socket.destroy();return;}
      if(len===126){if(c.buffer.length<4)break;len=c.buffer.readUInt16BE(2);at=4;}
      else if(len===127){if(c.buffer.length<10)break;const big=c.buffer.readBigUInt64BE(2);if(big>BigInt(MAX_FRAME)){socket.destroy();return;}len=Number(big);at=10;}
      if(len>MAX_FRAME){socket.destroy();return;}
      if(c.buffer.length<at+4+len)break;
      const mask=c.buffer.subarray(at,at+4),payload=Buffer.from(c.buffer.subarray(at+4,at+4+len));c.buffer=c.buffer.subarray(at+4+len);
      for(let i=0;i<payload.length;i++)payload[i]^=mask[i&3];
      if(opcode===8){socket.end(frame(8,''));return;}
      if(opcode===9){socket.write(frame(10,payload));continue;}
      if(opcode===10)continue;
      if(opcode===1){c.fragment=[];c.fragmentSize=0;}
      if(opcode!==1&&opcode!==0){socket.destroy();return;}
      c.fragment.push(payload);c.fragmentSize+=payload.length;
      if(c.fragmentSize>MAX_MESSAGE){socket.destroy();return;}
      if(fin){const raw=Buffer.concat(c.fragment).toString('utf8');c.fragment=[];c.fragmentSize=0;try{wsMessage(c,raw);}catch(err){console.error('message handling error',err);socketSend(c,{type:'error',message:'Unexpected server error'});}}
    }
  });
  socket.on('error',()=>closeClient(c));socket.on('close',()=>closeClient(c));
  if(head?.length)socket.emit('data',head);
});
setInterval(()=>{for(const [key,l] of locks)if(l.expires<now())locks.delete(key);},4000).unref();
const port=Number(process.env.PORT||3000);server.listen(port,'0.0.0.0',()=>console.log(`buonocanvas cloud v8 listening on ${port}; persistent database at ${dataDir}; boards ${stmt.listBoards.all().length}`));
