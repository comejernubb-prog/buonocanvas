/* buonocanvas vector PDF writer: no external JS libraries / no rasterization of shapes.
 * All paths, Bézier strokes, rectangles, ellipses and arrowheads remain native PDF operators.
 * Embedded photos are image XObjects (JPEG bytes are embedded without re-encoding).
 * Typography is rendered as transparent, high-resolution glyph images so Thai Prompt stays faithful
 * without shipping/restricting a proprietary font file. */
(() => {
'use strict';
const TE=new TextEncoder();
const num=n=>Number.isFinite(Number(n))?Number(Number(n).toFixed(4)).toString():'0';
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
function color(value){
 const s=String(value||'').trim().toLowerCase();if(!s||s==='none'||s==='transparent')return null;
 const named={white:'#ffffff',black:'#000000',red:'#ff0000',blue:'#0000ff',gray:'#808080',grey:'#808080'};
 let hex=named[s]||s; if(/^#[0-9a-f]{3}$/.test(hex))hex='#'+[...hex.slice(1)].map(x=>x+x).join('');
 if(/^#[0-9a-f]{6}$/.test(hex))return [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
 const rgb=hex.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);if(rgb)return rgb.slice(1).map(x=>clamp(Number(x)/255,0,1));
 return [0,0,0];
}
function setColor(v,stroke=false){const c=color(v);return c?c.map(num).join(' ')+(stroke?' RG\n':' rg\n'):'';}
function pdfShapePath(el,shapePath){
 if(el.type==='ellipse'){
  const l=Math.min(el.x,el.x+el.w),r=Math.max(el.x,el.x+el.w),t=Math.min(el.y,el.y+el.h),b=Math.max(el.y,el.y+el.h),cx=(l+r)/2,cy=(t+b)/2,rx=(r-l)/2,ry=(b-t)/2,k=.5522847498307936;
  return `${num(cx+rx)} ${num(cy)} m\n`+
   `${num(cx+rx)} ${num(cy+ry*k)} ${num(cx+rx*k)} ${num(cy+ry)} ${num(cx)} ${num(cy+ry)} c\n`+
   `${num(cx-rx*k)} ${num(cy+ry)} ${num(cx-rx)} ${num(cy+ry*k)} ${num(cx-rx)} ${num(cy)} c\n`+
   `${num(cx-rx)} ${num(cy-ry*k)} ${num(cx-rx*k)} ${num(cy-ry)} ${num(cx)} ${num(cy-ry)} c\n`+
   `${num(cx+rx*k)} ${num(cy-ry)} ${num(cx+rx)} ${num(cy-ry*k)} ${num(cx+rx)} ${num(cy)} c\nh\n`;
 }
 return svgPathToPdf(shapePath(el));
}
function svgPathToPdf(d){
 const tokens=String(d||'').match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g)||[];
 let i=0,op='',x=0,y=0,sx=0,sy=0,result='';
 const isCmd=t=>/^[a-zA-Z]$/.test(t||'');
 const arg=()=>{const t=tokens[i++];if(t===undefined||isCmd(t))throw new Error('Invalid SVG path');const n=Number(t);if(!Number.isFinite(n))throw new Error('Invalid SVG path coordinate');return n;};
 while(i<tokens.length){
  if(isCmd(tokens[i]))op=tokens[i++];if(!op)throw new Error('Missing SVG path command');
  const relative=op===op.toLowerCase(),key=op.toUpperCase();
  if(key==='Z'){result+='h\n';x=sx;y=sy;op='';continue;}
  if(!['M','L','H','V','Q','C'].includes(key))throw new Error('Unsupported vector path command: '+key);
  const xVal=()=>{const n=arg();return relative?x+n:n;};
  const yVal=()=>{const n=arg();return relative?y+n:n;};
  if(key==='M'||key==='L'){
   const nx=xVal(),ny=yVal();x=nx;y=ny;
   if(key==='M'){sx=x;sy=y;result+=`${num(x)} ${num(y)} m\n`;op=relative?'l':'L';}
   else result+=`${num(x)} ${num(y)} l\n`;
  }else if(key==='H'){x=xVal();result+=`${num(x)} ${num(y)} l\n`;}
  else if(key==='V'){y=yVal();result+=`${num(x)} ${num(y)} l\n`;}
  else if(key==='Q'){
   let qx=xVal(),qy=yVal(),nx=xVal(),ny=yVal();
   const c1x=x+2/3*(qx-x),c1y=y+2/3*(qy-y),c2x=nx+2/3*(qx-nx),c2y=ny+2/3*(qy-ny);
   result+=`${num(c1x)} ${num(c1y)} ${num(c2x)} ${num(c2y)} ${num(nx)} ${num(ny)} c\n`;x=nx;y=ny;
  }else if(key==='C'){
   let c1x=xVal(),c1y=yVal(),c2x=xVal(),c2y=yVal(),nx=xVal(),ny=yVal();
   result+=`${num(c1x)} ${num(c1y)} ${num(c2x)} ${num(c2y)} ${num(nx)} ${num(ny)} c\n`;x=nx;y=ny;
  }
 }
 return result;
}
async function deflate(bytes){if(typeof CompressionStream!=='function')throw new Error('Vector PDF images require a modern browser (CompressionStream)');
 const stream=new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));return new Uint8Array(await new Response(stream).arrayBuffer());}
