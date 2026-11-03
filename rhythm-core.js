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
 const {beats:observed,removed}=cleanBeats(input),points=[];
 const beats=observed.slice();let adjusted=0;
 // Estimate phase from five neighboring observations, not each onset interval.
 // A sustained tempo transition has different slopes on its two sides: retain it.
 for(let i=3;i<observed.length-3;i++){
  const left=(observed[i-1]-observed[i-3])/2,right=(observed[i+3]-observed[i+1])/2;
  if(Math.abs(left-right)>Math.min(left,right)*.08)continue;
  const slopes=[];for(let j=Math.max(0,i-6);j+4<=Math.min(observed.length-1,i+6);j++)slopes.push((observed[j+4]-observed[j])/4);
  const step=median(slopes);if(!(step>0))continue;
  const phase=median(Array.from({length:5},(_,k)=>observed[i+k-2]-(k-2)*step));
  const delta=phase-observed[i];
  if(Math.abs(delta)>.012&&Math.abs(delta)<step*.26){beats[i]=phase;adjusted++;}
 }
 if(beats.length<2)return {points,beats,removed,anchor:beats[0]??0,maxError:0};
 // Every segment shares an exact beat anchor with its neighbor. Unlike
 // independent regressions, the integrated map cannot accumulate span drift.
 if(!Number.isFinite(quarterPerBeat)||quarterPerBeat<=0)throw new RangeError('Invalid beat unit');
 if(!Number.isFinite(tolerance)||tolerance<0)throw new RangeError('Invalid tolerance');
 let maxError=0,a=0;
 while(a<beats.length-1){
  let lower=0,upper=Infinity,end=a+1;
  for(let j=a+1;j<beats.length;j++){
   const k=j-a,delta=beats[j]-beats[a];
   lower=Math.max(lower,(delta-tolerance)/k);
   upper=Math.min(upper,(delta+tolerance)/k);
   if(lower>upper+1e-12)break;
   const slope=delta/k;
   if(slope>=lower-1e-12&&slope<=upper+1e-12)end=j;
  }
  const step=(beats[end]-beats[a])/(end-a),bpm=60*quarterPerBeat/step;
  points.push({t:a===0?0:beats[a],bpm,quality:1});
  for(let i=a;i<=end;i++)maxError=Math.max(maxError,Math.abs(beats[i]-beats[a]-(i-a)*step));
  a=end;
 }

 return {points,beats:observed,removed,adjusted,anchor:observed[0],maxError};
}
function inferMeters(beats,downs,{quarterPerBeat=1}={}){
 const snapped=snapDownbeats(beats,downs),bars=[];let pos=0;
 for(let i=0;i<snapped.length-1;i++){
  while(pos<beats.length&&beats[pos]<snapped[i]-1e-5)pos++;
  let end=pos;while(end<beats.length&&beats[end]<snapped[i+1]-1e-5)end++;
  const count=end-pos;if(count>=2&&count<=12)bars.push({t:snapped[i],count});
 }
 // Half-bar accents frequently produce two downbeats in a 4/4 bar.
 // Prefer common time for ambiguous duple sections; true 2/4 remains editable.
 const duple=bars.filter(b=>b.count===2||b.count===4).length;
 if(duple>bars.length*.65)for(const bar of bars)if(bar.count===2)bar.count=4;
 const events=[];let active=null;
 for(let i=0;i<bars.length;i++){
  const b=bars[i],supported=(bars[i+1]?.count===b.count)||(i>0&&bars[i-1].count===b.count);
  if(!supported||b.count===active)continue;
  // Denominator is a convention, not inferable from beat/downbeat timestamps.
  active=b.count;const quarters=b.count*quarterPerBeat,denominator=Number.isInteger(quarters)?4:8;events.push({t:b.t,numerator:quarters*denominator/4,denominator,quarterPerBeat,confidence:duple>bars.length*.65?'ambiguous-duple':'candidate',alternatives:duple>bars.length*.65?[2,4]:[b.count]});
 }
 return events;
}
// Validate the actual continuous tempo integral, not independently reset spans.
function validateMap(beats,points,anchor,q=1){
 if(beats.length<2||!points.length)return null;
 const integral=t=>{let sum=0,at=0,bpm=points[0].bpm;for(const p of points){if(p.t>t)break;sum+=(p.t-at)*bpm/60;at=p.t;bpm=p.bpm;}return sum+(t-at)*bpm/60;};
 const base=integral(anchor);
 const errors=beats.map((t,i)=>{let bpm=points[0].bpm;for(const p of points){if(p.t>t)break;bpm=p.bpm;}return (integral(t)-base-i*q)*60/bpm;});
 const abs=errors.map(Math.abs).sort((a,b)=>a-b);
 return {maxSeconds:abs.at(-1),p95Seconds:abs[Math.floor((abs.length-1)*.95)],endSeconds:errors.at(-1),reference:'AI detected beats, not ground truth'};
}
function bpmAtBeat(beats,t,q=1){if(beats.length<2)return null;let lo=0,hi=beats.length-1;while(lo+1<hi){const m=(lo+hi)>>1;if(beats[m]<=t)lo=m;else hi=m;}return 60*q/(beats[hi]-beats[lo]);}
return {validateMap,median,cleanBeats,snapDownbeats,tempoFromBeats,inferMeters,bpmAtBeat};
});
