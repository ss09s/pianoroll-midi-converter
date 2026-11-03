/* v0.6.6 Shared beat timing. Beat timestamps are authoritative; no octave prior. */
(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;root.PianoRollRhythm=api;})(globalThis,()=>{
'use strict';
const median=a=>{a=a.filter(Number.isFinite).sort((a,b)=>a-b);return a.length?(a[(a.length-1)>>1]+a[a.length>>1])/2:NaN};
function cleanBeats(input){
 const a=[...new Set(input.map(Number).filter(t=>Number.isFinite(t)&&t>=0))].sort((x,y)=>x-y);let removed=0;
 // Single linear pass, including start/end; old preview removed at most 3 events.
 const out=[];
 for(let i=0;i<a.length;i++){
  const prev=out.at(-1),gap=a[i]-prev;
  const neighbors=[];for(let j=Math.max(1,i-4);j<Math.min(a.length,i+6);j++){const d=a[j]-a[j-1];if(d>.12&&d<3)neighbors.push(d);}
  const typical=median(neighbors);
  if(out.length && (gap<.07 || Number.isFinite(typical)&&gap<Math.min(.23,typical*.48))){removed++;continue;}
  out.push(a[i]);
 }
 return {beats:out,removed};
}
function snapDownbeats(beats,downs){
 const result=[];let i=0;
 for(const d of [...downs].sort((a,b)=>a-b)){
  while(i+1<beats.length&&Math.abs(beats[i+1]-d)<Math.abs(beats[i]-d))i++;
  if(beats.length&&Math.abs(beats[i]-d)<=.10&&result.at(-1)!==beats[i])result.push(beats[i]);
 }return result;
}
function tempoFromBeats(input,{quarterPerBeat=1,tolerance=.018}={}){
 const {beats,removed}=cleanBeats(input),points=[];
 if(beats.length<2)return {points,beats,removed,anchor:beats[0]??0,maxError:0};
 let a=0,maxError=0;
 while(a<beats.length-1){
  let end=a+1;
  // Fit through both endpoints; accept only if EVERY internal beat is within
  // tolerance. Limited window bounds work to O(N), and prevents long-term drift.
  for(let b=a+2;b<Math.min(beats.length,a+65);b++){
   const step=(beats[b]-beats[a])/(b-a);let err=0;
   for(let k=a+1;k<b;k++)err=Math.max(err,Math.abs(beats[a]+(k-a)*step-beats[k]));
   if(err>tolerance)break;end=b;
  }
  const step=(beats[end]-beats[a])/(end-a),bpm=60*quarterPerBeat/step;
  points.push({t:a===0?0:beats[a],bpm,quality:1});
  for(let k=a;k<=end;k++)maxError=Math.max(maxError,Math.abs(beats[a]+(k-a)*step-beats[k]));
  a=end;
 }
 return {points,beats,removed,anchor:beats[0],maxError};
}
function inferMeters(beats,downs,{quarterPerBeat=1}={}){
 const snapped=snapDownbeats(beats,downs),bars=[];let pos=0;
 for(let i=0;i<snapped.length-1;i++){
  while(pos<beats.length&&beats[pos]<snapped[i]-1e-5)pos++;
  let end=pos;while(end<beats.length&&beats[end]<snapped[i+1]-1e-5)end++;
  const count=end-pos;if(count>=2&&count<=12)bars.push({t:snapped[i],count});
 }
 const events=[];let active=null;
 for(let i=0;i<bars.length;i++){
  const b=bars[i],supported=(bars[i+1]?.count===b.count)||(i>0&&bars[i-1].count===b.count);
  if(!supported||b.count===active)continue;
  // Denominator is a convention, not inferable from beat/downbeat timestamps.
  active=b.count;const quarters=b.count*quarterPerBeat,denominator=Number.isInteger(quarters)?4:8;events.push({t:b.t,numerator:quarters*denominator/4,denominator,quarterPerBeat,confidence:'candidate'});
 }
 return events;
}
function bpmAtBeat(beats,t,q=1){if(beats.length<2)return null;let lo=0,hi=beats.length-1;while(lo+1<hi){const m=(lo+hi)>>1;if(beats[m]<=t)lo=m;else hi=m;}return 60*q/(beats[hi]-beats[lo]);}
return {median,cleanBeats,snapDownbeats,tempoFromBeats,inferMeters,bpmAtBeat};
});
