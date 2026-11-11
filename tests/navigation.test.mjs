import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=html.slice(html.lastIndexOf('<script>')+8,html.lastIndexOf('</script>'));
const section=(start,end)=>{const i=source.indexOf(start),j=source.indexOf(end,i+start.length);assert.ok(i>=0&&j>i,start);return source.slice(i,j);};
test('v16 application compiles and uses Hand by default',()=>{
 assert.doesNotThrow(()=>new vm.Script(source,{filename:'buonocanvas.js'}));
 assert.match(source,/tool:'hand',selected:\[\]/);
 assert.match(html,/id="drawing" class="tool-hand"/);
 assert.match(source,/autoTarget\?'selection':state.tool/);
});
test('hit testing selects near a shape, but lets the blank canvas pan',()=>{
 const d={zoom:1,elements:[{id:'a',type:'rectangle',x:100,y:100,w:80,h:60}]};
 const context={doc:()=>d,state:{multiArrow:null,selected:[]},mouseAt:e=>({x:e.clientX,y:e.clientY}),
  bbox:e=>({x:e.x,y:e.y,w:e.w,h:e.h}),textBoxHitAt:()=>null,isConnector:e=>['arrow','line'].includes(e.type),
  curveGeometry:()=>null,curveHitDistance:()=>Infinity,arrowPoints:()=>[],distanceToSegment:()=>Infinity,Math,Number};
 vm.createContext(context);
 vm.runInContext(section('function smartHoverTarget(e){','let smartHoverFrame='),context);
 const evt=(x,y)=>({clientX:x,clientY:y,target:{closest:()=>null}});
 assert.equal(context.smartHoverTarget(evt(220,230)),null);
 assert.equal(context.smartHoverTarget(evt(106,130))?.id,'a');
 assert.equal(context.smartHoverTarget(evt(93,130))?.id,'a','7px from object edge selects');
 assert.equal(context.smartHoverTarget(evt(89,130)),null,'11px from object edge pans');
 d.zoom=.5;
 assert.equal(context.smartHoverTarget(evt(85,130))?.id,'a','near hitbox remains screen-pixel based at 50% zoom');
});
test('text takes priority over a connector hit surface in Smart Hand',()=>{
 const arrow={id:'arrow',type:'arrow',x:0,y:0,w:200,h:100};
 const textItem={id:'txt',type:'text',x:50,y:25,w:90,h:30};
 const d={zoom:1,elements:[textItem,arrow]};
 const c={doc:()=>d,state:{multiArrow:null,selected:[]},mouseAt:e=>({x:e.clientX,y:e.clientY}),
  bbox:e=>({x:e.x,y:e.y,w:e.w,h:e.h}),textBoxHitAt:p=>p.x>=50&&p.x<140&&p.y>=25&&p.y<55?textItem:null,
  isConnector:e=>e.type==='arrow',curveGeometry:()=>null,curveHitDistance:()=>0,arrowPoints:()=>[{x:0,y:0},{x:200,y:100}],
  distanceToSegment:()=>0,Math,Number};
 vm.createContext(c);vm.runInContext(section('function smartHoverTarget(e){','let smartHoverFrame='),c);
 const e={clientX:70,clientY:40,target:{closest:()=>({getAttribute:()=>arrow.id})}};
 assert.equal(c.smartHoverTarget(e)?.id,'txt');
});
test('navigation uses a lightweight camera rendering path and no wheel/pan freeze',()=>{
 assert.match(source,/function renderViewportOnly\(\)/);
 assert.match(source,/function scheduleRender\(viewOnly=false\)/);
 assert.match(source,/function viewChanged\(\)\{scheduleRender\(true\)/);
 assert.match(source,/wheelQueue\.push\(\{mode:'zoom'/);
 assert.ok(!source.includes('performance.now()-lastWheelAt<300'),'middle-button panning is not blocked after scroll');
 assert.ok(!source.includes('g.middle?4:8'),'middle-button starts without deadzone');
});
