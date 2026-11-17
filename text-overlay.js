/* Fixed captions: text-shaped neutral components plus temporal pixel evidence. */
(function(root){'use strict';
function detect(data,width,height,keyboardY){
 const limit=Math.max(0,Math.min(height,Math.floor(keyboardY)-6)),mask=new Uint8Array(width*limit),seen=new Uint8Array(mask.length),components=[];
 for(let y=0;y<limit;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4,r=data[i],g=data[i+1],b=data[i+2],hi=Math.max(r,g,b),lo=Math.min(r,g,b);if(.2126*r+.7152*g+.0722*b>100&&hi-lo<Math.max(18,hi*.13))mask[y*width+x]=1;}
 const maxH=Math.max(24,Math.round(height*.12));
 for(let k=0;k<mask.length;k++){if(!mask[k]||seen[k])continue;const queue=[k];seen[k]=1;let a=width,b=limit,c=0,d=0;
  for(let n=0;n<queue.length;n++){const p=queue[n],x=p%width,y=Math.floor(p/width);a=Math.min(a,x);b=Math.min(b,y);c=Math.max(c,x);d=Math.max(d,y);for(let yy=Math.max(0,y-1);yy<=Math.min(limit-1,y+1);yy++)for(let xx=Math.max(0,x-1);xx<=Math.min(width-1,x+1);xx++){const q=yy*width+xx;if(mask[q]&&!seen[q]){seen[q]=1;queue.push(q);}}}
  const w=c-a+1,h=d-b+1,fill=queue.length/(w*h);if(h>=5&&h<=maxH&&w>=2&&w<=h*2.8&&fill>=.1&&fill<.8)components.push({x:a,y:b,w,h,bottom:d});
 }
 const groups=[];
 for(const c of components.sort((a,b)=>a.x-b.x)){let g=groups.find(g=>Math.abs(g.bottom-c.bottom)<=Math.max(3,Math.max(g.h,c.h)*.28)&&Math.min(g.h,c.h)>=Math.max(g.h,c.h)*.45&&c.x-g.right<=Math.max(g.h,c.h)*2.8);if(!g){g={parts:[],bottom:c.bottom,h:c.h,right:c.x+c.w};groups.push(g);}g.parts.push(c);g.bottom=g.parts.reduce((s,p)=>s+p.bottom,0)/g.parts.length;g.h=Math.max(g.h,c.h);g.right=Math.max(g.right,c.x+c.w);}
 const regions=[];
 for(const g of groups){if(g.parts.length<5)continue;const x=Math.max(0,Math.min(...g.parts.map(p=>p.x))-2),y=Math.max(0,Math.min(...g.parts.map(p=>p.y))-2),right=Math.min(width,Math.max(...g.parts.map(p=>p.x+p.w))+2),bottom=Math.min(limit,Math.max(...g.parts.map(p=>p.y+p.h))+2);if(right-x<g.h*3)continue;
  const rgb=[];for(let yy=y;yy<bottom;yy++)for(let xx=x;xx<right;xx++){const i=(yy*width+xx)*4;rgb.push(data[i],data[i+1],data[i+2]);}regions.push({x,y,width:right-x,height:bottom-y,glyphs:g.parts.length,rgb});
 }
 return{method:'neutral-glyph-shape-and-static-pixels',regions:regions.slice(0,32)};
}
function createGuard(lines,lanes,overlay,{fps}){
 if(!overlay?.regions?.length)return null;
 const signatures=lines.map(y=>{const m=new Map();for(const lane of lanes){const region=overlay.regions.find(r=>y>=r.y&&y<r.y+r.height&&lane.x>=r.x&&lane.x<r.x+r.width);if(!region)continue;const rowYs=[...new Set([y,...[.2,.5,.8].map(f=>region.y+Math.round((region.height-1)*f))])],rows=[];
  for(const yy of rowYs){const index=lines.indexOf(yy);if(index<0)continue;const pts=[];let bright=0,dark=0;for(let x=Math.max(region.x,Math.round(lane.x-lane.w*1.3));x<Math.min(region.x+region.width,Math.round(lane.x+lane.w*1.3));x++){const i=((yy-region.y)*region.width+x-region.x)*3,c=region.rgb.slice(i,i+3),lum=.2126*c[0]+.7152*c[1]+.0722*c[2];if(lum>100)bright++;if(lum<85)dark++;pts.push({x,c});}if(bright>=2&&dark>=2)rows.push({index,pts});}if(rows.length>=2)m.set(lane.pitch,rows);}return m;});
 const runs=lines.map(()=>new Map()),all=lines.map(()=>new Map());let rejected=0;
 const save=(i,p,r)=>{if(r&&r.samples>=3&&r.end-r.start>=.25){if(!all[i].has(p))all[i].set(p,[]);all[i].get(p).push(r);}};
 return{observe(time,hits,rawRows){if(!rawRows)return;for(let i=0;i<lines.length;i++)for(const hit of hits[i]){const signature=signatures[i].get(hit.pitch);if(!signature)continue;const hi=Math.max(...hit.colorRGB),lo=Math.min(...hit.colorRGB);let same=hi-lo<Math.max(24,hi*.18);if(same)same=signature.every(({index,pts})=>{let matched=0;for(const {x,c} of pts){const k=x*4;if(Math.hypot(rawRows[index][k]-c[0],rawRows[index][k+1]-c[1],rawRows[index][k+2]-c[2])<35)matched++;}return matched>=pts.length*.9;});
   let r=runs[i].get(hit.pitch);if(!same||r&&time-r.end>1.6/fps){save(i,hit.pitch,r);runs[i].delete(hit.pitch);r=null;}if(same){if(!r){r={start:time,end:time,samples:0};runs[i].set(hit.pitch,r);}r.end=time;r.samples++;}
  }},filter(notes,i){for(const [p,r] of runs[i])save(i,p,r);runs[i].clear();return notes.filter(n=>{const spans=all[i].get(n.midiPitch)||[],length=Math.max(1/fps,n.endSeconds-n.startSeconds),covered=spans.reduce((sum,r)=>sum+Math.max(0,Math.min(n.endSeconds,r.end+1/fps)-Math.max(n.startSeconds,r.start-1/fps)),0);if(covered>=length*.7){rejected++;return false;}return true;});},diagnostics(){return{textOverlayRegions:overlay.regions.length,textOverlayBoxes:overlay.regions.map(({rgb,...box})=>box),textOverlayRejectedObservations:rejected};}};
}
function validationLines(base,overlay){const out=base.slice();for(const r of overlay?.regions||[]){if(!base.some(y=>y>=r.y&&y<r.y+r.height))continue;for(const f of [.2,.5,.8]){const y=r.y+Math.round((r.height-1)*f);if(!out.includes(y))out.push(y);}}return out;}
const api={detect,createGuard,validationLines};if(typeof module==='object'&&module.exports)module.exports=api;else root.PianoRollTextOverlay=api;
})(globalThis);
