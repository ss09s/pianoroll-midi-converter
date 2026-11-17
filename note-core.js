/* 0.7.50: fixed-keyboard hit-line occupancy -> absolute-second note events. */
(function(root){'use strict';
const mod=(a,n)=>(a%n+n)%n,semis=[0,2,4,5,7,9,11];
function whitePitch(index,referenceIndex,name,octave){const d=name+index-referenceIndex;return 12*(octave+1)+12*Math.floor(d/7)+semis[mod(d,7)];}
function noteName(pitch){return ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'][mod(pitch,12)]+(Math.floor(pitch/12)-1);}
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
// Follow the whole visible body through its smooth shading, rather than a
// small RGB-similar patch on one side. A body belongs to its geometric lane.
function ownsBody(pixels,width,lane,lanes){
 const x=Math.round(lane.x),i=x*4,r=pixels[i],g=pixels[i+1],b=pixels[i+2],v=Math.max(r,g,b),ch=v-Math.min(r,g,b),cap=Math.ceil(lane.w*2);
 const connected=k=>{const j=k*4,a=pixels[j],d=pixels[j+1],e=pixels[j+2],m=Math.max(a,d,e);if(m<v*.65)return false;
  if(ch<18)return m-Math.min(a,d,e)<24;
  if(m-Math.min(a,d,e)<Math.max(18,ch*.4))return false;
  const dr=a/m-r/v,dg=d/m-g/v,db=e/m-b/v;return dr*dr+dg*dg+db*db<.105;
 };
 let left=x,right=x;
 while(left>0&&x-left<cap&&connected(left-1))left--;
 while(right<width-1&&right-x<cap&&connected(right+1))right++;
 // Unbounded backgrounds and touching bodies do not supply a reliable center.
 if(x-left>=cap||right-x>=cap)return true;
 const mid=(left+right)/2,offset=Math.abs(mid-lane.x);
 if(offset<=Math.max(1.5,lane.w*.23))return true;
 return !lanes.some(l=>l.pitch>=0&&l.pitch<=127&&l.w>=3&&l.pitch!==lane.pitch&&l.x>=left&&l.x<=right&&Math.abs(l.x-mid)+1.5<offset);
}
function detectRow(pixels,width,lanes){
 const rgb=x=>{const i=Math.max(0,Math.min(width-1,Math.round(x)))*4;return [pixels[i],pixels[i+1],pixels[i+2]]};
 const hits=[];
 for(const lane of lanes){
  if(lane.pitch<0||lane.pitch>127||lane.x<1||lane.x>=width-1||lane.w<3)continue;
  const center=rgb(lane.x),lum=.2126*center[0]+.7152*center[1]+.0722*center[2];if(lum<45)continue;
  const max=Math.max(...center),min=Math.min(...center);if(max-min<18&&lum<85)continue;
  // A solid, bounded horizontal run is required: no growth into broad backgrounds.
  let left=Math.round(lane.x),right=left,cap=Math.ceil(lane.w*1.6);
  while(left>0&&right-left<=cap&&distance(rgb(left-1),center)<48)left--;
  while(right<width-1&&right-left<=cap&&distance(rgb(right+1),center)<48)right++;
  const run=right-left+1;
  if(run<Math.max(3,lane.w*.45)||run>lane.w*1.5)continue;
  let solid=0,total=0;const mean=[0,0,0];
  for(let x=Math.max(0,Math.ceil(lane.x-lane.w*.2));x<=Math.min(width-1,Math.floor(lane.x+lane.w*.2));x++){
   const c=rgb(x);total++;if(distance(c,center)<48)solid++;for(let k=0;k<3;k++)mean[k]+=c[k];
  }
  if(!total||solid/total<.84)continue;
  if(left===0||right===width-1||Math.min(distance(rgb(left-1),center),distance(rgb(right+1),center))<48)continue;
  if(!ownsBody(pixels,width,lane,lanes))continue;
  hits.push({pitch:lane.pitch,laneType:lane.type,colorRGB:mean.map(v=>Math.round(v/total))});
 }
 return hits;
}
// Prepared lane geometry; same thresholds and integer RGB distances as detectRow.
function createRowDetector(width,lanes){
 const prepared=lanes.filter(l=>l.pitch>=0&&l.pitch<=127&&l.x>=1&&l.x<width-1&&l.w>=3).map(l=>({...l,c:Math.round(l.x),cap:Math.ceil(l.w*1.6),a:Math.max(0,Math.ceil(l.x-l.w*.2)),b:Math.min(width-1,Math.floor(l.x+l.w*.2))}));
 return pixels=>{const hits=[];
 for(const l of prepared){const i=l.c*4,r=pixels[i],g=pixels[i+1],b=pixels[i+2],lum=.2126*r+.7152*g+.0722*b;if(lum<45||Math.max(r,g,b)-Math.min(r,g,b)<18&&lum<85)continue;
 const near=x=>{const k=x*4,dr=pixels[k]-r,dg=pixels[k+1]-g,db=pixels[k+2]-b;return dr*dr+dg*dg+db*db<2304;};
 let left=l.c,right=l.c;
 while(left>0&&right-left<=l.cap&&near(left-1))left--;
 while(right<width-1&&right-left<=l.cap&&near(right+1))right++;
 const run=right-left+1;if(run<Math.max(3,l.w*.45)||run>l.w*1.5)continue;
 let solid=0,rr=0,gg=0,bb=0;const total=l.b-l.a+1;
 for(let x=l.a;x<=l.b;x++){const k=x*4;if(near(x))solid++;rr+=pixels[k];gg+=pixels[k+1];bb+=pixels[k+2];}
 if(!total||solid/total<.84||left===0||right===width-1||near(left-1)||near(right+1))continue;
 if(!ownsBody(pixels,width,l,prepared))continue;
 hits.push({pitch:l.pitch,laneType:l.type,colorRGB:[Math.round(rr/total),Math.round(gg/total),Math.round(bb/total)]});
 }return hits;};
}
// Bounded RGB histogram: omit the first two and last observation of a note.
function representative(hist,fallback){const bins=[...hist.values()],n=bins.reduce((s,b)=>s+b.n,0);if(!n)return fallback.slice();return [0,1,2].map(i=>{let count=0;for(const b of bins.slice().sort((a,b)=>a.sum[i]/a.n-b.sum[i]/b.n)){count+=b.n;if(count>=n/2)return Math.round(b.sum[i]/b.n);}return fallback[i];});}
function hue(c){const [r,g,b]=c.map(v=>v/255),max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;if(d<.06||d/Math.max(max,.001)<.18)return null;return ((max===r?(g-b)/d:max===g?(b-r)/d+2:(r-g)/d+4)*60+360)%360;}
const hueGap=(a,b)=>Math.abs((a-b+540)%360-180);
function normalizeColors(notes,mode='two'){
 const input=notes.map(n=>({...n,observedColorRGB:(n.observedColorRGB||n.colorRGB).slice()}));if(mode==='off')return {notes:input.map(n=>({...n,colorRGB:n.observedColorRGB.slice()})),palette:[],unclassified:input.length};
 const entries=input.map((n,i)=>({i,h:hue(n.observedColorRGB),lane:n.laneType,c:n.observedColorRGB})).filter(e=>e.h!==null&&['white','black'].includes(e.lane));
 // Learn hue families from notes, not frame counts. Nearby shades vote together.
 const bins=new Uint32Array(360);for(const e of entries)bins[Math.round(e.h)%360]++;const seeds=[];for(let h=0;h<360;h++){if(!bins[h])continue;let support=0;for(let d=-18;d<=18;d++)support+=bins[(h+d+360)%360];seeds.push({h,support});}seeds.sort((a,b)=>b.support-a.support||a.h-b.h);
 const families=[];for(const e of seeds)if(e.support>=Math.max(2,Math.ceil(entries.length*.01))&&families.every(h=>hueGap(h,e.h)>32)){families.push(e.h);if(families.length>=(mode==='two'?2:8))break;}families.sort((a,b)=>a-b);
 const assigned=new Map(),palette=[];for(const e of entries){const choices=families.map((h,id)=>({id,d:hueGap(h,e.h)})).sort((a,b)=>a.d-b.d);if(!choices.length||choices[0].d>26||choices[1]&&choices[1].d-choices[0].d<8)continue;const key=choices[0].id+'-'+e.lane;if(!assigned.has(key))assigned.set(key,[]);assigned.get(key).push(e);}
 for(const [id,es] of assigned){if(es.length<2)continue;const rgb=[0,1,2].map(k=>{const v=es.map(e=>e.c[k]).sort((a,b)=>a-b);return v[Math.floor(v.length/2)];});palette.push({id,family:Number(id.split('-')[0])+1,laneType:es[0].lane,colorRGB:rgb,notes:es.length});for(const e of es){input[e.i].colorRGB=rgb.slice();input[e.i].colorClass=id;input[e.i].colorConfidence=Math.max(0,1-hueGap(e.h,families[Number(id.split('-')[0])])/26);}}
 return {notes:input,palette,unclassified:input.filter(n=>!n.colorClass).length};
}
// Final constraints use classified colors; different voices/colors may overlap.
function resolveOverlaps(notes,fps=30){
 const out=[],groups=new Map(),stats={duplicates:0,trimmed:0,trimFragmentsRemoved:0,containmentGroups:0,partitionedSegments:0,mergedEdgeFragments:0};
 for(const n of notes){const c=n.colorClass||n.colorRGB.join(','),key=n.midiPitch+':'+c;if(!groups.has(key))groups.set(key,[]);groups.get(key).push({...n});}
 function finish(list){
  let maxEnd=-Infinity,contained=false;
  for(const n of list){if(n.endSeconds<=maxEnd)contained=true;maxEnd=Math.max(maxEnd,n.endSeconds);}
  if(!contained){for(let i=1;i<list.length;i++){const a=list[i-1],n=list[i];if(a.endSeconds>n.startSeconds){a.endSeconds=n.startSeconds;a.durationSeconds=a.endSeconds-a.startSeconds;stats.trimmed++;}}out.push(...list);return;}
  stats.containmentGroups++;
  // A sweep of original interval boundaries preserves the entire covered time
  // exactly once. Never infer cuts from already-trimmed intervals.
  const events=new Map();
  for(const n of list){for(const [t,type] of [[n.startSeconds,'start'],[n.endSeconds,'end']]){if(!events.has(t))events.set(t,{start:[],end:[]});events.get(t)[type].push(n);}}
  const times=[...events.keys()].sort((a,b)=>a-b),active=new Set(),pieces=[];
  for(let i=0;i<times.length-1;i++){const t=times[i],e=events.get(t);for(const n of e.end)active.delete(n);for(const n of e.start)active.add(n);const end=times[i+1];if(active.size&&end>t){const source=active.values().next().value;pieces.push({...source,startSeconds:t,endSeconds:end,durationSeconds:end-t,evidence:{...source.evidence,overlapPartition:true}});}}
  stats.partitionedSegments+=pieces.length;
  // Only newly created outer slivers may be joined inward. Interior short
  // notes and ordinary short candidates never enter this length-based merge.
  if(pieces.length>1&&pieces[0].durationSeconds<=pieces[1].durationSeconds/8&&!(pieces[1].evidence?.splitParts>1)){const edge=pieces.shift();pieces[0].startSeconds=edge.startSeconds;pieces[0].durationSeconds=pieces[0].endSeconds-edge.startSeconds;stats.mergedEdgeFragments++;}
  if(pieces.length>1){const end=pieces.length-1,a=pieces[end-1],b=pieces[end];if(b.durationSeconds<=a.durationSeconds/8&&!(b.evidence?.splitParts>1)){a.endSeconds=b.endSeconds;a.durationSeconds=a.endSeconds-a.startSeconds;pieces.pop();stats.mergedEdgeFragments++;}}
  out.push(...pieces);
 }
 for(const list of groups.values()){
  list.sort((a,b)=>a.startSeconds-b.startSeconds||b.endSeconds-a.endSeconds);
  let component=[],end=-Infinity;
  for(const n of list){if(component.length&&n.startSeconds>=end){finish(component);component=[];end=-Infinity;}component.push(n);end=Math.max(end,n.endSeconds);}if(component.length)finish(component);
 }
 return{notes:out.sort((a,b)=>a.startSeconds-b.startSeconds||a.midiPitch-b.midiPitch),stats};
}
class Tracker{
 constructor({fps=30,duration,minimumSamples=2}){if(!(fps>0&&Number.isFinite(duration)&&duration>0))throw Error('Invalid sampling configuration');this.minimumSamples=minimumSamples;this.fps=fps;this.duration=duration;this.previous=null;this.active=new Map();this.notes=[];this.discarded=0;}
 push(time,hits){
  if(!Number.isFinite(time)||time<0||time>this.duration||this.previous!==null&&time<=this.previous)throw Error('Sample times must increase');
  const present=new Map(hits.map(h=>[h.pitch,h])),boundary=this.previous===null?0:(this.previous+time)/2;
  for(const [pitch,tr] of this.active){if(!present.has(pitch)){this.close(tr,boundary,false);this.active.delete(pitch);}}
  for(const [pitch,hit] of present){let tr=this.active.get(pitch);if(!tr){tr={...hit,startSeconds:boundary,frames:0,colors:new Map(),truncatedStart:this.previous===null};this.active.set(pitch,tr);}tr.frames++;if(tr.frames>3&&tr.pendingColor){const c=tr.pendingColor,key=c.map(v=>v>>3).join(',');let bin=tr.colors.get(key);if(!bin){bin={n:0,sum:[0,0,0]};tr.colors.set(key,bin);}bin.n++;c.forEach((v,i)=>bin.sum[i]+=v);}tr.pendingColor=hit.colorRGB.slice();}
  this.previous=time;
 }
 close(tr,end,truncatedEnd){if(tr.frames<this.minimumSamples){this.discarded++;return;}const start=tr.startSeconds;this.notes.push({...(this.minimumSamples===1?{observationSamples:tr.frames}:{}),midiPitch:tr.pitch,noteName:noteName(tr.pitch),startSeconds:start,endSeconds:end,durationSeconds:end-start,colorRGB:representative(tr.colors,tr.colorRGB),rawColorRGB:tr.colorRGB.slice(),colorSamples:[...tr.colors.values()].reduce((n,b)=>n+b.n,0),laneType:tr.laneType,truncatedStart:tr.truncatedStart,truncatedEnd});}
 finish(){for(const tr of this.active.values())this.close(tr,this.duration,true);this.active.clear();return this.notes.sort((a,b)=>a.startSeconds-b.startSeconds||a.midiPitch-b.midiPitch);}
}
const api={whitePitch,noteName,detectRow,createRowDetector,Tracker,normalizeColors,resolveOverlaps};if(typeof module==='object'&&module.exports)module.exports=api;else root.PianoRollNoteCore=api;
})(globalThis);
