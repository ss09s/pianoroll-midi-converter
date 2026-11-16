/* 0.7.28: shared spatial observations repair primary timing and reject positively stationary artifacts. */
(function(root){'use strict';
const core=typeof module==='object'&&module.exports?require('./note-core.js'):root.PianoRollNoteCore;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const median=a=>{const s=a.slice().sort((a,b)=>a-b);return s.length?s[Math.floor(s.length/2)]:null;};
function linePlan(referenceY,height,mode='motion',primaryPercent=20){
 const y=clamp(Math.round(referenceY),0,height-1),upper=Math.min(Math.max(0,y-8),clamp(Math.round(height*clamp(Number(primaryPercent)||20,3,65)/100),0,height-1));
 if(mode==='single')return[y];if(mode==='upper'||y<16)return[upper];
 // Dense spatial observations across the falling area. The first row alone owns notes.
 const top=Math.min(upper,Math.round(height*.03)),bottom=Math.max(upper,Math.round(upper+(y-upper)*.85));
 return [...new Set([upper,...Array.from({length:49},(_,i)=>clamp(upper+i-24,0,height-1)),...Array.from({length:32},(_,i)=>Math.round(top+(bottom-top)*i/31))])];
}
const distance=(a,b)=>Math.hypot(...(a.rawColorRGB||a.colorRGB).map((v,i)=>v-(b.rawColorRGB||b.colorRGB)[i]));
const bodyDistance=(a,b)=>Math.hypot(...a.colorRGB.map((v,i)=>v-b.colorRGB[i]));
function compatible(a,b,fps){return a.midiPitch===b.midiPitch&&!b.truncatedStart&&!b.truncatedEnd&&distance(a,b)<65&&Math.abs(a.durationSeconds-b.durationSeconds)<=Math.max(2/fps,.12*a.durationSeconds);}
function lowerBound(list,time){let a=0,b=list.length;while(a<b){const m=(a+b)>>1;if(list[m].startSeconds<time)a=m+1;else b=m;}return a;}
// Balance height regions so the 49 nearby rows cannot outweigh distant evidence.
// Robust slope/offset seed -> reject residual outliers -> weighted mean of arrival times.
function robustEdge(points,key,v,{fps,height,referenceY,minSpan}){
 if(points.length<8)return null;
 const buckets=new Map();for(const p of points){const k=Math.floor(p.y/(height/16));if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(p);}
 const bins=[...buckets.values()].map(ps=>({y:median(ps.map(p=>p.y)),t:median(ps.map(p=>p.b[key]))})),slopes=[];
 for(let i=0;i<bins.length;i++)for(let j=i+1;j<bins.length;j++)if(Math.abs(bins[j].y-bins[i].y)>=height*.12)slopes.push((bins[j].t-bins[i].t)/(bins[j].y-bins[i].y));
 const seed=median(slopes);if(!(seed>0)||Math.abs(1/seed-v)/v>.12)return null;
 const offsets=bins.map(p=>p.t+(referenceY-p.y)*seed),center=median(offsets),mad=median(offsets.map(t=>Math.abs(t-center))),cut=Math.min(1.5/fps,Math.max(.75/fps,3*1.4826*mad));
 const kept=points.filter(p=>Math.abs(p.b[key]+(referenceY-p.y)*seed-center)<=cut);
 if(kept.length<8||kept.length<points.length*.7||Math.max(...kept.map(p=>p.y))-Math.min(...kept.map(p=>p.y))<minSpan)return null;
 const counts=new Map();for(const p of kept){const k=Math.floor(p.y/(height/16));counts.set(k,(counts.get(k)||0)+1);}
 const weighted=kept.map(p=>({...p,w:1/counts.get(Math.floor(p.y/(height/16)))})),sum=weighted.reduce((s,p)=>s+p.w,0),my=weighted.reduce((s,p)=>s+p.w*p.y,0)/sum,mt=weighted.reduce((s,p)=>s+p.w*p.b[key],0)/sum;
 const den=weighted.reduce((s,p)=>s+p.w*(p.y-my)**2,0),slope=weighted.reduce((s,p)=>s+p.w*(p.y-my)*(p.b[key]-mt),0)/den;
 if(!(slope>0)||Math.abs(1/slope-v)/v>.12)return null;
 const times=weighted.map(p=>p.b[key]+(referenceY-p.y)*slope),time=times.reduce((s,t,i)=>s+t*weighted[i].w,0)/sum;
 if(times.some(t=>Math.abs(t-time)>1.5/fps))return null;
 return{time,slope,rows:kept.length,outliers:points.length-kept.length,spreadSeconds:Math.sqrt(times.reduce((s,t,i)=>s+weighted[i].w*(t-time)**2,0)/sum)};
}
// Join a short detached tail only when other heights observe one continuous body.
// A travelling separator vetoes joining, preserving true close repeated notes.
function healTails(primary,lines,groups,v,localGaps,{fps,height,referenceY}){
 const byPitch=new Map();for(const n of primary){if(!byPitch.has(n.midiPitch))byPitch.set(n.midiPitch,[]);byPitch.get(n.midiPitch).push(n);}
 const joined=[],out=[];
 for(const list of byPitch.values()){
  list.sort((a,b)=>a.startSeconds-b.startSeconds);let a=list[0];
  for(let k=1;k<list.length;k++){
   const b=list[k],gap=b.startSeconds-a.endSeconds,total=b.endSeconds-a.startSeconds;
   let rows=[];
   if(!a.truncatedStart&&!b.truncatedEnd&&gap>=0&&gap<=2/fps&&b.durationSeconds<=Math.min(.25,total*.25)&&a.durationSeconds>=4/fps&&bodyDistance(a,b)<40){
    const cutTime=(a.endSeconds+b.startSeconds)/2+(referenceY-lines[0])/v,gaps=localGaps.filter(g=>g.pitch===a.midiPitch&&Math.abs(g.time+(referenceY-g.y)/v-cutTime)<=2/fps);
    const hasMovingGap=new Set(gaps.map(g=>g.time)).size>=3&&Math.max(...gaps.map(g=>g.y))-Math.min(...gaps.map(g=>g.y))>=6;
    if(!hasMovingGap)for(let i=1;i<lines.length;i++){
     const shift=(lines[i]-lines[0])/v,ns=groups[i].get(a.midiPitch)||[];
     const candidates=ns.filter(n=>!n.truncatedStart&&!n.truncatedEnd&&bodyDistance(a,n)<65&&Math.abs(n.startSeconds-shift-a.startSeconds)<=2/fps&&Math.abs(n.endSeconds-shift-b.endSeconds)<=2/fps&&n.startSeconds-shift<a.endSeconds-.5/fps&&n.endSeconds-shift>b.startSeconds+.5/fps);
     if(candidates.length===1)rows.push(lines[i]);
    }
   }
   if(rows.length>=8&&Math.max(...rows)-Math.min(...rows)>=height*.2){
    const combined={...a,endSeconds:b.endSeconds,durationSeconds:total,surfaceJoinedParts:(a.surfaceJoinedParts||1)+(b.surfaceJoinedParts||1),surfaceJoinRows:rows.length};joined.push({midiPitch:a.midiPitch,gapStart:a.endSeconds,gapEnd:b.startSeconds,rows:rows.length});a=combined;
   }else{out.push(a);a=b;}
  }out.push(a);
 }
 out.sort((a,b)=>a.startSeconds-b.startSeconds||a.midiPitch-b.midiPitch);return{primary:out,joined};
}
// A supported space-time interval must be observed on >=8 distinct rows.
// Never split from color changes alone or a single-frame hole on one row.
function refineEdges(primary,base,lines,groups,velocity,{fps,height,referenceY,duration}){
 if(!(velocity>0)||primary.truncatedStart||primary.truncatedEnd)return[base];
 const tol=1.5/fps, projected=[];
 for(let i=1;i<lines.length;i++)for(const b of groups[i].get(primary.midiPitch)||[]){
  if(b.truncatedStart||b.truncatedEnd||distance(primary,b)>=65)continue;
  const shift=(lines[i]-lines[0])/velocity,s=b.startSeconds-shift,e=b.endSeconds-shift;
  if(s<primary.startSeconds-tol||e>primary.endSeconds+tol||e<=s)continue;
  projected.push({row:i,y:lines[i],s,e,b});
 }
 const clusters=[];
 for(const p of projected.sort((a,b)=>a.s-b.s||a.e-b.e)){let c=clusters.find(c=>Math.abs(c.s-p.s)<=tol&&Math.abs(c.e-p.e)<=tol);if(!c){c={s:p.s,e:p.e,points:[]};clusters.push(c);}if(!c.points.some(q=>q.row===p.row)){c.points.push(p);c.s=median(c.points.map(q=>q.s));c.e=median(c.points.map(q=>q.e));}}
 const fit=(points,key)=>robustEdge(points,key,velocity,{fps,height,referenceY,minSpan:height*.25});
 const valid=[];
 for(const c of clusters){if(c.points.length<8||Math.max(...c.points.map(p=>p.y))-Math.min(...c.points.map(p=>p.y))<height*.25)continue;const start=fit(c.points,'startSeconds'),end=fit(c.points,'endSeconds');if(!start||!end||Math.abs(start.slope-end.slope)/start.slope>.08||end.time-start.time<1/fps)continue;valid.push({...c,start:start.time,end:end.time,startFit:start,endFit:end});}
 valid.sort((a,b)=>a.s-b.s);if(!valid.length)return[base];
 // Conflicting/overlapping tracks are ambiguous; keep the original candidate.
 if(valid.some((c,i)=>i&&c.s<valid[i-1].e+.5/fps))return[base];
 if(Math.abs(valid[0].s-primary.startSeconds)>tol||Math.abs(valid.at(-1).e-primary.endSeconds)>tol)return[base];
 if(valid.some(c=>c.start<0||c.end>duration))return[base];
 return valid.map(c=>({...base,startSeconds:c.start,endSeconds:c.end,durationSeconds:Math.abs(c.end-c.start-primary.durationSeconds)<1e-9?primary.durationSeconds:c.end-c.start,evidence:{...base.evidence,timingSource:valid.length>1?'surface-split':'surface-edges',offsetSeconds:c.start-primary.startSeconds,edgeRows:Math.min(c.startFit.rows,c.endFit.rows),timingEstimator:'outlier-filtered-height-balanced-mean',timingOutliers:c.startFit.outliers+c.endFit.outliers,timingSpreadSeconds:Math.max(c.startFit.spreadSeconds,c.endFit.spreadSeconds),splitParts:valid.length,primaryStartSeconds:primary.startSeconds,primaryEndSeconds:primary.endSeconds,verified:true}}));
}

function spatialGaps(lines,hits,time,primaryY,rawRows=null,laneCenters=null){
 const near=lines.map((y,i)=>({y,h:hits[i],raw:rawRows?.[i]})).filter(r=>Math.abs(r.y-primaryY)<=24).sort((a,b)=>a.y-b.y),pitches=new Set(near.flatMap(r=>r.h.map(h=>h.pitch))),out=[];
 if(near.length<10)return out;
 for(const pitch of pitches){const rows=near.map(r=>{const c=r.h.find(h=>h.pitch===pitch)?.colorRGB,k=laneCenters?.get(pitch);return{y:r.y,c,raw:r.raw&&k!==undefined?[r.raw[k],r.raw[k+1],r.raw[k+2]]:c};}),lum=c=>c?(.2126*c[0]+.7152*c[1]+.0722*c[2]):0;
  for(let i=3;i<rows.length-3;i++){
   // A narrow dark separator must have a solid body on both sides.
   const a=rows[i-1],left=rows.slice(i-3,i);if(!left.every(r=>r.c)||left.some(r=>Math.abs(r.y-a.y)>2))continue;
   const level=median(left.map(r=>lum(r.c)));if(level<65||lum(rows[i].raw)>=level*.55)continue;
   let j=i;while(j<rows.length&&j-i<7&&lum(rows[j].raw)<level*.55)j++;
   if(j-i>6||j+2>=rows.length)continue;const right=rows.slice(j,j+3);if(!right.every(r=>r.c)||right.some((r,k)=>r.y!==rows[j].y+k))continue;
   if(right.some(r=>lum(r.c)<level*.7)||Math.hypot(...a.c.map((v,k)=>v-right[0].c[k]))>65)continue;
   if(rows[j].y-rows[i].y!==j-i)continue;
   out.push({pitch,time,y:(rows[i].y+rows[j-1].y)/2,height:j-i});i=j;
  }
 }return out;
}
function splitSpatial(primary,base,gaps,v,{fps,referenceY}){
 if(!(v>0)||primary.truncatedStart||primary.truncatedEnd||base.evidence.timingSource==='surface-split')return[base];
 const projected=(gaps.get(primary.midiPitch)||[]).map(g=>({...g,t:g.time+(referenceY-g.y)/v})).filter(g=>g.t>base.startSeconds+2/fps&&g.t<base.endSeconds-2/fps).sort((a,b)=>a.t-b.t),clusters=[];
 for(const g of projected){let c=clusters.find(c=>Math.abs(c.t-g.t)<=1/fps);if(!c){c={t:g.t,points:[]};clusters.push(c);}c.points.push(g);c.t=median(c.points.map(p=>p.t));}
 const cuts=clusters.filter(c=>new Set(c.points.map(p=>p.time)).size>=3&&Math.max(...c.points.map(p=>p.y))-Math.min(...c.points.map(p=>p.y))>=6).map(c=>({t:c.t,gap:median(c.points.map(p=>p.height))/v,frames:new Set(c.points.map(p=>p.time)).size}));
 if(!cuts.length||cuts.some((c,i)=>i&&c.t-cuts[i-1].t<2/fps))return[base];
 const pieces=[];let start=base.startSeconds;for(const c of cuts){const end=c.t-c.gap/2;if(end-start<1/fps)return[base];pieces.push({startSeconds:start,endSeconds:end});start=c.t+c.gap/2;}if(base.endSeconds-start<1/fps)return[base];pieces.push({startSeconds:start,endSeconds:base.endSeconds});
 return pieces.map(p=>({...base,...p,durationSeconds:p.endSeconds-p.startSeconds,evidence:{...base.evidence,timingSource:'local-surface-split',splitParts:pieces.length,gapFrames:Math.min(...cuts.map(c=>c.frames)),verified:true}}));
}

// Reconsider primary mistakes using independent complete intervals from other rows.
// A common, well-supported speed is required. Missing evidence alone never removes a note.
function reconcileSurface(notes,primary,lines,groups,v,{fps,height,referenceY,duration}){
 const tol=1.5/fps, spanMin=Math.max(48,height*.2), maxShift=Math.min(1,Math.max(4/fps,(referenceY-lines[0])/v*.5));
 const parents=new Map(primary.map(a=>[a.midiPitch+':'+a.startSeconds,a]));
 let repaired=0;const rejected=[],out=[],repairOriginals=new Map();
 const fit=(points,key)=>robustEdge(points,key,v,{fps,height,referenceY,minSpan:spanMin});
 for(const base of notes){
  const a=parents.get(base.midiPitch+':'+base.evidence.primaryStartSeconds);
  if(!a||a.truncatedStart||a.truncatedEnd){out.push(base);continue;}
  const clusters=[];
  for(let i=1;i<lines.length;i++){
   const shift=(referenceY-lines[i])/v,list=groups[i].get(a.midiPitch)||[];
   for(let k=lowerBound(list,base.startSeconds-maxShift-shift-tol);k<list.length&&list[k].startSeconds<=base.endSeconds-shift+tol;k++){
    const b=list[k];if(b.truncatedStart||b.truncatedEnd||distance(a,b)>=65)continue;
    const s=b.startSeconds+shift,e=b.endSeconds+shift,overlap=Math.min(e,base.endSeconds)-Math.max(s,base.startSeconds);
    // One trustworthy edge anchors a delayed/early opposite edge. Don't jump to neighbors.
    if(overlap<.5*Math.min(e-s,base.durationSeconds)||Math.min(Math.abs(s-base.startSeconds),Math.abs(e-base.endSeconds))>2/fps||Math.max(Math.abs(s-base.startSeconds),Math.abs(e-base.endSeconds))>maxShift)continue;
    let c=clusters.find(c=>Math.abs(c.s-s)<=tol&&Math.abs(c.e-e)<=tol);
    if(!c){c={s,e,points:[]};clusters.push(c);}
    if(!c.points.some(p=>p.row===i)){c.points.push({row:i,y:lines[i],b});c.s=median(c.points.map(p=>p.b.startSeconds+(referenceY-p.y)/v));c.e=median(c.points.map(p=>p.b.endSeconds+(referenceY-p.y)/v));}
   }
  }
  const valid=[];
  for(const c of clusters){
   if(c.points.length<8||Math.max(...c.points.map(p=>p.y))-Math.min(...c.points.map(p=>p.y))<spanMin)continue;
   const start=fit(c.points,'startSeconds'),end=fit(c.points,'endSeconds');
   if(!start||!end||Math.abs(start.slope-end.slope)/start.slope>.08||start.time<0||end.time>duration||end.time-start.time<1/fps)continue;
   valid.push({start:start.time,end:end.time,rows:Math.min(start.rows,end.rows),outliers:start.outliers+end.outliers,spread:Math.max(start.spreadSeconds,end.spreadSeconds)});
  }
  if(valid.length===1){const t=valid[0];
   if(Math.max(Math.abs(t.start-base.startSeconds),Math.abs(t.end-base.endSeconds))>1e-9){
    repaired++;const fixed={...base,startSeconds:t.start,endSeconds:t.end,durationSeconds:t.end-t.start,evidence:{...base.evidence,timingSource:'surface-repaired',surfaceRows:t.rows,timingEstimator:'outlier-filtered-height-balanced-mean',timingOutliers:t.outliers,timingSpreadSeconds:t.spread,previousStartSeconds:base.startSeconds,previousEndSeconds:base.endSeconds,offsetSeconds:t.start-a.startSeconds,verified:true}};repairOriginals.set(fixed,base);out.push(fixed);continue;
   }
   out.push(base);continue;
  }
  // Positive counter-evidence: a broad object appears/disappears simultaneously
  // above and below the primary, instead of travelling at the measured speed.
  // Competing moving tracks are ambiguous and must never be removed here.
  if(!valid.length){
   const stationary=[];
   for(let i=1;i<lines.length;i++){
    if(Math.abs(lines[i]-lines[0])>24)continue;
    const list=groups[i].get(a.midiPitch)||[];
    for(let k=lowerBound(list,a.startSeconds-.5/fps);k<list.length&&list[k].startSeconds<=a.startSeconds+.5/fps;k++){
     const b=list[k];if(!b.truncatedStart&&!b.truncatedEnd&&distance(a,b)<40&&Math.abs(b.endSeconds-a.endSeconds)<=.5/fps){stationary.push(lines[i]);break;}
    }
   }
   if(stationary.length>=8&&Math.min(...stationary)<=lines[0]-5&&Math.max(...stationary)>=lines[0]+5&&Math.max(...stationary)-Math.min(...stationary)>=Math.max(12,4*v/fps)){
    rejected.push({...base,evidence:{...base.evidence,verified:false,rejectionReason:'stationary-across-rows',stationaryRows:stationary.length}});continue;
   }
  }
  out.push(base);
 }
 // Two primary fragments must not both expand onto the same moving interval.
 const collisions=new Set();for(const a of repairOriginals.keys())for(const b of out){if(a!==b&&a.midiPitch===b.midiPitch&&bodyDistance(a,b)<65&&Math.abs(a.startSeconds-b.startSeconds)<=tol&&Math.abs(a.endSeconds-b.endSeconds)<=tol)collisions.add(a);}
 for(let i=0;i<out.length;i++)if(collisions.has(out[i])){out[i]=repairOriginals.get(out[i]);repaired--;}
 out.sort((a,b)=>a.startSeconds-b.startSeconds||a.midiPitch-b.midiPitch);
 return {notes:out,repaired,rejected};
}

function fuse(lines,observations,{fps,duration,height,referenceY=lines.at(-1),localGaps=[]}){
 let primary=observations[0];const originalPrimaryCount=primary.length,groups=observations.map(list=>{const m=new Map();for(const n of list){if(!m.has(n.midiPitch))m.set(n.midiPitch,[]);m.get(n.midiPitch).push(n);}for(const ns of m.values())ns.sort((a,b)=>a.startSeconds-b.startSeconds);return m;});
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
 const healed=supported?healTails(primary,lines,groups,median(inliers.map(v=>v.v)),localGaps,{fps,height,referenceY}):{primary,joined:[]};
 primary=healed.primary;for(const a of primary)if(a.surfaceJoinedParts)byPrimary.set(a,{v:median(inliers.map(v=>v.v)),support:a.surfaceJoinRows});
 const diagnostics={method:'dense-primary-calibration',lineYs:lines,primaryY:lines[0],referenceY,primaryCandidates:originalPrimaryCount,tailJoins:healed.joined,tailJoinedCandidates:healed.joined.length,motionTracks:inliers.length,velocityVotes:votes.length,calibrated:supported,offsetSeconds:delay,velocityPixelsPerSecond:supported?median(inliers.map(v=>v.v)):null,unconfirmed:supported?0:primary.length,outsideClip:0,timingReference:supported?'keyboard-line-estimated':'upper-line',warning:supported?'一定速度の一致から全候補へ同じ移動時間を加算しました。原音との同期を保証するものではありません。':'速度の一致が不十分です。候補を削除せず上側通過時刻のまま保持しました。同期補正で調整してください。'};
 // Recover only an already-present primary whose leading edge was outside the clip.
 // Require a shared speed plus eight complete same-color observations of its trailing edge.
 const recovered=new Map();if(supported){const v=median(inliers.map(v=>v.v));for(const a of primary){if(!a.truncatedStart||a.truncatedEnd)continue;const edges=[];for(let i=1;i<lines.length;i++){const dt=(lines[i]-lines[0])/v,candidates=(groups[i].get(a.midiPitch)||[]).filter(b=>!b.truncatedStart&&!b.truncatedEnd&&distance(a,b)<65&&Math.abs(b.endSeconds-a.endSeconds-dt)<=tolerance&&b.startSeconds-dt<=tolerance);if(candidates.length===1)edges.push({y:lines[i],start:candidates[0].startSeconds-dt});}if(edges.length>=8&&Math.max(...edges.map(e=>e.y))-Math.min(...edges.map(e=>e.y))>=height*.25){const start=median(edges.map(e=>e.start)),consistent=edges.filter(e=>Math.abs(e.start-start)<=tolerance);if(consistent.length>=8&&consistent.length>=edges.length*.85)recovered.set(a,start);}}}
 let notes=primary.map(a=>{const own=byPrimary.get(a),offset=own?(referenceY-lines[0])/own.v:delay,startSeconds=Math.max(0,(recovered.has(a)?recovered.get(a):a.startSeconds)+offset),endSeconds=startSeconds<duration?Math.min(duration,a.endSeconds+offset):a.endSeconds+offset;if(startSeconds>=duration)diagnostics.outsideClip++;return{...a,startSeconds,endSeconds,durationSeconds:recovered.has(a)||(a.endSeconds+offset>duration&&startSeconds<duration)?endSeconds-startSeconds:a.durationSeconds,truncatedStart:recovered.has(a)?false:a.truncatedStart,truncatedEnd:a.truncatedEnd||a.endSeconds+offset>duration,evidence:{primaryStartSeconds:a.startSeconds,primaryEndSeconds:a.endSeconds,recoveredLeadingEdge:recovered.has(a),joinedParts:a.surfaceJoinedParts||1,joinRows:a.surfaceJoinRows||0,timingSource:own?'dense-motion':supported?'common-motion':'uncalibrated',offsetSeconds:offset,verified:!!own||supported,matchedLines:own?.support||0}};});
 const beforeRefine=notes;notes=primary.flatMap((a,i)=>refineEdges(a,beforeRefine[i],lines,groups,byPrimary.get(a)?.v||(supported?median(inliers.map(v=>v.v)):0),{fps,height,referenceY,duration}));notes.sort((a,b)=>a.startSeconds-b.startSeconds||a.midiPitch-b.midiPitch);
 diagnostics.edgeRefined=notes.filter(n=>n.evidence.timingSource==='surface-edges').length;diagnostics.splitCandidates=primary.filter((a,i)=>notes.filter(n=>n.evidence.primaryStartSeconds===a.startSeconds&&n.midiPitch===a.midiPitch&&n.evidence.timingSource==='surface-split').length>1).length;diagnostics.splitNotes=notes.filter(n=>n.evidence.timingSource==='surface-split').length;
 const gapGroups=new Map();for(const g of localGaps){if(!gapGroups.has(g.pitch))gapGroups.set(g.pitch,[]);gapGroups.get(g.pitch).push(g);}let localSplit=0;notes=notes.flatMap(base=>{const a=primary.find(a=>a.midiPitch===base.midiPitch&&a.startSeconds===base.evidence.primaryStartSeconds);if(!a)return[base];const parts=splitSpatial(a,base,gapGroups,byPrimary.get(a)?.v||(supported?median(inliers.map(x=>x.v)):0),{fps,referenceY});if(parts.length>1)localSplit++;return parts;});diagnostics.localSplitCandidates=localSplit;diagnostics.localGapObservations=localGaps.length;diagnostics.localSplitNotes=notes.filter(n=>n.evidence.timingSource==='local-surface-split').length;
 const reconsidered=supported?reconcileSurface(notes,primary,lines,groups,median(inliers.map(v=>v.v)),{fps,height,referenceY,duration}):{notes,repaired:0,rejected:[]};
 notes=reconsidered.notes;diagnostics.surfaceRepairedNotes=reconsidered.repaired;diagnostics.surfaceRejectedNotes=reconsidered.rejected.length;diagnostics.rejectedCandidates=reconsidered.rejected;
 diagnostics.surfaceAveragedNotes=notes.filter(n=>n.evidence.timingEstimator==='outlier-filtered-height-balanced-mean').length;
 diagnostics.timingReference=notes.every(n=>n.evidence.verified)?'keyboard-line-estimated':notes.some(n=>n.evidence.verified)?'mixed-unconfirmed':'upper-line';diagnostics.correctedCandidates=notes.filter(n=>n.evidence.verified).length;diagnostics.unconfirmed=notes.filter(n=>!n.evidence.verified).length;diagnostics.offsetRangeSeconds=notes.length?notes.reduce((r,n)=>[Math.min(r[0],n.evidence.offsetSeconds),Math.max(r[1],n.evidence.offsetSeconds)],[Infinity,-Infinity]):[0,0];diagnostics.warning=diagnostics.unconfirmed?'時刻未補正の候補を保持しています。同期補正・個別確認が必要です。':'複数の高さで開始・終了の軌跡が一致した候補の時刻を補正しました。原音との同期は別途確認してください。';

 return{notes,unconfirmedNotes:[],diagnostics};
}
function createScan({width,height,hitLineY,lanes,fps,duration,mode='single',primaryPercent=20}){
 const localGaps=[],laneCenters=new Map(lanes.map(l=>[l.pitch,clamp(Math.round(l.x),0,width-1)*4]));const lines=linePlan(hitLineY,height,mode,primaryPercent),trackers=lines.map(()=>new core.Tracker({fps,duration})),detect=core.createRowDetector(width,lanes);
 return{lines,detect,push(time,rows,rawRows=null){if(mode==='motion'&&localGaps.length<1000000)localGaps.push(...spatialGaps(lines,rows,time,lines[0],rawRows,laneCenters));rows.forEach((hits,i)=>trackers[i].push(time,hits));},finish(){
  const observations=trackers.map(t=>t.finish()),discarded=trackers[0].discarded;
  if(mode!=='motion')return{notes:observations[0],unconfirmedNotes:[],discarded,diagnostics:{method:mode==='upper'?'upper-single':'single-line',lineYs:lines,calibrated:mode==='single',offsetSeconds:0,timingReference:mode==='upper'?'upper-line':'keyboard-line'}};
  return{...fuse(lines,observations,{fps,duration,height,referenceY:hitLineY,localGaps}),discarded};
 }};
}
const api={linePlan,fuse,createScan};if(typeof module==='object'&&module.exports)module.exports=api;else root.PianoRollMotionCore=api;
})(globalThis);
