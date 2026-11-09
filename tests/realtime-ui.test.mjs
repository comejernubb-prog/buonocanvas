import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.lastIndexOf('<script>');
const end=html.lastIndexOf('</script>');
assert.ok(start>0&&end>start,'inline application JS found');
const source=html.slice(start+8,end);

test('full application JavaScript compiles',()=>{
 assert.doesNotThrow(()=>new vm.Script(source,{filename:'index.html'}));
});

test('fonts are served on this origin and reconnect banner stays below the toolbar',()=>{
 assert.ok(html.includes('href="/fonts/prompt.css"'));
 assert.ok(!html.includes('href="https://fonts.googleapis.com/css2'));
 const css=html.slice(html.indexOf('#cloudBanner{'),html.indexOf('#cloudBanner.show{'));
 assert.match(css,/bottom:46px/);
 assert.match(css,/top:auto/);
 assert.match(css,/pointer-events:none/);
});

test('animation frame batching avoids rebuilding inspectors 60 times per second',()=>{
 const i=source.indexOf('let lastUiPaintAt='),j=source.indexOf('function renderTextBar()',i);
 assert.ok(i>=0&&j>i);
 const callbacks=[],counts={canvas:0,inspector:0,boards:0};
 let nextId=1;
 const c={
  cloud:{ready:false},state:{currentId:'board',tool:'selection',selected:[],gesture:{mode:'pan'},multiArrow:null},
  editor:null,raf:0,doc:()=>({id:'board'}),
  requestAnimationFrame(fn){callbacks.push(fn);return nextId++;},
  renderCanvas(){counts.canvas++;},renderInspector(){counts.inspector++;},
  renderBoards(){counts.boards++;},renderAlignBar(){},renderTextBar(){},renderStrokeBar(){},
  renderHint(){},drawRemoteCursors(){},cloudSchedule(){}
 };
 vm.createContext(c);
 vm.runInContext(source.slice(i,j)+'\nthis.runRender=scheduleRender;',c);
 for(let n=0;n<120;n++){
  c.runRender();
  const cb=callbacks.shift();assert.ok(cb,'frame was requested');cb(n*16);
 }
 assert.equal(counts.canvas,120);
 assert.ok(counts.inspector<15,'heavy inspector repaint must be throttled');
 assert.equal(counts.inspector,counts.boards);
});

test('visibility wake sends a ping without forcibly killing a slow iPad socket',()=>{
 const i=source.indexOf('function cloudWake(){'),j=source.indexOf("document.addEventListener('visibilitychange',cloudWake)",i);
 assert.ok(i>=0&&j>i);
 let killed=0,seen=0;
 const c={
  document:{hidden:false},cloud:{synced:true,online:true,retries:3,socket:{readyState:1,close(){killed++;}}},
  WebSocket:{OPEN:1,CLOSING:2},Date:{now:()=>12345678},
  wsSend(){seen++;return true;},clearTimeout(){},cloudConnect(){throw Error('should not reconnect')}
 };
 vm.createContext(c);
 vm.runInContext(source.slice(i,j)+'\nthis.wake=cloudWake;',c);
 c.wake();assert.equal(killed,0);assert.equal(seen,1);assert.equal(c.cloud.resumeGraceUntil,12365678);
 c.document.hidden=true;c.wake();assert.equal(seen,1);
});

test('reconnect banner appears only after a slow reconnect, then clears',()=>{
 const i=source.indexOf('let cloudBannerTimer='),j=source.indexOf('function cloudRefreshFromServer(',i);
 assert.ok(i>=0&&j>i);
 const elements=new Map(),timeouts=[];
 const c={
  cloud:{online:false},
  $:id=>elements.get(id),
  document:{createElement(){return {id:'',textContent:'',classList:{set:new Set(),add(x){this.set.add(x);},remove(x){this.set.delete(x);},contains(x){return this.set.has(x);}},setAttribute(){}};},
   body:{appendChild(el){elements.set('#'+el.id,el);}}},
  clearTimeout(){},
  setTimeout(fn){timeouts.push(fn);return timeouts.length;}
 };
 vm.createContext(c);vm.runInContext(source.slice(i,j)+'\nthis.banner=cloudBanner;',c);
 c.banner('Connection interrupted');const el=elements.get('#cloudBanner');
 assert.ok(el);assert.equal(el.classList.contains('show'),false);
 assert.equal(timeouts.length,1);timeouts.shift()();
 assert.equal(el.classList.contains('show'),true);
 c.banner('');assert.equal(el.classList.contains('show'),false);
});

test('multiple cloudConnect calls cannot create duplicate active websocket sessions',()=>{
 const i=source.indexOf('function cloudConnect(){'),j=source.indexOf('function cloudWake(){',i);
 assert.ok(i>=0&&j>i);
 const list=[];
 class FakeWebSocket{
  static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;
  constructor(url){this.url=url;this.readyState=0;list.push(this);}
  close(){this.readyState=3;}
 }
 const c={
  cloud:{socket:null,synced:true,retryTimer:null,ready:false,online:false,inFlight:null,retries:0,lastPong:0},
  WebSocket:FakeWebSocket,location:{protocol:'https:',host:'test.example'},
  document:{hidden:false},localStorage:{getItem:()=>null},
  clearTimeout(){},clearInterval(){},setTimeout(){return 42;},
  cloudBanner(){},cloudGateway(){},showCloudStatus(){},wsSend(){return true;},
  $:()=>({classList:{add(){},remove(){}}}),console,fetch:async()=>({ok:true,json:async()=>({authenticated:true})}),
  Date:{now:()=>1000},Math,AbortController
 };
 vm.createContext(c);vm.runInContext(source.slice(i,j)+'\nthis.connect=cloudConnect;',c);
 c.connect();c.connect();assert.equal(list.length,1);
 list[0].readyState=FakeWebSocket.OPEN;c.connect();assert.equal(list.length,1);
});
