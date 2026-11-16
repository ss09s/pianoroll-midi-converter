/* 0.7.23: upper candidates are immutable; dense observations calibrate a common transit delay. */
(function(root){'use strict';
const core=typeof module==='object'&&module.exports?require('./note-core.js'):root.PianoRollNoteCore;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const median=a=>{const s=a.slice().sort((a,b)=>a-b);return s.length?s[Math.floor(s.length/2)]:null;};
function linePlan(referenceY,height,mode='motion',primaryPercent=20){
 const y=clamp(Math.round(referenceY),0,height-1),upper=Math.min(Math.max(0,y-8),clamp(Math.round(height*clamp(Number(primaryPercent)||20,3,65)/100),0,height-1));
 if(mode==='single')return[y];if(mode==='upper'||y<16)return[upper];
 // Dense spatial observations across the falling area. The first row alone owns notes.
 const top=Math.min(upper,Math.round(height*.03)),bottom=Math.max(upper,Math.round(upper+(y-upper)*.85));
 return [...new Set([upper,...Array.from({length:32},(_,i)=>Math.round(top+(bottom-top)*i/31))])];
}
const distance=(a,b)=>Math.hypot(...a.colorRGB.map((v,i)=>v-b.colorRGB[i]));
function compatible(a,b,fps){return a.midiPitch===b.midiPitch&&!b.truncatedStart&&!b.truncatedEnd&&distance(a,b)<65&&Math.abs(a.durationSeconds-b.durationSeconds)<=Math.max(2/fps,.12*a.durationSeconds);}
function lowerBound(list,time){let a=0,b=list.length;while(a<b){const m=(a+b)>>1;if(list[m].startSeconds<time)a=m+1;else b=m;}return a;}
function fuse(lines,observations,{fps,duration,height,referenceY=lines.at(-1)}){
 const primary=observations[0],groups=observations.map(list=>{const m=new Map();for(const n of list){if(!m.has(n.midiPitch))m.set(n.midiPitch,[]);m.get(n.midiPitch).push(n);}for(const ns of m.values())ns.sort((a,b)=>a.startSeconds-b.startSeconds);return m;});
 const votes=[];const tolerance=2/fps;
 // Each primary may contribute only one vote. Ambiguous repeated patterns abstain.
 for(const a of primary){
  if(a.truncatedStart||a.truncatedEnd)continue;
  const proposals=[];
  for(let i=1;i<lines.length;i++){
   const dy=lines[i]-lines[0];if(Math.abs(dy)<height*.12)continue;
   const list=groups[i].get(a.midiPitch)||[];
   for(let k=lowerBound(list,a.startSeconds-6);k<list.length&&list[k].startSeconds<=a.startSeconds+6;k++){
    const b=list[k],dt=b.startSeconds-a.startSeconds;if(!compatible(a,b,fps)||dy*dt<=0||Math.abs(dt)<3/fps)continue;
    const v=dy/dt;if(v<height*.04||v>height*3)continue;
    if(Math.abs((b.endSeconds-a.endSeconds)-dt)>tolerance)continue;
    proposals.push(v);
   }
  }
  const scored=[],tested=[];
  for(const v of proposals){
   if(tested.some(x=>Math.abs(x-v)/v<.025))continue;tested.push(v);
   let matches=0,minY=lines[0],maxY=lines[0],error=0;const points=[[lines[0],a.startSeconds,a.endSeconds]];
   for(let i=1;i<lines.length;i++){
    const expected=a.startSeconds+(lines[i]-lines[0])/v,list=groups[i].get(a.midiPitch)||[];
    let best=Infinity,bestNote=null;
    for(let k=lowerBound(list,expected-tolerance);k<list.length&&list[k].startSeconds<=expected+tolerance;k++){
     const b=list[k];if(!compatible(a,b,fps))continue;
     const err=Math.max(Math.abs(b.startSeconds-expected),Math.abs(b.endSeconds-(a.endSeconds+(lines[i]-lines[0])/v)));
     if(err<=tolerance&&err<best){best=err;bestNote=b;}
    }
    if(Number.isFinite(best)){points.push([lines[i],bestNote.startSeconds,bestNote.endSeconds]);matches++;minY=Math.min(minY,lines[i]);maxY=Math.max(maxY,lines[i]);error+=best;}
   }
   if(matches>=8&&maxY-minY>=height*.25){const mean=points.reduce((n,p)=>n+p[0],0)/points.length,den=points.reduce((n,p)=>n+(p[0]-mean)**2,0),slope=points.reduce((n,p)=>n+(p[0]-mean)*(p[1]+p[2])*.5,0)/den;scored.push({v,fit:1/slope,matches,error:error/matches});}
  }
  scored.sort((a,b)=>b.matches-a.matches||a.error-b.error);const best=scored[0];if(!best)continue;
  const rival=scored.find(s=>Math.abs(s.v-best.v)/best.v>.12);
  if(rival&&rival.matches>=best.matches*.85)continue;
  votes.push({v:best.fit,primary:a,support:best.matches});
 }
 const speed=median(votes.map(v=>v.v)),inliers=speed?votes.filter(v=>Math.abs(v.v-speed)/speed<=.08):[];
 const supported=inliers.length>=3&&inliers.length>=votes.length*.85;
 // A common shift preserves every primary pitch, color, duration and ordering.
 // Only well-supported dense tracks may override the common delay; never add/delete notes.
 const delay=supported?(referenceY-lines[0])/median(inliers.map(v=>v.v)):0,byPrimary=new Map(votes.map(v=>[v.primary,v]));
 const diagnostics={method:'dense-primary-calibration',lineYs:lines,primaryY:lines[0],referenceY,primaryCandidates:primary.length,motionTracks:inliers.length,velocityVotes:votes.length,calibrated:supported,offsetSeconds:delay,velocityPixelsPerSecond:supported?median(inliers.map(v=>v.v)):null,unconfirmed:supported?0:primary.length,outsideClip:0,timingReference:supported?'keyboard-line-estimated':'upper-line',warning:supported?'一定速度の一致から全候補へ同じ移動時間を加算しました。原音との同期を保証するものではありません。':'速度の一致が不十分です。候補を削除せず上側通過時刻のまま保持しました。同期補正で調整してください。'};
 // Recover only an already-present primary whose leading edge was outside the clip.
 // Require a shared speed plus eight complete same-color observations of its trailing edge.
 const recovered=new Map();if(supported){const v=median(inliers.map(v=>v.v));for(const a of primary){if(!a.truncatedStart||a.truncatedEnd)continue;const edges=[];for(let i=1;i<lines.length;i++){const dt=(lines[i]-lines[0])/v,candidates=(groups[i].get(a.midiPitch)||[]).filter(b=>!b.truncatedStart&&!b.truncatedEnd&&distance(a,b)<65&&Math.abs(b.endSeconds-a.endSeconds-dt)<=tolerance&&b.startSeconds-dt<=tolerance);if(candidates.length===1)edges.push({y:lines[i],start:candidates[0].startSeconds-dt});}if(edges.length>=8&&Math.max(...edges.map(e=>e.y))-Math.min(...edges.map(e=>e.y))>=height*.25){const start=median(edges.map(e=>e.start)),consistent=edges.filter(e=>Math.abs(e.start-start)<=tolerance);if(consistent.length>=8&&consistent.length>=edges.length*.85)recovered.set(a,start);}}}
 const notes=primary.map(a=>{const own=byPrimary.get(a),offset=own?(referenceY-lines[0])/own.v:delay,startSeconds=Math.max(0,(recovered.has(a)?recovered.get(a):a.startSeconds)+offset),endSeconds=startSeconds<duration?Math.min(duration,a.endSeconds+offset):a.endSeconds+offset;if(startSeconds>=duration)diagnostics.outsideClip++;return{...a,startSeconds,endSeconds,durationSeconds:recovered.has(a)||(a.endSeconds+offset>duration&&startSeconds<duration)?endSeconds-startSeconds:a.durationSeconds,truncatedStart:recovered.has(a)?false:a.truncatedStart,truncatedEnd:a.truncatedEnd||a.endSeconds+offset>duration,evidence:{primaryStartSeconds:a.startSeconds,primaryEndSeconds:a.endSeconds,recoveredLeadingEdge:recovered.has(a),timingSource:own?'dense-motion':supported?'common-motion':'uncalibrated',offsetSeconds:offset,verified:!!own||supported,matchedLines:own?.support||0}};});
 diagnostics.timingReference=notes.every(n=>n.evidence.verified)?'keyboard-line-estimated':notes.some(n=>n.evidence.verified)?'mixed-unconfirmed':'upper-line';diagnostics.correctedCandidates=notes.filter(n=>n.evidence.verified).length;diagnostics.unconfirmed=primary.length-diagnostics.correctedCandidates;diagnostics.offsetRangeSeconds=notes.length?notes.reduce((r,n)=>[Math.min(r[0],n.evidence.offsetSeconds),Math.max(r[1],n.evidence.offsetSeconds)],[Infinity,-Infinity]):[0,0];diagnostics.warning=diagnostics.unconfirmed?'時刻未補正の候補を保持しています。同期補正・個別確認が必要です。':'複数の高さで開始・終了の軌跡が一致した候補の時刻を補正しました。原音との同期は別途確認してください。';

 return{notes,unconfirmedNotes:[],diagnostics};
}
function createScan({width,height,hitLineY,lanes,fps,duration,mode='single',primaryPercent=20}){
 const lines=linePlan(hitLineY,height,mode,primaryPercent),trackers=lines.map(()=>new core.Tracker({fps,duration})),detect=core.createRowDetector(width,lanes);
 return{lines,detect,push(time,rows){rows.forEach((hits,i)=>trackers[i].push(time,hits));},finish(){
  const observations=trackers.map(t=>t.finish()),discarded=trackers[0].discarded;
  if(mode!=='motion')return{notes:observations[0],unconfirmedNotes:[],discarded,diagnostics:{method:mode==='upper'?'upper-single':'single-line',lineYs:lines,calibrated:mode==='single',offsetSeconds:0,timingReference:mode==='upper'?'upper-line':'keyboard-line'}};
  return{...fuse(lines,observations,{fps,duration,height,referenceY:hitLineY}),discarded};
 }};
}
const api={linePlan,fuse,createScan};if(typeof module==='object'&&module.exports)module.exports=api;else root.PianoRollMotionCore=api;
})(globalThis);
