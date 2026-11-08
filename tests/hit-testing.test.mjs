import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('function textBoxHitAt(');
const end = html.indexOf('let lastTextTap=', start);
assert.ok(start >= 0 && end > start, 'Expected hit-test implementation exists');
const funcs = html.slice(start, end);

function makeHarness({tool='selection', zoom=1, pan={x:0,y:0}, pointer='mouse'}={}) {
 const elements = [
  {id:'text-a',type:'text',x:100,y:100,w:180,h:44},
  {id:'arrow-a',type:'arrow',x:75,y:112,w:250,h:0},
  {id:'rect-a',type:'rectangle',x:350,y:100,w:100,h:100},
 ];
 const state={tool, multiArrow:null,lastPointerType:pointer};
 const d={zoom,pan,elements};
 const target=id=>({closest(selector){assert.equal(selector,'[data-id]');return id?{getAttribute:(k)=>k==='data-id'?id:null}:null;}});
 const ctx = {state,doc:()=>d,textMeasure:(el)=>({x:el.x,y:el.y,w:el.w,h:el.h}),
   mouseAt:(e)=>({x:(e.clientX-d.pan.x)/d.zoom,y:(e.clientY-d.pan.y)/d.zoom}),
   isConnector:el=>el?.type==='arrow'||el?.type==='line',Number,Math};
 const impl=vm.runInNewContext(`${funcs}\n({textBoxHitAt,hitTest})`,ctx);
 const event=(id,x,y)=>({target:target(id),clientX:d.pan.x+x*zoom,clientY:d.pan.y+y*zoom,pointerId:1});
 return{elements,d,state,event,...impl};
}

test('text wins over a connector painted on top within its visible textbox',()=>{
 const h=makeHarness();assert.equal(h.hitTest(h.event('arrow-a',140,116)), 'text-a');
});
test('text wins even if a selected connector handle is the native event target',()=>{
 const h=makeHarness();assert.equal(h.hitTest(h.event(null,170,120)), 'text-a');
 assert.match(html,/const arrowHandle=preferText\?null:rawArrowHandle;/);
 assert.match(html,/const arrowTarget=!txt&&/);
 assert.match(html,/const closestArrow=tool==='selection'&&!handle&&!preferText\?nearArrowAtPoint\(p\):null;/);
});
test('connector remains selectable when user clicks outside textbox',()=>{
 const h=makeHarness();assert.equal(h.hitTest(h.event('arrow-a',290,113)), 'arrow-a');
});
test('opaque non-connector hit above text keeps native z-order',()=>{
 const h=makeHarness();assert.equal(h.hitTest(h.event('rect-a',140,116)), 'rect-a');
});
test('drawing tools retain their existing native target selection',()=>{
 const h=makeHarness({tool:'arrow'});assert.equal(h.hitTest(h.event('arrow-a',140,116)), 'arrow-a');
});
test('panning and zooming preserve text-first selection',()=>{
 const h=makeHarness({zoom:.4,pan:{x:200,y:90}});assert.equal(h.hitTest(h.event('arrow-a',137,113)), 'text-a');
});
test('closest topmost text is preferred when textboxes overlap',()=>{
 const h=makeHarness();h.elements.push({id:'text-b',type:'text',x:110,y:103,w:60,h:30});assert.equal(h.hitTest(h.event('arrow-a',140,116)), 'text-b');
});
test('touch selection has a larger text target without altering geometry',()=>{
 const h=makeHarness({pointer:'touch'});assert.equal(h.hitTest(h.event('arrow-a',97,116)), 'text-a');
 assert.deepEqual({x:h.elements[0].x,y:h.elements[0].y,w:h.elements[0].w,h:h.elements[0].h},{x:100,y:100,w:180,h:44});
});
