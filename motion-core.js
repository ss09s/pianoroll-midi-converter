/* 0.7.21: sparse multi-height evidence, never a probability estimate. */
(function(root){'use strict';
const core=typeof module==='object'&&module.exports?require('./note-core.js'):root.PianoRollNoteCore;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const colorDistance=(a,b)=>Math.hypot(...a.colorRGB.map((v,i)=>v-b.colorRGB[i]));
function linePlan(y,height,mode='motion'){
 y=clamp(Math.round(y),0,height-1);
 // No independent upper evidence when the guide is too close to the top edge.
 return mode!=='motion'||y<32?[y]:[...new Set([.50,.69,.85,1].map(f=>Math.round(y*f)))];
}
function compatible(a,b,fps){return a.midiPitch===b.midiPitch&&colorDistance(a,b)<100&&Math.abs(a.durationSeconds-b.durationSeconds)<=Math.max(3/fps,.22*Math.max(a.durationSeconds,b.durationSeconds));}
function lowerBound(list,time){let a=0,b=list.length;while(a<b){const m=(a+b)>>1;if(list[m].startSeconds<time)a=m+1;else b=m;}return a;}
function fuse(lines,observations,{fps,duration,height}){
 const base=observations.at(-1),referenceY=lines.at(-1),diagnostics={method:'multi-line-motion',lineYs:lines,baselineCandidates:base.length,motionTracks:0,rejectedBottomOnly:0,recoveredUpper:0,overlappingFragments:0,boundaryKept:0,unverifiedKept:0,confidenceMeaning:'relative evidence score, not probability'};
 if(lines.length<4)return{notes:base,diagnostics:{...diagnostics,fallbackReason:'上側の判定領域が不足しています'}};
 const groups=observations.map(list=>{const map=new Map();for(const n of list){if(!map.has(n.midiPitch))map.set(n.midiPitch,[]);map.get(n.midiPitch).push(n);}return map;});
 const candidates=[],minV=Math.max(2,height*.05),maxV=height*20;
 // Match start AND end edges. A static image or simultaneous flash has no positive travel delay.
 for(const a of observations[0]){
  if(a.truncatedStart||a.truncatedEnd)continue;
  const bs=groups[1].get(a.midiPitch)||[],cs=groups[2].get(a.midiPitch)||[];
  for(let j=lowerBound(bs,a.startSeconds+1/fps);j<bs.length;j++){
   const b=bs[j],delay=b.startSeconds-a.startSeconds;if(delay>Math.min(8,(lines[1]-lines[0])/minV))break;
   const velocity=(lines[1]-lines[0])/delay;if(velocity>maxV||b.truncatedStart||b.truncatedEnd||!compatible(a,b,fps))continue;
   const expected=a.startSeconds+(lines[2]-lines[0])/velocity,tolerance=Math.max(2/fps,(expected-a.startSeconds)*.10);
   for(let k=lowerBound(cs,expected-tolerance);k<cs.length&&cs[k].startSeconds<=expected+tolerance;k++){
    const c=cs[k];if(c.truncatedStart||c.truncatedEnd||!compatible(a,c,fps)||!compatible(b,c,fps))continue;
    const endDelay=c.endSeconds-a.endSeconds;if(endDelay<=1/fps)continue;
    const v=(lines[2]-lines[0])/(c.startSeconds-a.startSeconds),ve=(lines[2]-lines[0])/endDelay;
    if(Math.abs(v-ve)/v>.22)continue;
    const residual=Math.abs(b.startSeconds-(a.startSeconds+(lines[1]-lines[0])/v));
    if(residual>Math.max(1.5/fps,delay*.10))continue;
    const score=residual*fps+Math.abs(v-ve)/v+Math.abs(a.durationSeconds-c.durationSeconds)*fps*.1+colorDistance(a,c)/1000;
    candidates.push({parts:[a,b,c],v,score});
   }
  }
 }
 // One observation cannot vote for several repeated notes.
 candidates.sort((a,b)=>a.score-b.score);const used=new Set(),tracks=[];
 for(const candidate of candidates){if(candidate.parts.some(n=>used.has(n)))continue;candidate.parts.forEach(n=>used.add(n));tracks.push(candidate);}
 diagnostics.matchedPaths=tracks.length;
 if(!tracks.length)return{notes:base.map(n=>({...n,evidence:{lines:1,confidence:0,verified:false}})),diagnostics:{...diagnostics,fallbackReason:'一定速度で移動する候補を十分に確認できないため単線結果を保持しました'}};
 const claimed=new Set(),protectedLower=new Set(),output=[];
 for(const tr of tracks){
  const weights=[.5,.3,.2];let start=0,end=0;
  tr.parts.forEach((n,i)=>{start+=weights[i]*(n.startSeconds+(referenceY-lines[i])/tr.v);end+=weights[i]*(n.endSeconds+(referenceY-lines[i])/tr.v);});
  if(start>=duration||end<=0)continue;
  const tolerance=Math.max(3/fps,.12*(referenceY-lines[0])/tr.v),list=groups.at(-1).get(tr.parts[0].midiPitch)||[];
  let match=null,best=Infinity;
  for(let i=lowerBound(list,start-tolerance);i<list.length&&list[i].startSeconds<=start+tolerance;i++){
   const n=list[i];if(claimed.has(n)||colorDistance(n,tr.parts[0])>=100)continue;
   const d=Math.abs(n.startSeconds-start)+Math.abs(n.endSeconds-Math.min(duration,end));
   if(d<best&&Math.abs(n.endSeconds-Math.min(duration,end))<=Math.max(tolerance,3/fps)){match=n;best=d;}
  }
  // An upper fragment of a long/lower note must not become a second overlapping note.
  // Preserve the lower interval when the full edges cannot be reconciled.
  const overlap=!match&&list.find(n=>Math.max(0,Math.min(n.endSeconds,end)-Math.max(n.startSeconds,start))>=.5*Math.min(n.durationSeconds,end-start));
  if(overlap){protectedLower.add(overlap);diagnostics.overlappingFragments++;continue;}
  const startSeconds=clamp(start,0,duration),endSeconds=clamp(end,0,duration);
  if(endSeconds-startSeconds<1/fps)continue;
  diagnostics.motionTracks++;if(match)claimed.add(match);else diagnostics.recoveredUpper++;
  output.push({...tr.parts[0],startSeconds,endSeconds,durationSeconds:endSeconds-startSeconds,truncatedStart:start<=0,truncatedEnd:end>=duration,evidence:{lines:match?4:3,confidence:clamp(.95-tr.score*.1,.6,.95),verified:true,velocityPixelsPerSecond:tr.v}});
 }
 for(const n of base){
  if(claimed.has(n))continue;
  // Require nearby proven motion before rejecting an isolated lower candidate.
  // Keep clip boundaries: the corresponding upper crossing can be outside the file.
  const nearby=tracks.filter(t=>Math.abs(t.parts[2].startSeconds+(referenceY-lines[2])/t.v-n.startSeconds)<=2);
  const speed=nearby.length?nearby.map(t=>t.v).sort((a,b)=>a-b)[Math.floor(nearby.length/2)]:null;
  const travel=speed?(referenceY-lines[0])/speed:0;
  const boundary=n.truncatedStart||n.truncatedEnd||speed&&n.startSeconds<travel+2/fps;
  let support=protectedLower.has(n);
  if(speed&&!boundary)for(let line=0;line<3&&!support;line++){
   const expected=n.startSeconds-(referenceY-lines[line])/speed,tolerance=Math.max(3/fps,travel*.15),list=groups[line].get(n.midiPitch)||[];
   for(let j=lowerBound(list,expected-tolerance);j<list.length&&list[j].startSeconds<=expected+tolerance;j++)if(compatible(n,list[j],fps)){support=true;break;}
  }
  if(speed&&!boundary&&!support){diagnostics.rejectedBottomOnly++;continue;}
  if(boundary)diagnostics.boundaryKept++;else diagnostics.unverifiedKept++;
  output.push({...n,evidence:{lines:support?2:1,confidence:support?.55:.2,verified:false}});
 }
 output.sort((a,b)=>a.startSeconds-b.startSeconds||a.midiPitch-b.midiPitch);
 return{notes:output,diagnostics};
}
function createScan({width,height,hitLineY,lanes,fps,duration,mode='single'}){
 const lines=linePlan(hitLineY,height,mode),trackers=lines.map(()=>new core.Tracker({fps,duration})),detect=core.createRowDetector(width,lanes);
 return{lines,detect,push(time,rows){rows.forEach((hits,i)=>trackers[i].push(time,hits));},finish(){
  const observations=trackers.map(t=>t.finish()),discarded=trackers.reduce((sum,t)=>sum+t.discarded,0);
  if(mode!=='motion')return{notes:observations[0],discarded,diagnostics:{method:'single-line',lineYs:lines}};
  return{...fuse(lines,observations,{fps,duration,height}),discarded};
 }};
}
const api={linePlan,fuse,createScan};if(typeof module==='object'&&module.exports)module.exports=api;else root.PianoRollMotionCore=api;
})(globalThis);
