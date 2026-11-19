import { Buffer } from 'node:buffer';

const now = Date.now;
const CHUNK_BYTES = 512 * 1024;
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

const json = (body, status=200) => Response.json(body, {status, headers:{'Cache-Control':'no-store'}});
const schema = `CREATE TABLE IF NOT EXISTS boards (id TEXT PRIMARY KEY, name TEXT NOT NULL, background TEXT NOT NULL, grid INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1, deleted INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS elements (board_id TEXT NOT NULL, id TEXT NOT NULL, content TEXT, revision INTEGER NOT NULL DEFAULT 1, deleted INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY(board_id,id), FOREIGN KEY(board_id) REFERENCES boards(id));
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, board_id TEXT NOT NULL, actor TEXT NOT NULL, kind TEXT NOT NULL, objects INTEGER NOT NULL, time INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_elements_board ON elements(board_id,deleted);`;

function workspace(state) {
  const sql = state.storage.sql;
  sql.exec(schema);
  const prepare = (query) => ({
    all: (...args) => sql.exec(query, ...args).toArray(),
    get: (...args) => sql.exec(query, ...args).toArray()[0],
    run: (...args) => sql.exec(query, ...args),
  });
const stmt = {
  listBoards:prepare('SELECT id,name,background,grid,revision,updated_at FROM boards WHERE deleted=0 ORDER BY created_at ASC'),
  board:prepare('SELECT * FROM boards WHERE id=?'),
  allElements:prepare('SELECT id,content,revision FROM elements WHERE board_id=? AND deleted=0 ORDER BY rowid ASC'),
  element:prepare('SELECT * FROM elements WHERE board_id=? AND id=?'),
  newBoard:prepare('INSERT INTO boards (id,name,background,grid,revision,deleted,created_at,updated_at) VALUES (?,?,?,?,1,0,?,?)'),
  updateBoard:prepare('UPDATE boards SET name=?, background=?, grid=?, revision=revision+1, updated_at=? WHERE id=?'),
  deleteBoard:prepare('UPDATE boards SET deleted=1, revision=revision+1, updated_at=? WHERE id=?'),
  upsertElement:prepare('INSERT INTO elements (board_id,id,content,revision,deleted,updated_at) VALUES (?,?,?,1,0,?) ON CONFLICT(board_id,id) DO UPDATE SET content=excluded.content,revision=elements.revision+1,deleted=0,updated_at=excluded.updated_at'),
  deleteElement:prepare('UPDATE elements SET deleted=1, revision=revision+1, updated_at=? WHERE board_id=? AND id=?'),
  audit:prepare('INSERT INTO audit(board_id,actor,kind,objects,time) VALUES(?,?,?,?,?)'),
};

  sql.exec('INSERT OR IGNORE INTO boards VALUES (?,?,?,?,1,0,?,?)',
    'workspace_main','Untitled canvas','#FFFFFF',0,now(),now());
  const transaction = callback => state.storage.transactionSync(callback);
  const locks = new Map();
  const clients = new Set(state.getWebSockets().map(socket => ({socket, ...socket.deserializeAttachment()})));
  function socketSend(client, data) {
    try { client.socket.send(JSON.stringify(data)); }
    catch { try { client.socket.close(1011, 'Connection lost'); } catch {} }
  }
  function broadcast(data, except) {
    for (const client of clients) if (client !== except) socketSend(client, data);
  }
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
      const size=Buffer.byteLength(JSON.stringify(op.value));if(size>8*1024*1024-1024){socketSend(c,{type:'error',reqId,message:'Image or element too large (approximately 8 MB max)'});return;}}
    ids.push(op.id);results.push({id:op.id,baseRev:realRev,value:op.value,rev:realRev+1});
  }
  if(!allowed(c,id,ids)){socketSend(c,{type:'rejected',boardId:id,reqId,reason:'Object is being edited by someone else',snapshot:boardData(id)});return;}
  const stamp=now();
  try{transaction(()=>{
    if(msg.meta)stmt.updateBoard.run(msg.meta.name,msg.meta.background,msg.meta.grid?1:0,stamp,id);
    for(const o of results){if(o.value===null){if(o.baseRev)stmt.deleteElement.run(stamp,id,o.id);}
      else{const val={...o.value};delete val._rev;stmt.upsertElement.run(id,o.id,JSON.stringify(val),stamp);}}
    stmt.audit.run(id,c.actor,'patch',results.length,stamp);});
  }catch(err){console.error('DB error',err);socketSend(c,{type:'error',reqId,message:'Database save failed'});return;}
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
 if(msg.type==='intro'){c.name=String(msg.name||'Collaborator').slice(0,38);c.socket.serializeAttachment({actor:c.actor,name:c.name});socketSend(c,{type:'welcome',actor:c.actor,boards:allBoards(),users:[...clients].map(x=>({id:x.actor,name:x.name}))});broadcast({type:'presence',users:[...clients].map(x=>({id:x.actor,name:x.name}))});return;}
 if(msg.type==='ping'){socketSend(c,{type:'pong',t:msg.t});return;}
 if(msg.type==='patch'){handlePatch(c,msg);return;}
 if(msg.type==='boardCreate'){handleCreate(c,msg);return;}
 if(msg.type==='boardDelete'){handleDelete(c,msg);return;}
 if(msg.type==='lock'&&idOK(msg.boardId)&&Array.isArray(msg.ids)&&msg.ids.length<=100){acquire(c,msg.boardId,msg.ids.filter(idOK));return;}
 if(msg.type==='unlock'&&idOK(msg.boardId)&&Array.isArray(msg.ids)){for(const id of msg.ids.filter(idOK)){const key=lockKey(msg.boardId,id);if(locks.get(key)?.actor===c.actor)locks.delete(key);}broadcast({type:'unlock',boardId:msg.boardId,ids:msg.ids,actor:c.actor});return;}
 if(msg.type==='cursor'&&idOK(msg.boardId)&&Number.isFinite(msg.x)&&Number.isFinite(msg.y)){broadcast({type:'cursor',actor:c.actor,name:c.name,boardId:msg.boardId,x:msg.x,y:msg.y},c);return;}
}

  return {
    clients, wsMessage, allBoards,
    disconnect(client) {
      clients.delete(client);
      for (const [key, value] of locks) {
        if (value.actor !== client.actor) continue;
        locks.delete(key);
        const [boardId, id] = key.split(':');
        broadcast({type:'unlock', boardId, ids:[id], actor:client.actor});
      }
      broadcast({type:'presence',users:[...clients].map(({actor:id,name})=>({id,name}))});
    },
  };
}

