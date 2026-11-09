import { createServer } from 'node:http';
import { readFileSync, mkdirSync, existsSync, writeFileSync, createReadStream, statSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync, brotliCompressSync, constants as zc } from 'node:zlib';
import { randomBytes, createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { downloadFullBackup, scheduleSqliteSnapshots } from './backup-utils.mjs';

// Single Railway replica + one persistent volume. The volume is the source of truth.
const dataDir = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || '/data';
const password = process.env.APP_PASSWORD;
const secret = process.env.SESSION_SECRET;
if (!password || password.length < 8 || !secret || secret.length < 32) {
  console.error('Missing APP_PASSWORD (8+ chars) or SESSION_SECRET (32+ chars)');
  process.exit(1);
}
mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(join(dataDir, 'buonocanvas.sqlite'), { timeout: 5000 });
db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;
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
// Original image bytes are stored as immutable, content-addressed files, not encoded in SQLite JSON.
// Never resize, recompress or mutate uploads. The database only stores /api/assets/<sha>.<ext> references.
const assetsDir=join(dataDir,'assets');mkdirSync(assetsDir,{recursive:true});
const MAX_ASSET=50*1024*1024;
const ASSET_TYPES={jpg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',avif:'image/avif'};
function imageExtension(data){
 if(data.length>=3&&data[0]===255&&data[1]===216&&data[2]===255)return 'jpg';
 if(data.length>=8&&data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'png';
 if(data.length>=12&&data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP')return 'webp';
 if(data.length>=6&&['GIF89a','GIF87a'].includes(data.toString('ascii',0,6)))return 'gif';
 if(data.length>=12&&data.toString('ascii',4,8)==='ftyp'&&['avif','avis'].includes(data.toString('ascii',8,12)))return 'avif';
 return null;
}
function sameOrigin(req){try{const origin=req.headers.origin;if(!origin)return false;return new URL(origin).host===req.headers.host;}catch{return false;}}
const attempts=new Map();
// Static files are compressed once at startup (index.html is ~380 KB; brotli cuts it to a fraction),
// so first load and every reload on a phone/iPad connection is much lighter.
function prepareStatic(file){const raw=readFileSync(new URL(file,import.meta.url));
  return {raw,etag:'"'+createHash('sha1').update(raw).digest('base64url').slice(0,20)+'"',
    br:brotliCompressSync(raw,{params:{[zc.BROTLI_PARAM_QUALITY]:9}}),gz:gzipSync(raw,{level:9})};}
function sendStatic(req,res,asset,type,extra={}){
  const head={'Content-Type':type,'Cache-Control':'no-cache, must-revalidate','ETag':asset.etag,'Vary':'Accept-Encoding','X-Content-Type-Options':'nosniff',...extra};
  if(req.headers['if-none-match']===asset.etag){res.writeHead(304,head);res.end();return;}
  const accept=String(req.headers['accept-encoding']||'');let body=asset.raw;
  if(/\bbr\b/.test(accept)){body=asset.br;head['Content-Encoding']='br';}
  else if(/\bgzip\b/.test(accept)){body=asset.gz;head['Content-Encoding']='gzip';}
  head['Content-Length']=body.length;res.writeHead(200,head);res.end(req.method==='HEAD'?undefined:body);
}
const htmlAsset=prepareStatic('./index.html');
const pdfAsset=prepareStatic('./pdf-vector.js');
const v13Asset=prepareStatic('./v13-core.js');
 // Same-origin, bundled Prompt font files: no Google Fonts/CDN dependency on Windows, macOS or iPad.
 const promptWeights=[300,400,500,600,700,800],fontFileMap=new Map(),fontCssRules=[];
 const promptRanges={latin:'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',thai:'U+0E00-0E7F,U+200C-200D,U+25CC'};
 for(const subset of ['latin','thai'])for(const weight of promptWeights){
   const filename=`prompt-${subset}-${weight}-normal.woff2`;
   const bytes=readFileSync(new URL(`./node_modules/@fontsource/prompt/files/${filename}`,import.meta.url));
   if(bytes.toString('ascii',0,4)!=='wOF2')throw Error('Invalid bundled Prompt font: '+filename);
   fontFileMap.set(filename,bytes);
   fontCssRules.push(`@font-face{font-family:"Prompt";font-style:normal;font-weight:${weight};font-display:swap;src:url("/fonts/${filename}") format("woff2");unicode-range:${promptRanges[subset]};}`);
 }
 const promptCssBytes=Buffer.from(fontCssRules.join('\n'),'utf8');
 const promptCssAsset={raw:promptCssBytes,etag:'"'+createHash('sha1').update(promptCssBytes).digest('base64url')+'"',br:brotliCompressSync(promptCssBytes),gz:gzipSync(promptCssBytes)};

let backupInProgress=false;
async function handle(req,res){
  const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`),path=url.pathname;
  if(path==='/health'){json(res,200,{ok:true,version:15,database:'sqlite',cloud:true,originalAssets:true,vectorPDF:true,editablePNG:true,backup:true,promptFont:true});return;}
  if(path==='/api/diagnostics'&&req.method==='GET'){
    if(!getActor(req)){json(res,401,{error:'Login required'});return;}
    json(res,200,{ok:true,version:15,uptimeSeconds:Math.round(process.uptime()),activeWebSockets:clients.size,webSocketsOpened:connectionStats.opened,webSocketsClosed:connectionStats.closed,cursorDrops:connectionStats.cursorDrops,stalledConnections:connectionStats.backpressureCloses,heapMB:Math.round(process.memoryUsage().heapUsed/1048576),promptFonts:fontFileMap.size});
    return;
  }
  if((req.method==='GET'||req.method==='HEAD')&&path==='/fonts/prompt.css'){
    sendStatic(req,res,promptCssAsset,'text/css; charset=utf-8',{'Cache-Control':'public, max-age=3600'});return;
  }
  if((req.method==='GET'||req.method==='HEAD')&&path.startsWith('/fonts/')){
    const name=path.slice('/fonts/'.length),bytes=fontFileMap.get(name);
    if(!bytes){json(res,404,{error:'Not found'});return;}
    const etag='"'+name+'-'+bytes.length+'"';
    const headers={'Content-Type':'font/woff2','Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':'*','ETag':etag};
    if(req.headers['if-none-match']===etag){res.writeHead(304,headers);res.end();return;}
    res.writeHead(200,{...headers,'Content-Length':bytes.length});res.end(req.method==='HEAD'?undefined:bytes);return;
  }
  if(path==='/v13-core.js'&&(req.method==='GET'||req.method==='HEAD')){
    sendStatic(req,res,v13Asset,'text/javascript; charset=utf-8');return;
  }
  if(path==='/api/backup'&&req.method==='GET'){
    if(!getActor(req)){json(res,401,{error:'Login required'});return;}
    if(backupInProgress){json(res,429,{error:'Another backup is already being prepared'});return;}
    backupInProgress=true;try{await downloadFullBackup(db,dataDir,res);}catch(e){console.error('Full backup failed:',e);if(!res.headersSent)json(res,500,{error:'Backup failed'});else res.destroy();}finally{backupInProgress=false;}return;
  }
  if(path==='/pdf-vector.js'&&(req.method==='GET'||req.method==='HEAD')){
    sendStatic(req,res,pdfAsset,'text/javascript; charset=utf-8');return;
  }
  if(path==='/api/assets'&&req.method==='POST'){
    if(!getActor(req)){json(res,401,{error:'Login required'});return;}
    if(!sameOrigin(req)){json(res,403,{error:'Origin not allowed'});return;}
    const declared=Number(req.headers['content-length']||0);
    if(declared>MAX_ASSET){json(res,413,{error:'Image is larger than 50 MB; original was not modified'});return;}
    const chunks=[];let count=0;
    for await(const chunk of req){count+=chunk.length;if(count>MAX_ASSET){json(res,413,{error:'Image exceeds 50 MB; no compression was applied'});return;}chunks.push(chunk);}
    const raw=Buffer.concat(chunks,count),ext=imageExtension(raw);
    if(!ext){json(res,415,{error:'Unsupported image. Use the original JPEG, PNG, WebP, GIF or AVIF file.'});return;}
    const hash=createHash('sha256').update(raw).digest('hex'),filename=hash+'.'+ext,target=join(assetsDir,filename);
    if(!existsSync(target)){
      const temp=join(assetsDir,'.upload-'+randomBytes(12).toString('hex'));
      try{writeFileSync(temp,raw,{flag:'wx'});renameSync(temp,target);}
      catch(err){try{if(existsSync(temp))unlinkSync(temp);}catch{};console.error('Asset write failed:',err);json(res,507,{error:'Image storage full or unavailable'});return;}
    }
    json(res,201,{url:'/api/assets/'+filename,sha256:hash,bytes:raw.length,mime:ASSET_TYPES[ext]});return;
  }
  if(path.startsWith('/api/assets/')&&(req.method==='GET'||req.method==='HEAD')){
    if(!getActor(req)){json(res,401,{error:'Login required'});return;}
    const match=/^\/api\/assets\/([a-f0-9]{64})\.(jpg|png|webp|gif|avif)$/.exec(path);
    if(!match){json(res,404,{error:'Not found'});return;}
    const filename=match[1]+'.'+match[2],target=join(assetsDir,filename);
    if(!existsSync(target)){json(res,404,{error:'Image not found'});return;}
    res.writeHead(200,{'Content-Type':ASSET_TYPES[match[2]],'Content-Length':statSync(target).size,'Cache-Control':'private, max-age=31536000, immutable','X-Content-Type-Options':'nosniff'});
    if(req.method==='HEAD'){res.end();return;}createReadStream(target).pipe(res);return;
  }
  if(path==='/api/session'){json(res,200,{authenticated:!!getActor(req),version:14});return;}
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
    sendStatic(req,res,htmlAsset,'text/html; charset=utf-8',{'Referrer-Policy':'strict-origin-when-cross-origin'});return;
  }
  json(res,404,{error:'Not found'});
}
// An aborted upload (flaky iPad connection) makes `for await(req)` throw. Unhandled, that crashed the whole
// server and disconnected every collaborator, so every request is guarded.
const server=createServer((req,res)=>{handle(req,res).catch(err=>{
  if(err?.code!=='ECONNRESET'&&err?.message!=='aborted')console.error('Request failed:',req.method,req.url,err);
  try{if(!res.headersSent)json(res,500,{error:'Server error'});else res.destroy();}catch{}
});});

// Minimal standards-compliant RFC6455 server implementation; no npm dependencies.
const GUID='258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const clients=new Set(),locks=new Map(),connectionStats={opened:0,closed:0,cursorDrops:0,backpressureCloses:0};
const MAX_FRAME=16*1024*1024,MAX_MESSAGE=16*1024*1024;
function frame(opcode,payload){const buf=Buffer.isBuffer(payload)?payload:Buffer.from(payload||'');const size=buf.length;const h=Buffer.alloc(size<126?2:size<65536?4:10);h[0]=0x80|opcode;if(size<126)h[1]=size;else if(size<65536){h[1]=126;h.writeUInt16BE(size,2);}else{h[1]=127;h.writeBigUInt64BE(BigInt(size),2);}return Buffer.concat([h,buf]);}
function socketSend(c,data){
 if(!c.alive||c.socket.destroyed)return;
 // Presence cursors are lossy by design: do not allow them to congest a slow mobile connection.
 if(data.type==='cursor'&&c.socket.writableLength>128*1024){connectionStats.cursorDrops++;return;}
 if(c.socket.writableLength>8*1024*1024){connectionStats.backpressureCloses++;c.socket.destroy();return;}
 c.socket.write(frame(1,JSON.stringify(data)));
}
function broadcast(data,except=null){for(const c of clients)if(c!==except)socketSend(c,data);}
function closeClient(c){if(!c.alive)return;c.alive=false;clients.delete(c);connectionStats.closed++;const freed=new Map();for(const [key,v] of locks)if(v.actor===c.actor){locks.delete(key);const at=key.indexOf(':'),board=key.slice(0,at),list=freed.get(board)||[];list.push(key.slice(at+1));freed.set(board,list);}for(const [boardId,ids] of freed)broadcast({type:'unlock',boardId,ids,actor:c.actor});broadcast({type:'presence',users:[...clients].map(x=>({id:x.actor,name:x.name}))});}
const idOK=x=>typeof x==='string'&&x.length>=1&&x.length<=100&&/^[a-zA-Z0-9_-]+$/.test(x);
const metaValid=m=>m&&typeof m==='object'&&typeof m.name==='string'&&m.name.length<=220&&typeof m.background==='string'&&m.background.length<=60&&typeof m.grid==='boolean';
function boardData(id){const b=stmt.board.get(id);if(!b||b.deleted)return null;return {id:b.id,name:b.name,background:b.background,grid:!!b.grid,revision:b.revision,updatedAt:b.updated_at,elements:stmt.allElements.all(id).flatMap(e=>{try{return [{...JSON.parse(e.content),_rev:e.revision}];}catch{console.error('Skipping unreadable element',id,e.id);return [];}})};}
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
 if(msg.type==='ping'){socketSend(c,{type:'pong',t:msg.t});return;}
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
  const c={socket,actor:getActor(req)+'-'+randomBytes(5).toString('hex'),name:'Collaborator',buffer:Buffer.alloc(0),fragment:[],fragmentSize:0,alive:true,lastSeen:now()};clients.add(c);connectionStats.opened++;socket.setNoDelay(true);
  socket.on('data',data=>{
    c.lastSeen=now();c.buffer=Buffer.concat([c.buffer,data]);if(c.buffer.length>MAX_FRAME+100){socket.destroy();return;}
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
// Heartbeat: proxies (Railway) and iOS Safari silently drop idle sockets. Ping every 20 s so live
// connections stay open, and reap sockets that have been silent for over a minute.
setInterval(()=>{const t=now();for(const c of [...clients]){if(t-c.lastSeen>60000){c.socket.destroy();continue;}try{c.socket.write(frame(9,''));}catch{}}},20000).unref();
setInterval(()=>{const t=now();for(const [ip,a] of attempts)if(a.until<t&&a.count===0)attempts.delete(ip);},600000).unref();
// The audit log was written on every sync tick (several per second while dragging) and never trimmed.
setInterval(()=>{try{db.exec('DELETE FROM audit WHERE id < (SELECT COALESCE(MAX(id),0) FROM audit) - 5000');}catch(err){console.error('Audit trim failed',err);}},3600000).unref();
function shutdown(){console.log('Shutting down');for(const c of clients){try{c.socket.end(frame(8,''));}catch{}}server.close();try{db.exec('PRAGMA wal_checkpoint(TRUNCATE)');db.close();}catch{}setTimeout(()=>process.exit(0),300).unref();}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
process.on('unhandledRejection',err=>console.error('Unhandled rejection',err));
process.on('uncaughtException',err=>console.error('Uncaught exception',err));
const port=Number(process.env.PORT||3000);server.listen(port,'0.0.0.0',()=>console.log(`buonocanvas cloud v15 listening on ${port}; persistent database at ${dataDir}; boards ${stmt.listBoards.all().length}`));
scheduleSqliteSnapshots(db,dataDir);
