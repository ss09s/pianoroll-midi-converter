/* 0.7.22: upper line owns candidates; lower lines only support timing, color and motion. */
(function(root){'use strict';
const core=typeof module==='object'&&module.exports?require('./note-core.js'):root.PianoRollNoteCore;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const median=a=>{const s=a.slice().sort((a,b)=>a-b);return s.length?s[Math.floor(s.length/2)]:null;};
const distance=(a,b)=>Math.hypot(...a.colorRGB.map((v,i)=>v-b.colorRGB[i]));
function linePlan(referenceY,height,mode='motion',primaryPercent=20){
 const y=clamp(Math.round(referenceY),0,height-1),upper=Math.min(Math.max(0,y-8),clamp(Math.round(height*clamp(Number(primaryPercent)||20,3,65)/100),0,height-1));
 if(mode==='single')return[y];if(mode==='upper'||y<16)return[upper];
 return[...new Set([upper,upper+Math.round((y-upper)*.20),upper+Math.round((y-upper)*.45),y])];
}
function compatible(a,b,fps){return a.midiPitch===b.midiPitch&&distance(a,b)<135&&Math.abs(a.durationSeconds-b.durationSeconds)<=Math.max(3/fps,.25*Math.max(a.durationSeconds,b.durationSeconds));}
function lowerBound(list,time){let a=0,b=list.length;while(a<b){const m=(a+b)>>1;if(list[m].startSeconds<time)a=m+1;else b=m;}return a;}
function fuse(lines,observations,{fps,duration,height,referenceY=lines.at(-1)}){
 const primary=observations[0],groups=observations.map(list=>{const m=new Map();for(const n of list){if(!m.has(n.midiPitch))m.set(n.midiPitch,[]);m.get(n.midiPitch).push(n);}return m;});
 const diagnostics={method:'upper-primary-motion',lineYs:lines,primaryY:lines[0],referenceY,primaryCandidates:primary.length,motionTracks:0,estimatedTiming:0,unconfirmed:0,outsideClip:0,lowerOnlyIgnored:0,colorSupported:0,confidenceMeaning:'relative evidence score, not probability'};
 const paths=[];
 if(lines.length>=3)for(const a of primary){
  // Partial upper edges cannot establish a transit time; they may use a proven local speed below.
  if(a.truncatedStart)continue;
  const bs=groups[1].get(a.midiPitch)||[],cs=groups[2].get(a.midiPitch)||[];
  for(let j=lowerBound(bs,a.startSeconds+1/fps);j<bs.length;j++){
   const b=bs[j],delay=b.startSeconds-a.startSeconds;if(delay>8)break;
   if(b.truncatedStart||!compatible(a,b,fps)&&!b.truncatedEnd)continue;
   if(distance(a,b)>=135)continue;
   const v=(lines[1]-lines[0])/delay;if(v<Math.max(2,height*.04)||v>height*20)continue;
   const expected=a.startSeconds+(lines[2]-lines[0])/v,tol=Math.max(2/fps,(expected-a.startSeconds)*.08);
   for(let k=lowerBound(cs,expected-tol);k<cs.length&&cs[k].startSeconds<=expected+tol;k++){
    const c=cs[k];if(c.truncatedStart||distance(a,c)>=135||!compatible(a,c,fps)&&!c.truncatedEnd)continue;
    const velocity=(lines[2]-lines[0])/(c.startSeconds-a.startSeconds),residual=Math.abs(b.startSeconds-a.startSeconds-(lines[1]-lines[0])/velocity);
    if(residual>Math.max(1.5/fps,delay*.08))continue;
    let endError=0;
    if(!a.truncatedEnd&&!c.truncatedEnd){const dt=c.endSeconds-a.endSeconds;if(dt<=1/fps)continue;endError=Math.abs((lines[2]-lines[0])/dt-velocity)/velocity;if(endError>.20)continue;}
    paths.push({a,parts:[a,b,c],v:velocity,score:residual*fps+endError+Math.abs(a.durationSeconds-b.durationSeconds)*.05});
   }
  }
 }
 paths.sort((a,b)=>a.score-b.score);const used=new Set(),tracks=[];
 for(const p of paths){if(p.parts.some(n=>used.has(n)))continue;p.parts.forEach(n=>used.add(n));tracks.push(p);}
 const byPrimary=new Map(tracks.map(t=>[t.a,t])),usedLower=new Set(),notes=[],unconfirmed=[];
 const common=median(tracks.map(t=>t.v)),stable=common&&tracks.filter(t=>Math.abs(t.v-common)/common<.15).length>=Math.max(2,tracks.length*.8);
 for(const a of primary){
  const track=byPrimary.get(a);
  const stationary=!track&&lines.slice(1).filter((_,i)=>(groups[i+1].get(a.midiPitch)||[]).some(b=>Math.abs(a.startSeconds-b.startSeconds)<1.1/fps&&Math.abs(a.endSeconds-b.endSeconds)<1.1/fps&&distance(a,b)<70)).length>=2;
  if(stationary){unconfirmed.push({...a,reason:'stationary-or-simultaneous'});continue;}
  const nearby=tracks.filter(t=>Math.abs(t.a.startSeconds-a.startSeconds)<3).map(t=>t.v);
  const velocity=track?.v||(nearby.length?median(nearby):stable?common:null);
  if(!velocity){unconfirmed.push({...a,reason:'travel-time-unconfirmed'});continue;}
  const delay=(referenceY-lines[0])/velocity;
  let start=a.startSeconds+delay,end=a.truncatedEnd?duration:a.endSeconds+delay;
  // If the leading edge passed above before t=0, a lower onset can time the
  // already-seen upper candidate. Never invent t=0 or a candidate absent above.
  if(a.truncatedStart){
   const estimates=[];
   if(!a.truncatedEnd)for(let i=1;i<lines.length;i++){
    const transit=(lines[i]-lines[0])/velocity,predictedEnd=a.endSeconds+transit,tol=Math.max(3/fps,transit*.08);
    for(const b of groups[i].get(a.midiPitch)||[]){if(b.truncatedStart||b.truncatedEnd||distance(a,b)>=135||b.startSeconds>transit+tol||Math.abs(b.endSeconds-predictedEnd)>tol)continue;estimates.push(b.startSeconds+(referenceY-lines[i])/velocity);}
   }
   if(!estimates.length){unconfirmed.push({...a,reason:'upper-onset-before-clip'});continue;}
   start=median(estimates);
  }
  if(start>=duration||end<=0){diagnostics.outsideClip++;continue;}
  const parts=track?track.parts.slice():[a];
  // The keyboard observation may refine an already established upper candidate only.
  const last=groups.length-1,expectedStart=a.startSeconds+(lines[last]-lines[0])/velocity,tol=Math.max(2/fps,(lines[last]-lines[0])/velocity*.06),list=groups[last].get(a.midiPitch)||[];
  let best=null,bestError=Infinity;
  for(let j=lowerBound(list,expectedStart-tol);j<list.length&&list[j].startSeconds<=expectedStart+tol;j++){
   const b=list[j];if(usedLower.has(b)||distance(a,b)>=135||!compatible(a,b,fps)&&!b.truncatedEnd)continue;
   const err=Math.abs(b.startSeconds-expectedStart);if(err<bestError){best=b;bestError=err;}
  }
  if(best){usedLower.add(best);if(!parts.includes(best))parts.push(best);
   if(track&&!best.truncatedStart&&Math.abs(best.startSeconds-start)<=2/fps)start=start*.75+best.startSeconds*.25;
   if(track&&!best.truncatedEnd&&Math.abs(best.endSeconds-end)<=2/fps)end=end*.75+best.endSeconds*.25;
  }
  const colors=parts.filter(n=>Math.max(...n.colorRGB)-Math.min(...n.colorRGB)>=25);
  const colorRGB=colors.length>=2?[0,1,2].map(k=>median(colors.map(n=>n.colorRGB[k]))):a.colorRGB;
  const startSeconds=clamp(start,0,duration),endSeconds=clamp(end,0,duration);if(endSeconds-startSeconds<1/fps)continue;
  if(track)diagnostics.motionTracks++;else diagnostics.estimatedTiming++;
  if(colors.length>=2)diagnostics.colorSupported++;
  notes.push({...a,startSeconds,endSeconds,durationSeconds:endSeconds-startSeconds,colorRGB,truncatedStart:start<=0,truncatedEnd:a.truncatedEnd||end>=duration,evidence:{primaryStartSeconds:a.startSeconds,primaryEndSeconds:a.endSeconds,lines:parts.length,confidence:track?clamp(.95-track.score*.1,.6,.95):.4,verified:!!track,timingSource:track?'own-motion':'nearby-motion',velocityPixelsPerSecond:velocity,colorSamples:colors.length}});
 }
 diagnostics.unconfirmed=unconfirmed.length;
 diagnostics.lowerOnlyIgnored=observations.at(-1).filter(n=>!usedLower.has(n)).length;
 if(!tracks.length)diagnostics.warning='落下速度を確認できませんでした。未確定の上側候補は確定結果に含めません。';
 notes.sort((a,b)=>a.startSeconds-b.startSeconds||a.midiPitch-b.midiPitch);
 return{notes,unconfirmedNotes:unconfirmed,diagnostics};
}
function createScan({width,height,hitLineY,lanes,fps,duration,mode='single',primaryPercent=20}){
 const lines=linePlan(hitLineY,height,mode,primaryPercent),trackers=lines.map(()=>new core.Tracker({fps,duration})),detect=core.createRowDetector(width,lanes);
 return{lines,detect,push(time,rows){rows.forEach((hits,i)=>trackers[i].push(time,hits));},finish(){
  const observations=trackers.map(t=>t.finish()),discarded=trackers.reduce((n,t)=>n+t.discarded,0);
  if(mode!=='motion')return{notes:observations[0],unconfirmedNotes:[],discarded,diagnostics:{method:mode==='upper'?'upper-single':'single-line',lineYs:lines,timingReference:mode==='upper'?'upper-line':'keyboard-line'}};
  return{...fuse(lines,observations,{fps,duration,height,referenceY:hitLineY}),discarded};
 }};
}
const api={linePlan,fuse,createScan};if(typeof module==='object'&&module.exports)module.exports=api;else root.PianoRollMotionCore=api;
})(globalThis);