export class CanvasWorkspace {
  constructor(state) {
    this.state = state;
    this.workspace = workspace(state);
  }

  fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/api/backup') {
      return new Response(JSON.stringify({boards:this.workspace.allBoards()}), {
        headers:{'Content-Type':'application/json','Content-Disposition':'attachment; filename="buono-boards.json"','Cache-Control':'no-store'},
      });
    }
    const [client, socket] = Object.values(new WebSocketPair());
    const actor = crypto.randomUUID();
    const name = 'Collaborator';
    this.state.acceptWebSocket(socket);
    socket.serializeAttachment({actor,name});
    this.workspace.clients.add({socket,actor,name});
    return new Response(null, {status:101,webSocket:client});
  }

  webSocketMessage(socket, message) {
    const client = this.findClient(socket);
    if (!client || typeof message !== 'string') return;
    this.workspace.wsMessage(client,message);
  }

  findClient(socket) {
    return [...this.workspace.clients].find(client => client.socket === socket);
  }

  webSocketClose(socket, code) {
    const client = this.findClient(socket);
    if (client) this.workspace.disconnect(client);
    socket.close(code === 1006 ? 1011 : code);
  }

  webSocketError(socket) {
    const client = this.findClient(socket);
    if (client) this.workspace.disconnect(client);
    socket.close(1011, 'Connection lost');
  }
}

