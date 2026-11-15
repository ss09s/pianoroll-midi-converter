/* 0.7.0: fixed-keyboard hit-line occupancy -> absolute-second note events. */
(function(root){'use strict';
const mod=(a,n)=>(a%n+n)%n,semis=[0,2,4,5,7,9,11];
function whitePitch(index,referenceIndex,name,octave){const d=name+index-referenceIndex;return 12*(octave+1)+12*Math.floor(d/7)+semis[mod(d,7)];}
function noteName(pitch){return ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'][mod(pitch,12)]+(Math.floor(pitch/12)-1);}
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
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
 hits.push({pitch:l.pitch,laneType:l.type,colorRGB:[Math.round(rr/total),Math.round(gg/total),Math.round(bb/total)]});
 }return hits;};
}
class Tracker{
 constructor({fps=30,duration}){if(!(fps>0&&Number.isFinite(duration)&&duration>0))throw Error('Invalid sampling configuration');this.fps=fps;this.duration=duration;this.previous=null;this.active=new Map();this.notes=[];this.discarded=0;}
 push(time,hits){
  if(!Number.isFinite(time)||time<0||time>this.duration||this.previous!==null&&time<=this.previous)throw Error('Sample times must increase');
  const present=new Map(hits.map(h=>[h.pitch,h])),boundary=this.previous===null?0:(this.previous+time)/2;
  for(const [pitch,tr] of this.active){if(!present.has(pitch)){this.close(tr,boundary,false);this.active.delete(pitch);}}
  for(const [pitch,hit] of present){let tr=this.active.get(pitch);if(!tr){tr={...hit,startSeconds:boundary,frames:0,truncatedStart:this.previous===null};this.active.set(pitch,tr);}tr.frames++;}
  this.previous=time;
 }
 close(tr,end,truncatedEnd){if(tr.frames<2){this.discarded++;return;}const start=tr.startSeconds;this.notes.push({midiPitch:tr.pitch,noteName:noteName(tr.pitch),startSeconds:start,endSeconds:end,durationSeconds:end-start,colorRGB:tr.colorRGB,laneType:tr.laneType,truncatedStart:tr.truncatedStart,truncatedEnd});}
 finish(){for(const tr of this.active.values())this.close(tr,this.duration,true);this.active.clear();return this.notes.sort((a,b)=>a.startSeconds-b.startSeconds||a.midiPitch-b.midiPitch);}
}
const api={whitePitch,noteName,detectRow,createRowDetector,Tracker};if(typeof module==='object'&&module.exports)module.exports=api;else root.PianoRollNoteCore=api;
})(globalThis);