async function rawImageData(rgba,width,height){
 const count=width*height,rgb=new Uint8Array(count*3),alpha=new Uint8Array(count);let hasAlpha=false;
 for(let p=0,i=0,j=0;p<count;p++,i+=4,j+=3){rgb[j]=rgba[i];rgb[j+1]=rgba[i+1];rgb[j+2]=rgba[i+2];alpha[p]=rgba[i+3];if(rgba[i+3]<255)hasAlpha=true;}
 const out={width,height,filter:'FlateDecode',data:await deflate(rgb)};if(hasAlpha)out.mask=await deflate(alpha);return out;
}
async function imageResource(src,metadata={}){
 const res=await fetch(src,{credentials:'same-origin'});if(!res.ok)throw new Error('Cannot load original image for PDF export ('+res.status+')');
 const blob=await res.blob();let bmp;
 try{
  const magic=new Uint8Array(await blob.slice(0,3).arrayBuffer());
  const isJPEG=magic[0]===255&&magic[1]===216&&magic[2]===255;
  if(isJPEG&&Number.isInteger(metadata.originalWidth)&&metadata.originalWidth>0&&Number.isInteger(metadata.originalHeight)&&metadata.originalHeight>0){
   return {width:metadata.originalWidth,height:metadata.originalHeight,filter:'DCTDecode',data:new Uint8Array(await blob.arrayBuffer())};
  }
  bmp=await createImageBitmap(blob);const width=bmp.width,height=bmp.height;if(!width||!height)throw new Error('Empty image');
  if(isJPEG){const data=new Uint8Array(await blob.arrayBuffer());return {width,height,filter:'DCTDecode',data};}
  if(width*height>35000000)throw new Error('This raster image exceeds the safe PDF conversion pixel limit; JPEG originals can be embedded at any resolution');
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bmp,0,0);const img=ctx.getImageData(0,0,width,height);return await rawImageData(img.data,width,height);
 }finally{bmp?.close?.();}
}
function formatTextGlyph(el,textLayout,textMeasure,noteLayout){
 const isNote=el.type==='note';const b=isNote?{x:Math.min(el.x,el.x+el.w),y:Math.min(el.y,el.y+el.h),w:Math.abs(el.w),h:Math.abs(el.h)}:textMeasure(el);
 const scale=Math.min(2.5,4096/Math.max(1,b.w,b.h));const w=Math.max(1,Math.ceil(b.w*scale)),h=Math.max(1,Math.ceil(b.h*scale));
 const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.scale(scale,scale);ctx.translate(-b.x,-b.y);
 ctx.fillStyle=el.stroke||'#111111';ctx.textBaseline='alphabetic';
 if(isNote&&noteLayout){const L=noteLayout(el);ctx.font=`500 ${L.fontSize}px Prompt,Arial,sans-serif`;L.lines.forEach((line,i)=>ctx.fillText(line,L.b.x+16,L.b.y+16+L.fontSize*1.1+i*L.lineHeight));}
 else if(isNote){const f=el.fontSize||24;ctx.font=`700 ${f}px Prompt,Arial,sans-serif`;(el.text||'').split('\n').forEach((line,i)=>ctx.fillText(line, b.x+14,b.y+f+14+i*f*1.3));}
 else if(el.textBoxVersion===2){const layout=textLayout(el);ctx.font=`${layout.fontWeight} ${layout.fontSize}px Prompt,Arial,sans-serif`;layout.lines.forEach((line,i)=>ctx.fillText(line, el.x+layout.pad,el.y+layout.pad+layout.fontSize*1.1+i*layout.lineHeight));}
 else {const font=el.fontSize||24;ctx.save();ctx.translate(el.x,el.y);ctx.scale(el.textScaleX||1,el.textScaleY||1);ctx.font=`700 ${font}px Prompt,Arial,sans-serif`;(el.text||'').split('\n').forEach((line,i)=>ctx.fillText(line,0,font+i*font*1.38));ctx.restore();}
 return {canvas,b};
}
function pdfCircle(x,y,r){const k=.5522847498307936;return `${num(x+r)} ${num(y)} m\n${num(x+r)} ${num(y+r*k)} ${num(x+r*k)} ${num(y+r)} ${num(x)} ${num(y+r)} c\n${num(x-r*k)} ${num(y+r)} ${num(x-r)} ${num(y+r*k)} ${num(x-r)} ${num(y)} c\n${num(x-r)} ${num(y-r*k)} ${num(x-r*k)} ${num(y-r)} ${num(x)} ${num(y-r)} c\n${num(x+r*k)} ${num(y-r)} ${num(x+r)} ${num(y-r*k)} ${num(x+r)} ${num(y)} c\nh\n`;}
function makePdfWriter(){
 const objects=[],push=(body)=>{objects.push(body);return objects.length;};
 const set=(i,body)=>{objects[i-1]=body;};
 const stream=(dict,data)=>({dict,bytes:data instanceof Uint8Array?data:TE.encode(data)});
 const encode=()=>{
  const parts=[],offsets=[0];let total=0;
  const append=data=>{const bytes=typeof data==='string'?TE.encode(data):data;parts.push(bytes);total+=bytes.length;};
  append(new Uint8Array([37,80,68,70,45,49,46,52,10,37,226,227,207,211,10]));
  for(let i=0;i<objects.length;i++){
   offsets[i+1]=total;append(`${i+1} 0 obj\n`);
   const body=objects[i];if(body&&typeof body==='object'&&body.bytes){append(`<< ${body.dict} /Length ${body.bytes.length} >>\nstream\n`);append(body.bytes);append('\nendstream\n');}
   else append(body||'');append('\nendobj\n');
  }
  const startXref=total;append(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`);
  for(let n=1;n<=objects.length;n++)append(String(offsets[n]).padStart(10,'0')+' 00000 n \n');
  append(`trailer\n<< /Root 1 0 R /Size ${objects.length+1} >>\nstartxref\n${startXref}\n%%EOF`);
  return new Blob(parts,{type:'application/pdf'});
 };
 return {push,set,stream,encode};
}
async function build({elements,bounds,background,shapePath,arrowHead,arrowEnds,textLayout,textMeasure,noteLayout}){
 if(!Array.isArray(elements)||!bounds||bounds.w<=0||bounds.h<=0)throw new Error('Invalid canvas');
 const scale=Math.min(.75,14400/bounds.w,14400/bounds.h),W=bounds.w*scale,H=bounds.h*scale;
 const pdf=makePdfWriter(),catalog=pdf.push(''),pages=pdf.push(''),page=pdf.push(''),contentId=pdf.push('');
 const images=new Map(),gstates=new Map(),commands=[];
 const imageNames=[],gsNames=[];
 let counter=0;
 function graphicsAlpha(opacity){const a=clamp(Number(opacity??100)/100,0,1);if(a>=.999)return'';const key=num(a);if(!gstates.has(key)){
   const id=pdf.push(`<< /Type /ExtGState /CA ${key} /ca ${key} >>`),name='G'+gstates.size;
   gstates.set(key,{id,name});gsNames.push(`/${name} ${id} 0 R`);
  }
  return `/${gstates.get(key).name} gs\n`;
 }
 async function addImage(img){
  const id=pdf.push('');let maskId=null;
  if(img.mask){maskId=pdf.push(pdf.stream(`/Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`,img.mask));}
  pdf.set(id,pdf.stream(`/Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${img.filter}`+(maskId?` /SMask ${maskId} 0 R`:''),img.data));
  const name='Im'+(++counter);imageNames.push(`/${name} ${id} 0 R`);return name;
 }
 function placeImage(name,box,opacity){commands.push('q\n'+graphicsAlpha(opacity)+`${num(box.w)} 0 0 ${num(-box.h)} ${num(box.x)} ${num(box.y+box.h)} cm\n/${name} Do\nQ\n`);}
 function drawPath(path,fill,stroke,width,opacity,dash='solid'){
  if(!path)return;
  const f=color(fill),s=color(stroke);if(!f&&!s)return;
  let cmd='q\n'+graphicsAlpha(opacity);
  if(f)cmd+=setColor(fill,false);
  if(s)cmd+=setColor(stroke,true)+`${num(Math.max(.1,width))} w\n1 J\n1 j\n`;
  if(s&&dash==='dashed')cmd+='[9 7] 0 d\n';else if(s&&dash==='dotted')cmd+='[2 7] 0 d\n';
  cmd+=path+(f&&s?'B\n':f?'f\n':'S\n')+'Q\n';commands.push(cmd);
 }
 drawPath(`${num(bounds.x)} ${num(bounds.y)} ${num(bounds.w)} ${num(bounds.h)} re\n`,background||'#ffffff',null,0,100);
 for(const el of elements){
  const type=el.type,w=Number(el.strokeWidth)||2;
  if(type==='image'){
   if(!el.src)continue;
   if(!images.has(el.src))images.set(el.src, await addImage(await imageResource(el.src,el)));
   const box={x:Math.min(el.x,el.x+el.w),y:Math.min(el.y,el.y+el.h),w:Math.abs(el.w),h:Math.abs(el.h)};
   placeImage(images.get(el.src),box,el.opacity);continue;
  }
  if(type==='text'||type==='note'){
   if(type==='note')drawPath(pdfShapePath(el,shapePath),el.fill&&el.fill!=='transparent'?el.fill:'#FFE9A8',null,0,el.opacity);
   const {canvas,b}=formatTextGlyph(el,textLayout,textMeasure,noteLayout);
   if(!el.text?.trim())continue;
   const rgba=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height);
   const name=await addImage(await rawImageData(rgba.data,canvas.width,canvas.height));placeImage(name,b,el.opacity);continue;
  }
  drawPath(pdfShapePath(el,shapePath),el.fill,el.stroke,w,el.opacity,el.dash);
  if(type==='arrow')drawPath(svgPathToPdf(arrowHead(el)),null,el.stroke,w,el.opacity);
  if(type==='line'){
   const {a,b}=arrowEnds(el),r=Math.max(3.5,w*1.8);
   for(const point of [a,b])drawPath(pdfCircle(point.x,point.y,r),'#ffffff',el.stroke,Math.max(1.35,w*.72),el.opacity);
  }
 }
 // A single graphics-state matrix flips the Y axis into SVG's top-down coordinate system.
 const streamText=`q\n${num(scale)} 0 0 ${num(-scale)} ${num(-bounds.x*scale)} ${num(H+bounds.y*scale)} cm\n${commands.join('')}Q\n`;
 pdf.set(contentId,pdf.stream('',streamText));
 pdf.set(catalog,'<< /Type /Catalog /Pages 2 0 R >>');pdf.set(pages,'<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
 pdf.set(page,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(W)} ${num(H)}] /Resources << /XObject << ${imageNames.join(' ')} >> /ExtGState << ${gsNames.join(' ')} >> >> /Contents 4 0 R >>`);
 return pdf.encode();
}
window.BuonoVectorPDF={build,svgPathToPdf};
})();