export class CanvasImage {
  constructor(state) {
    this.state = state;
    this.sql = state.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS chunks (part INTEGER PRIMARY KEY, bytes BLOB NOT NULL)');
  }

  async fetch(request) {
    const key = new URL(request.url).pathname.split('/').pop();
    const mime = ASSET_TYPES[key.split('.').pop()];
    if (request.method === 'PUT') {
      const raw = await request.arrayBuffer();
      this.state.storage.transactionSync(() => {
        if (this.sql.exec('SELECT 1 FROM chunks LIMIT 1').toArray().length) return;
        for (let pos = 0; pos < raw.byteLength; pos += CHUNK_BYTES) {
          this.sql.exec('INSERT INTO chunks VALUES (?,?)',pos / CHUNK_BYTES,raw.slice(pos,pos + CHUNK_BYTES));
        }
      });
      return new Response(null, {status:204});
    }
    const {size, count} = this.sql.exec('SELECT SUM(length(bytes)) AS size, COUNT(*) AS count FROM chunks').one();
    if (!count) return json({error:'Image not found'},404);
    const headers = {'Content-Type':mime,'Content-Length':size,'Cache-Control':'private, max-age=31536000, immutable','X-Content-Type-Options':'nosniff'};
    if (request.method === 'HEAD') return new Response(null,{headers});
    let part = 0;
    const body = new ReadableStream({
      pull: controller => {
        controller.enqueue(new Uint8Array(this.sql.exec('SELECT bytes FROM chunks WHERE part=?',part++).one().bytes));
        if (part === count) controller.close();
      },
    });
    return new Response(body,{headers});
  }
}

async function uploadImage(request, env) {
  const declared = Number(request.headers.get('content-length'));
  if (declared > MAX_ASSET) return json({error:'Image is larger than 50 MB'},413);
  const reader = request.body?.getReader();
  if (!reader) return json({error:'Missing image'},400);
  const chunks = [];
  let size = 0;
  for (;;) {
    const {done,value} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_ASSET) {
      await reader.cancel();
      return json({error:'Image is larger than 50 MB'},413);
    }
    chunks.push(value);
  }
  const raw = Buffer.concat(chunks,size);
  chunks.length = 0;
  const ext = imageExtension(raw);
  if (!ext) return json({error:'Unsupported image'},415);
  const sha256 = Buffer.from(await crypto.subtle.digest('SHA-256',raw)).toString('hex');
  const key = sha256 + '.' + ext;
  const url = '/api/assets/' + key;
  const image = env.IMAGES.getByName(key);
  const response = await image.fetch(new URL(url,request.url), {method:'PUT',body:raw});
  if (!response.ok) return json({error:'Image could not be saved'},507);
  return json({url,sha256,bytes:size,mime:ASSET_TYPES[ext]},201);
}

export default {
  async fetch(request, env) {
    const {pathname,origin} = new URL(request.url);
    if (pathname === '/health') return json({ok:true,version:'cloudflare-1',database:'durable-object-sqlite',cloud:true,originalAssets:true});
    if (pathname === '/api/session') return json({authenticated:true,version:'cloudflare-1'});
    if (pathname === '/ws') {
      if (request.headers.get('Origin') !== origin) return json({error:'Origin not allowed'},403);
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({error:'WebSocket required'},426);
      return env.WORKSPACE.getByName('main').fetch(request);
    }
    if (pathname === '/api/assets' && request.method === 'POST') {
      if (request.headers.get('Origin') !== origin) return json({error:'Origin not allowed'},403);
      return uploadImage(request,env);
    }
    const key = /^\/api\/assets\/([a-f0-9]{64}\.(?:jpg|png|webp|gif|avif))$/.exec(pathname)?.[1];
    if (key && ['GET','HEAD'].includes(request.method)) return env.IMAGES.getByName(key).fetch(request);
    if (pathname === '/api/backup' && request.method === 'GET') return env.WORKSPACE.getByName('main').fetch(request);
    if (pathname.startsWith('/api/')) return json({error:'Not found'},404);
    return env.ASSETS.fetch(request);
  },
};
