// Restrict video color conversion to a padded source strip surrounding the hit line.
// Keep the original sample transform, scaling and interpolation unchanged.
export function sourceStrip(display,coded,width,height,y){
 const [a,b,c,d,e,f]=display.transform,det=a*d-b*c;
 if(![a,b,c,d,e,f,det,width,height,y,coded.width,coded.height].every(Number.isFinite)||Math.abs(det)<1e-12||width<1||height<1)return null;
 const points=[];
 for(const x of [0,display.width])for(const v of [y*display.height/height,(y+1)*display.height/height]){const u=x-e,w=v-f;points.push([(d*u-c*w)/det,(-b*u+a*w)/det]);}
 const clamp=(n,max)=>Math.max(0,Math.min(max,n));
 // Chroma-aligned origins; four source pixels of padding preserve filter neighbors.
 const left=clamp(Math.floor((Math.min(...points.map(p=>p[0]))-4)/2)*2,coded.width),top=clamp(Math.floor((Math.min(...points.map(p=>p[1]))-4)/2)*2,coded.height);
 const right=clamp(Math.ceil((Math.max(...points.map(p=>p[0]))+4)/2)*2,coded.width),bottom=clamp(Math.ceil((Math.max(...points.map(p=>p[1]))+4)/2)*2,coded.height);
 if(right<=left||bottom<=top)return null;
 return {x:left,y:top,width:right-left,height:bottom-top};
}
export function createRowReader({ctx,width,height,hitLineY,display,codedSize,metrics,mode='auto',preserveColor=false}){
 const rect=sourceStrip(display,codedSize,width,height,hitLineY);
 let disabled=mode==='full'||!rect,reason=disabled?(mode==='full'?'full-frame-requested':'strip-geometry'):null;
 const original=(frame)=>{if(display.direct)ctx.drawImage(frame,0,-hitLineY,width,height);else ctx.drawImage(frame,0,0,codedSize.width,codedSize.height);};
 const transform=()=>{if(!display.direct){const [a,b,c,d,e,f]=display.transform,sx=width/display.width,sy=height/display.height;ctx.setTransform(sx*a,sy*b,sx*c,sy*d,sx*e,sy*f-hitLineY);}};
 return frame=>{
  let crop=null;const start=performance.now();transform();
  try{
   const v=frame.visibleRect;
   // Unknown padding, decoder crop or intrinsic orientation: preserve the established path.
   const safe=v&&v.x===0&&v.y===0&&v.width===codedSize.width&&v.height===codedSize.height&&frame.displayWidth===codedSize.width&&frame.displayHeight===codedSize.height&&!(frame.rotation||frame.flip);
   const color=frame.colorSpace,conservative=preserveColor||display.mirrored||!color||!['bt709','smpte170m','bt470bg'].includes(color.primaries)||!['bt709','iec61966-2-1','smpte170m'].includes(color.transfer);
   if(!disabled&&safe&&!conservative){try{crop=new VideoFrame(frame,{visibleRect:rect,displayWidth:rect.width,displayHeight:rect.height});if(crop.displayWidth!==rect.width||crop.displayHeight!==rect.height){crop.close();crop=null;disabled=true;reason='crop-not-applied';}}catch(e){disabled=true;reason=e.name||'crop-unsupported';}}
   else if(conservative&&!disabled)reason='color-or-mirror-preservation';
   if(crop){try{
    // For the direct path, reproduce the original scale+translation as well.
    if(display.direct)ctx.setTransform(width/codedSize.width,0,0,height/codedSize.height,0,-hitLineY);
    ctx.drawImage(crop,rect.x,rect.y,rect.width,rect.height);metrics.imagePath='source-strip';metrics.sourceStrip=rect;
   }catch(e){disabled=true;reason=e.name||'crop-draw-unsupported';ctx.resetTransform();transform();original(frame);metrics.imagePath='full-frame';}}
   else {original(frame);metrics.imagePath='full-frame';if(!safe&&!disabled)reason='decoder-visible-geometry';}
  }finally{crop?.close();ctx.resetTransform();}
  const drawEnd=performance.now(),row=ctx.getImageData(0,0,width,1).data,end=performance.now();
  metrics.drawMs+=drawEnd-start;metrics.pixelReadMs+=end-drawEnd;metrics.imageMs+=end-start;
  if(reason)metrics.imagePathFallback=reason;
  return row;
 };
}
