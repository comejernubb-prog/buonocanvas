/* Safe SQLite snapshots and authenticated full archive downloads.
 * A periodic SQLite backup on the same volume is NOT an off-site backup.
 * The downloadable tar.gz includes SQLite and all immutable original assets. */
import { backup as sqliteBackup } from 'node:sqlite';
import { createReadStream, createWriteStream } from 'node:fs';
import { readdir, mkdir, stat, unlink, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';

const nameSafe = n => /^[a-f0-9]{64}\.(?:jpg|png|webp|gif|avif)$/.test(n);
const stamp = () => new Date().toISOString().replace(/[:.]/g,'-');
function octal(b,start,len,value){const s=Math.floor(value).toString(8).padStart(len-1,'0')+'\0';b.write(s.slice(-len),start,len,'ascii');}
function tarHeader(name,size,mtime){if(Buffer.byteLength(name)>100)throw Error('TAR path too long');const b=Buffer.alloc(512);b.write(name,0,100,'utf8');octal(b,100,8,0o600);octal(b,108,8,0);octal(b,116,8,0);octal(b,124,12,size);octal(b,136,12,Math.floor(mtime/1000));b.fill(32,148,156);b[156]=48;b.write('ustar\0',257,6);b.write('00',263,2);let sum=0;for(const byte of b)sum+=byte;octal(b,148,8,sum);return b;}
async function * fileParts(name,path){const info=await stat(path);yield tarHeader(name,info.size,info.mtimeMs);for await(const chunk of createReadStream(path,{highWaterMark:256*1024}))yield chunk;const pad=(512-(info.size%512))%512;if(pad)yield Buffer.alloc(pad);}
async function * bodyParts(name,content){const bytes=Buffer.from(content);yield tarHeader(name,bytes.length,Date.now());yield bytes;const pad=(512-(bytes.length%512))%512;if(pad)yield Buffer.alloc(pad);}
async function getAssets(dir){try{const names=(await readdir(join(dir,'assets'))).filter(nameSafe).sort();return await Promise.all(names.map(async name=>({name,path:join(dir,'assets',name),size:(await stat(join(dir,'assets',name))).size})));}catch(e){if(e.code==='ENOENT')return [];throw e;}}
export async function downloadFullBackup(db,dataDir,res){
  const archiveDir=join(dataDir,'backups');await mkdir(archiveDir,{recursive:true});
  const temp=join(archiveDir,'.export-'+randomBytes(9).toString('hex')+'.sqlite');
  try{
    await sqliteBackup(db,temp);
    const assets=await getAssets(dataDir);
    const dbInfo=await stat(temp);
    const manifest=JSON.stringify({format:'buonocanvas-full-backup',version:1,createdAt:new Date().toISOString(),database:'buonocanvas.sqlite',databaseBytes:dbInfo.size,assets:assets.map(a=>({name:a.name,bytes:a.size})),restoreHint:'Restore the SQLite database and assets/ directory into DATA_DIR while the server is stopped.'},null,2);
    res.writeHead(200,{'Content-Type':'application/gzip','Content-Disposition':'attachment; filename="buonocanvas-backup-'+new Date().toISOString().slice(0,10)+'.tar.gz"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    const parts=Readable.from((async function*(){yield* bodyParts('manifest.json',manifest);yield* fileParts('buonocanvas.sqlite',temp);for(const a of assets)yield* fileParts('assets/'+a.name,a.path);yield Buffer.alloc(1024);})());
    await pipeline(parts,createGzip({level:5}),res);
  } finally {await unlink(temp).catch(()=>{});}
}
export function scheduleSqliteSnapshots(db,dataDir){
  const dir=join(dataDir,'backups');let busy=false;
  async function snapshot(){
    if(busy)return;busy=true;
    try{
      await mkdir(dir,{recursive:true});
      const day=new Date().toISOString().slice(0,10);
      const filename='snapshot-'+day+'.sqlite',dest=join(dir,filename);
      const tmp=join(dir,'.snapshot-'+randomBytes(8).toString('hex'));
      await sqliteBackup(db,tmp);await rename(tmp,dest);
      const all=(await readdir(dir)).filter(n=>/^snapshot-\d{4}-\d{2}-\d{2}\.sqlite$/.test(n)).sort();
      for(const old of all.slice(0,Math.max(0,all.length-7)))await unlink(join(dir,old)).catch(()=>{});
      console.log('SQLite snapshot OK:',filename);
    }catch(e){console.error('SQLite snapshot failed:',e);}finally{busy=false;}
  }
  snapshot();const timer=setInterval(snapshot,24*60*60*1000);timer.unref();return snapshot;
}
