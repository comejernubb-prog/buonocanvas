import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import '../v13-core.js';

const lib=globalThis.BuonoV13;
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/tAAAAABJRU5ErkJggg==','base64');
const data={type:'buonocanvas-editable-png',version:1,document:{name:'ไทย test',elements:[{id:'a',type:'arrow',x:1,y:2,w:10,h:20}]}};
const embedded=lib.embedEditablePng(png,data);
assert.notEqual(embedded.length,png.length);
assert.deepEqual(lib.readEditablePng(embedded),data);
assert.equal(lib.readEditablePng(png),null);
const embeddedAgain=lib.embedEditablePng(embedded,data);
assert.equal(Buffer.compare(Buffer.from(embeddedAgain),Buffer.from(embedded)),0,'embedding should be idempotent');
assert.ok(lib.markerPath('triangle',{x:10,y:12},{x:1,y:0},2).path.includes('Z'));
assert.ok(lib.markerSvg('circle_outline',{x:10,y:12},{x:1,y:0},2,'#333333').includes('<circle'));
assert.equal(lib.markerSvg('none',{x:10,y:12},{x:1,y:0},2,'#000000'),'');
assert.equal(lib.strokeDash({dash:'dashed',strokeWidth:3,dashLength:12,dashGap:5}),'12 5');
assert.equal(lib.strokeDash({dash:'solid'}),'none');
const rotated=lib.imageBounds({x:0,y:0,w:100,h:200,rotation:90});for(const [key,value] of Object.entries({x:-50,y:50,w:200,h:100}))assert.ok(Math.abs(rotated[key]-value)<1e-7,key+' rotated image bounds');
const img=lib.imageSvg({type:'image',x:0,y:0,w:100,h:60,src:'/api/assets/abc.png',crop:{x:.2,y:.1,w:.7,h:.8},rotation:90,flipX:true},v=>v);
assert.ok(img.includes('rotate(90)')&&img.includes('viewBox=')&&img.includes('overflow="hidden"'));

const html=readFileSync(resolve('index.html'),'utf8');
const scripts=[...html.matchAll(/<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/g)];
assert.ok(scripts.length>=1,'find inline scripts');
for(const [,source] of scripts)if(source.trim())new vm.Script(source,{filename:'index-inline.js'});
console.log('v13 module/PNG metadata/canvas source syntax tests passed');
