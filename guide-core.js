/* Keyboard boundary refinement, independent of note colour. */
(function(root){'use strict';
function refineTop(data,width,height,coarse,anchor,step){
 const lum=(x,y)=>{const i=(y*width+Math.round(x))*4;return .2126*data[i]+.7152*data[i+1]+.0722*data[i+2]};
 const edges=[];let count=0;const radius=Math.max(8,Math.round(height*.025));
 for(let j=Math.floor(-anchor/step);j<Math.ceil((width-anchor)/step);j++){
  const x=anchor+(j+.5)*step;if(x<2||x>=width-2)continue;count++;
  let best=null;
  for(let y=Math.max(3,Math.round(coarse)-radius);y<=Math.min(height-5,Math.round(coarse)+radius);y++){
   const before=(lum(x,y-2)+lum(x,y-1))/2,after=(lum(x,y)+lum(x,y+1))/2,jump=after-before;
   if(after>115&&jump>35&&(!best||jump>best.jump))best={y,jump};
  }
  if(best)edges.push(best.y);
 }
 if(edges.length<Math.max(8,count*.4))return null;
 edges.sort((a,b)=>a-b);const median=edges[Math.floor(edges.length/2)],agree=edges.filter(y=>Math.abs(y-median)<=2);
 if(agree.length<edges.length*.65)return null;
 return {y:median,agreement:agree.length,samples:count};
}
function safeHitLine(data,width,height,top,anchor,step){
 top=Math.max(3,Math.min(height-1,Math.round(top)));const values=[],rises=[];
 const lum=(x,y)=>{const i=(y*width+Math.round(x))*4;return .2126*data[i]+.7152*data[i+1]+.0722*data[i+2]};
 for(let j=Math.floor(-anchor/step);j<Math.ceil((width-anchor)/step);j++){const x=anchor+(j+.5)*step;if(x<1||x>=width-1)continue;values.push(lum(x,top-1));rises.push(lum(x,top-1)-lum(x,top-3));}
 values.sort((a,b)=>a-b);rises.sort((a,b)=>a-b);const mid=Math.floor(values.length/2);
 // A resampled keyboard edge can bleed into the pixel just above it.
 return Math.max(0,top-(values[mid]>45&&rises[mid]>20?2:1));
}
const api={refineTop,safeHitLine};if(typeof module==='object'&&module.exports)module.exports=api;else root.PianoRollGuideCore=api;
})(globalThis);
