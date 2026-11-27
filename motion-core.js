/* 0.7.48: shared spatial observations repair primary timing and reject positively stationary artifacts. */
(function(root){'use strict';
const core=typeof module==='object'&&module.exports?require('./note-core.js'):root.PianoRollNoteCore;
const textCore=typeof module==='object'&&module.exports?require('./text-overlay.js'):root.PianoRollTextOverlay;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const median=a=>{const s=a.slice().sort((a,b)=>a-b);return s.length?s[Math.floor(s.length/2)]:null;};
function normalizePrimaryPercent(value){const n=value===null||value===undefined||String(value).trim()===''?NaN:Number(value);return Number.isFinite(n)?clamp(n,0,95):20;}
function linePlan(referenceY,height,mode='motion',primaryPercent=20){
 const y=clamp(Math.round(referenceY),0,height-1),upper=Math.min(Math.max(0,y-8),clamp(Math.round(height*clamp(normalizePrimaryPercent(primaryPercent),0,95)/100),0,height-1));
 if(mode==='single')return[y];if(mode==='upper'||y<16)return[upper];
 // Shared spatial observations; primary candidates plus strongly supported short-repeat recovery.
 const top=Math.min(upper,Math.round(height*.03)),bottom=Math.max(upper,Math.round(upper+(y-upper)*.85));
 // A low primary leaves the clean upstream region sparsely sampled. Retain
 // enough independent upstream rows to distinguish a local effect from a gap.
 const sparseCount=normalizePrimaryPercent(primaryPercent)>50?64:32;
 const denseShift=Math.min(0,y-1-upper-24);
 return [...new Set([upper,...Array.from({length:49},(_,i)=>clamp(upper+i-24+denseShift,0,y-1)),...Array.from({length:sparseCount},(_,i)=>Math.round(top+(bottom-top)*i/(sparseCount-1)))])];
}
const distance=(a,b)=>Math.hypot(...(a.rawColorRGB||a.colorRGB).map((v,i)=>v-(b.rawColorRGB||b.colorRGB)[i]));
const bodyDistance=(a,b)=>Math.hypot(...a.colorRGB.map((v,i)=>v-b.colorRGB[i]));
function compatible(a,b,fps){return a.midiPitch===b.midiPitch&&!b.truncatedStart&&!b.truncatedEnd&&distance(a,b)<65&&Math.abs(a.durationSeconds-b.durationSeconds)<=Math.max(2/fps,.12*a.durationSeconds);}
function lowerBound(list,time){let a=0,b=list.length;while(a<b){const m=(a+b)>>1;if(list[m].startSeconds<time)a=m+1;else b=m;}return a;}
// Balance height regions so dense adjacent rows cannot outweigh distant evidence.
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
// A separator must travel at the note speed, rather than merely flicker at nearby rows.
function movingGap(points,v,fps){
 if(new Set(points.map(p=>p.time)).size<2||Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y))<6)return false;
 const mt=points.reduce((s,p)=>s+p.time,0)/points.length,my=points.reduce((s,p)=>s+p.y,0)/points.length,den=points.reduce((s,p)=>s+(p.time-mt)**2,0);if(!den)return false;
 const speed=points.reduce((s,p)=>s+(p.time-mt)*(p.y-my),0)/den;
 return speed>0&&Math.abs(speed-v)/v<=.15&&points.every(p=>Math.abs(p.y-my-speed*(p.time-mt))<=Math.max(1.5,v/fps*.4));
}
// Estimate one boundary with a confirmed shared speed. The opposite edge anchors
// object identity, but its timing is not included in this boundary's mean.
function independentBoundary(note,key,lines,groups,v,{fps,height,referenceY,duration}){
 const other=key==='startSeconds'?'endSeconds':'startSeconds',tol=1.5/fps,limit=Math.min(.5,Math.max(4/fps,note.durationSeconds)),clusters=[];
 for(let i=1;i<lines.length;i++){
  const shift=(referenceY-lines[i])/v;
  const list=groups[i].get(note.midiPitch)||[],shiftedStart=note.startSeconds-shift,window=key==='startSeconds'?limit:2/fps;
  for(let k=lowerBound(list,shiftedStart-window);k<list.length&&list[k].startSeconds<=shiftedStart+window;k++){const b=list[k];
   if((key==='startSeconds'?b.truncatedStart:b.truncatedEnd)||bodyDistance(note,b)>=65||Math.abs(b[other]+shift-note[other])>2/fps)continue;
   const t=b[key]+shift;if(Math.abs(t-note[key])>limit)continue;
   let c=clusters.find(c=>Math.abs(c.t-t)<=tol);if(!c){c={t,points:[]};clusters.push(c);}
   if(!c.points.some(p=>p.row===i)){c.points.push({row:i,y:lines[i],t});c.t=median(c.points.map(p=>p.t));}
  }
 }
 const fits=[];
 for(const c of clusters){
  const bins=new Map();for(const p of c.points){const k=Math.floor(p.y/(height/24));if(!bins.has(k))bins.set(k,[]);bins.get(k).push(p.t);}
  if(bins.size<3)continue;const centers=[...bins.values()].map(median),center=median(centers),mad=median(centers.map(t=>Math.abs(t-center))),cut=Math.min(tol,Math.max(.75/fps,3*1.4826*mad)),kept=c.points.filter(p=>Math.abs(p.t-center)<=cut);
  if(kept.length<8||Math.max(...kept.map(p=>p.y))-Math.min(...kept.map(p=>p.y))<height*.08)continue;
  const keptBins=new Map();for(const p of kept){const k=Math.floor(p.y/(height/24));if(!keptBins.has(k))keptBins.set(k,[]);keptBins.get(k).push(p.t);}
  if(keptBins.size<3||keptBins.size<bins.size*.6)continue;
  const means=[...keptBins.values()].map(ts=>ts.reduce((a,b)=>a+b,0)/ts.length),time=means.reduce((a,b)=>a+b,0)/means.length;
  if(time<0||time>duration||key==='startSeconds'&&(time< (note.evidence.intervalFloor??0)||time>note.endSeconds-1/fps)||key==='endSeconds'&&(time> (note.evidence.intervalCeiling??duration)||time<note.startSeconds+1/fps))continue;
  fits.push({time,rows:kept.length,bins:keptBins.size,minY:Math.min(...kept.map(p=>p.y)),maxY:Math.max(...kept.map(p=>p.y)),outliers:c.points.length-kept.length});
 }
 if(fits.length===1)return fits[0];
 // Prefer a separately supported upper region only when competing regions lie below it.
 const upper=fits.slice().sort((a,b)=>a.maxY-b.maxY)[0];
 return upper&&fits.every(f=>f===upper||upper.maxY<=f.minY+height*.05)?{...upper,upperConsensus:true}:null;
}
function refineIndependent(notes,lines,groups,v,opts){
 let startCount=0,endCount=0,blocked=0;const proposed=notes.map(n=>{
  const start=independentBoundary(n,'startSeconds',lines,groups,v,opts),end=independentBoundary(n,'endSeconds',lines,groups,v,opts);
  let a=start?.time??n.startSeconds,b=end?.time??n.endSeconds;
  // Never let a repaired edge run across a distinct original event.
  for(const other of notes){if(other===n||other.midiPitch!==n.midiPitch||bodyDistance(n,other)>=65)continue;
   if(n.endSeconds<=other.startSeconds+.25/opts.fps&&b>other.startSeconds+.25/opts.fps){b=n.endSeconds;blocked++;}
   if(n.startSeconds>=other.endSeconds-.25/opts.fps&&a<other.endSeconds-.25/opts.fps){a=n.startSeconds;blocked++;}
  }
  if(b-a<1/opts.fps)return n;
  const usedStart=!!start&&a===start.time,usedEnd=!!end&&b===end.time;if(!usedStart&&!usedEnd)return n;
  if(usedStart)startCount++;if(usedEnd)endCount++;
  return{...n,startSeconds:a,endSeconds:b,durationSeconds:Math.abs(b-a-n.durationSeconds)<1e-9?n.durationSeconds:b-a,evidence:{...n.evidence,timingEstimator:'outlier-filtered-height-balanced-mean',independentStartRows:usedStart?start.rows:0,independentEndRows:usedEnd?end.rows:0,independentStartRegions:usedStart?start.bins:0,independentEndRegions:usedEnd?end.bins:0,independentStartOutliers:usedStart?start.outliers:0,independentEndOutliers:usedEnd?end.outliers:0,offsetSeconds:a-n.evidence.primaryStartSeconds}};
 });
 // Competing proposals must not create new overlap between originally disjoint notes.
 const cancel=new Set();for(let i=0;i<notes.length;i++)for(let j=i+1;j<notes.length;j++)if(notes[i].midiPitch===notes[j].midiPitch&&notes[i].endSeconds<=notes[j].startSeconds+.25/opts.fps&&proposed[i].endSeconds>proposed[j].startSeconds+.25/opts.fps){if(proposed[i]!==notes[i])cancel.add(i);if(proposed[j]!==notes[j])cancel.add(j);}
 for(const i of cancel){if(proposed[i].evidence.independentStartRows)startCount--;if(proposed[i].evidence.independentEndRows)endCount--;proposed[i]=notes[i];blocked++;}
 return{notes:proposed.sort((a,b)=>a.startSeconds-b.startSeconds||a.midiPitch-b.midiPitch),startCount,endCount,blocked};
}
// Join a short detached tail only when other heights observe one continuous body.
// A travelling separator vetoes joining, preserving true close repeated notes.
// Hue survives white flare and brightness changes better than RGB distance.
// Continuity still needs independent moving-body observations below.
function sameBodyHue(a,b){
 const hue=c=>{const hi=Math.max(...c),lo=Math.min(...c),d=hi-lo;if(hi<=0||d/hi<.15)return null;let h=hi===c[0]?(c[1]-c[2])/d:hi===c[1]?2+(c[2]-c[0])/d:4+(c[0]-c[1])/d;return(h*60+360)%360;};
 const x=hue(a.colorRGB),y=hue(b.colorRGB);return x!==null&&y!==null&&Math.min(Math.abs(x-y),360-Math.abs(x-y))<=20;
}
function healTails(primary,lines,groups,v,localGaps,{fps,height,referenceY,allowOverlap=false}){
 const byPitch=new Map();for(const n of primary){if(!byPitch.has(n.midiPitch))byPitch.set(n.midiPitch,[]);byPitch.get(n.midiPitch).push(n);}
 const joined=[],out=[];
 for(const list of byPitch.values()){
  list.sort((a,b)=>a.startSeconds-b.startSeconds);let a=list[0];
  for(let k=1;k<list.length;k++){
   const b=list[k],gap=b.startSeconds-a.endSeconds,total=b.endSeconds-a.startSeconds;
   let rows=[],upstreamRecovery=false;
   const cut=(a.endSeconds+b.startSeconds)/2;
   // The edge of a different-color neighboring note can hide part of a
   // held note. Only accept the join from continuous rows across the cut.
   const neighborEdge=allowOverlap&&Math.abs(gap)<=2/fps&&Math.min(a.durationSeconds,b.durationSeconds)>=.18&&
    [-1,1].some(step=>(byPitch.get(a.midiPitch+step)||[]).some(n=>n.laneType!==a.laneType&&
     bodyDistance(a,n)>=75&&n.durationSeconds>=.2&&
     Math.min(Math.abs(n.startSeconds-cut),Math.abs(n.endSeconds-cut))<=2/fps));
   if(!a.truncatedStart&&!b.truncatedEnd&&gap>=(allowOverlap?-2/fps:0)&&gap<=Math.max(2/fps,.15)&&(b.durationSeconds<=Math.min(.25,total*.25)||neighborEdge)&&a.durationSeconds>=4/fps&&(bodyDistance(a,b)<40||sameBodyHue(a,b))){
    const interior=Math.min(2/fps,a.durationSeconds/4,b.durationSeconds/4);
    const cutTime=(a.endSeconds+b.startSeconds)/2+(referenceY-lines[0])/v,gaps=localGaps.filter(g=>g.pitch===a.midiPitch&&Math.abs(g.time+(referenceY-g.y)/v-cutTime)<=2/fps);
    const hasMovingGap=movingGap(gaps,v,fps);
    for(let i=1;i<lines.length;i++){
     const shift=(lines[i]-lines[0])/v,ns=groups[i].get(a.midiPitch)||[];
     const candidates=ns.filter(n=>!n.truncatedStart&&!n.truncatedEnd&&(bodyDistance(a,n)<65||sameBodyHue(a,n))&&n.startSeconds-shift<=a.endSeconds-interior&&n.endSeconds-shift>=b.startSeconds+interior&&n.startSeconds-shift>=a.startSeconds-2/fps);
     if(candidates.length===1)rows.push(lines[i]);
    }
    if(hasMovingGap){
     // A real separator continues through upstream regions. A localized effect
     // can be contradicted only by positively continuous, separated upper rows.
     if(gaps.length&&gaps.every(g=>g.extendedBand)){const firstGapY=Math.min(...gaps.map(g=>g.y));rows=rows.filter(y=>y<=firstGapY-2);upstreamRecovery=true;}else rows=[];
    }
   }
   if(rows.length>=8&&new Set(rows.map(y=>Math.floor(y/(height/24)))).size>=3&&Math.max(...rows)-Math.min(...rows)>=Math.min(40,height*.12)){
    const parts=(a.evidence?.splitParts>1?1:(a.surfaceJoinedParts||1))+(b.evidence?.splitParts>1?1:(b.surfaceJoinedParts||1)),combined={...a,endSeconds:b.endSeconds,durationSeconds:total,surfaceJoinedParts:parts,surfaceJoinRows:rows.length,occlusionRecovered:upstreamRecovery,...(a.evidence?{evidence:{...a.evidence,intervalCeiling:b.evidence?.intervalCeiling,splitParts:1,joinedParts:parts,postSurfaceJoin:true}}:{})};joined.push({midiPitch:a.midiPitch,gapStart:a.endSeconds,gapEnd:b.startSeconds,rows:rows.length,reason:upstreamRecovery?'upstream-continuity':'continuous-interior'});a=combined;
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
 for(let i=1;i<lines.length;i++){const list=groups[i].get(primary.midiPitch)||[],rowShift=(lines[i]-lines[0])/velocity;for(let k=lowerBound(list,primary.startSeconds-tol+rowShift);k<list.length&&list[k].startSeconds<=primary.endSeconds+tol+rowShift;k++){const b=list[k];
  if(b.truncatedStart||b.truncatedEnd||distance(primary,b)>=65)continue;
  const shift=(lines[i]-lines[0])/velocity,s=b.startSeconds-shift,e=b.endSeconds-shift;
  if(s<primary.startSeconds-tol||e>primary.endSeconds+tol||e<=s)continue;
  projected.push({row:i,y:lines[i],s,e,b});
 }}
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
 return valid.map((c,i)=>({...base,startSeconds:c.start,endSeconds:c.end,durationSeconds:Math.abs(c.end-c.start-primary.durationSeconds)<1e-9?primary.durationSeconds:c.end-c.start,evidence:{...base.evidence,timingSource:valid.length>1?'surface-split':'surface-edges',intervalFloor:i?(valid[i-1].end+c.start)/2:undefined,intervalCeiling:i+1<valid.length?(c.end+valid[i+1].start)/2:undefined,offsetSeconds:c.start-primary.startSeconds,edgeRows:Math.min(c.startFit.rows,c.endFit.rows),edgeVelocityPixelsPerSecond:2/(c.startFit.slope+c.endFit.slope),timingEstimator:'outlier-filtered-height-balanced-mean',timingOutliers:c.startFit.outliers+c.endFit.outliers,timingSpreadSeconds:Math.max(c.startFit.spreadSeconds,c.endFit.spreadSeconds),splitParts:valid.length,primaryStartSeconds:primary.startSeconds,primaryEndSeconds:primary.endSeconds,verified:true}}));
}

function spatialGaps(lines,hits,time,primaryY,rawRows=null,laneCenters=null,denseBand=null){
 const near=lines.map((y,i)=>({y,h:hits[i],lookup:new Map(hits[i].map(h=>[h.pitch,h.colorRGB])),raw:rawRows?.[i]})).filter(r=>denseBand?r.y>=denseBand.top&&r.y<=denseBand.bottom:Math.abs(r.y-primaryY)<=24).sort((a,b)=>a.y-b.y),pitches=new Set(near.flatMap(r=>r.h.map(h=>h.pitch))),out=[];
 if(near.length<10)return out;
 for(const pitch of pitches){const rows=near.map(r=>{const c=r.lookup.get(pitch),k=laneCenters?.get(pitch);return{y:r.y,c,raw:r.raw&&k!==undefined?[r.raw[k],r.raw[k+1],r.raw[k+2]]:c};}),lum=c=>c?(.2126*c[0]+.7152*c[1]+.0722*c[2]):0;
  for(let i=3;i<rows.length-3;i++){
   // A narrow dark separator must have a solid body on both sides.
   const a=rows[i-1],left=rows.slice(i-3,i);if(!left.every(r=>r.c)||left.some(r=>Math.abs(r.y-a.y)>2))continue;
   const level=median(left.map(r=>lum(r.c)));if(level<65||lum(rows[i].raw)>=level*.55)continue;
   let j=i;while(j<rows.length&&j-i<7&&lum(rows[j].raw)<level*.55)j++;
   if(j-i>6||j+2>=rows.length)continue;const right=rows.slice(j,j+3);if(!right.every(r=>r.c)||right.some((r,k)=>r.y!==rows[j].y+k))continue;
   if(right.some(r=>lum(r.c)<level*.7)||Math.hypot(...a.c.map((v,k)=>v-right[0].c[k]))>65)continue;
   if(rows[j].y-rows[i].y!==j-i)continue;
   out.push({pitch,time,y:(rows[i].y+rows[j-1].y)/2,height:j-i,...(denseBand?{extendedBand:true}:{} )});i=j;
  }
 }return out;
}
// Rounded note ends narrow across the lane even when the center pixels
// touch. Look for a moving trough in the colored width of a note.
function chromaSeams(rows,hits,lanes,time,top,pairOnly=false){
 const found=[],pitches=new Set();
 for(const row of hits)for(const hit of row)pitches.add(hit.pitch);
 for(const pitch of pitches){
  const lane=lanes.get(pitch);
  if(!lane)continue;
  const {left,right}=lane,values=[];
  for(const row of rows){
   let sum=0;
   for(let x=left;x<=right;x++){
    const i=x*4,a=row[i],b=row[i+1],c=row[i+2];
    sum+=Math.max(a,b,c)-Math.min(a,b,c);
   }
   values.push(sum/(right-left+1));
  }
  const span=pairOnly?6:4;
  for(let i=span;i<values.length-span;i++){
   const val=values[i];
   if(val>values[i-1]||val>=values[i+1])continue;
   const before=pairOnly?Math.max(...values.slice(i-6,i-2)):Math.max(values[i-4],values[i-3],values[i-2]);
   const after=pairOnly?Math.max(...values.slice(i+3,i+7)):Math.max(values[i+2],values[i+3],values[i+4]);
   const shoulder=Math.min(before,after);
   if(shoulder<95||shoulder-val<Math.max(12,shoulder*.10)||val<shoulder*.34)continue;
   found.push({pitch,time,y:top+i,pairOnly,strength:(shoulder-val)/shoulder});
   i++;
  }
 }
 return found;
}

function indexChromaSeams(seams,v,referenceY){
 const byPitch=new Map();
 for(const seam of seams){
  if(!byPitch.has(seam.pitch))byPitch.set(seam.pitch,[]);
  byPitch.get(seam.pitch).push({...seam,startSeconds:seam.time+(referenceY-seam.y)/v});
 }
 for(const list of byPitch.values())list.sort((a,b)=>a.startSeconds-b.startSeconds);
 return byPitch;
}

function findChromaCuts(note,seams,v,fps,pairOnly){
 const minimum=Math.max(.042,1.4/fps),radius=Math.max(.023,.7/fps);
 const clusters=[];
 for(const seam of seams){
  if(Boolean(seam.pairOnly)!==pairOnly)continue;
  if(seam.startSeconds<note.startSeconds+minimum||seam.startSeconds>=note.endSeconds-minimum)continue;
  const group=clusters.at(-1);
  if(group&&Math.abs(seam.startSeconds-median(group.map(s=>s.startSeconds)))<=radius)group.push(seam);
  else clusters.push([seam]);
 }
 const cuts=[];
 for(const group of clusters){
  const center=median(group.map(s=>s.startSeconds));
  const inliers=group.filter(s=>Math.abs(s.startSeconds-center)*v<=(pairOnly ? 2.15 : 1.75));
  if(new Set(inliers.map(s=>s.time)).size<7||
   Math.max(...inliers.map(s=>s.y))-Math.min(...inliers.map(s=>s.y))<16||
   median(inliers.map(s=>s.strength))<(pairOnly ? .115 : .135))continue;
  cuts.push(median(inliers.map(s=>s.startSeconds)));
 }
 if(pairOnly){
  if(cuts.length!==1)return [];
  const before=cuts[0]-note.startSeconds,after=note.endSeconds-cuts[0];
  return Math.min(before,after)>=.062&&Math.max(before,after)<=.205&&
   Math.max(before,after)<=2.3*Math.min(before,after)?cuts:[];
 }
 // Two or more consecutive moving seams confirm a repeated-note chain.
 if(cuts.length<2)return [];
 const intervals=cuts.slice(1).map((t,i)=>t-cuts[i]),spacing=median(intervals);
 if(spacing<minimum||spacing>.21||intervals.some(d=>d<spacing*.74||d>spacing*1.32)||
  cuts[0]-note.startSeconds>spacing*1.9||note.endSeconds-cuts.at(-1)>spacing*1.95)return [];
 return cuts;
}

function splitChromaSeams(notes,byPitch,v,{fps},pairOnly=false){
 const minimum=Math.max(.042,1.4/fps);
 return notes.flatMap(note=>{
  if(pairOnly&&note.evidence.timingSource==='moving-chroma-seam')return[note];
  if(!note.evidence.verified||note.durationSeconds<3*minimum||note.truncatedStart||note.truncatedEnd)return[note];
  const list=byPitch.get(note.midiPitch)||[];
  const seams=list.slice(lowerBound(list,note.startSeconds+minimum),lowerBound(list,note.endSeconds-minimum));
  let cuts=findChromaCuts(note,seams,v,fps,pairOnly);
  // If a 30 fps frame is sampled twice at 60 Hz, the duplicate
  // observations arrive 1/60 s apart and can obscure a narrow seam.
  if(!cuts.length&&fps===60){
   const standardSamples=seams.filter(s=>Math.round(s.time*fps)%2===0);
   cuts=findChromaCuts(note,standardSamples,v,30,pairOnly);
  }
  if(!cuts.length)return[note];
  const points=[note.startSeconds,...cuts,note.endSeconds];
  return points.slice(0,-1).map((startSeconds,i)=>{
   const endSeconds=points[i+1];
   return {...note,startSeconds,endSeconds,durationSeconds:endSeconds-startSeconds,
    evidence:{...note.evidence,timingSource:'moving-chroma-seam',splitParts:points.length-1}};
  });
 });
}

function splitSpatial(primary,base,gaps,v,{fps,referenceY}){
 if(!(v>0)||primary.truncatedStart||primary.truncatedEnd||base.evidence.timingSource==='surface-split')return[base];
 const projected=(gaps.get(primary.midiPitch)||[]).map(g=>({...g,t:g.time+(referenceY-g.y)/v})).filter(g=>g.t>base.startSeconds+1/120&&g.t<base.endSeconds-1/120).sort((a,b)=>a.t-b.t),clusters=[];
 for(const g of projected){let c=clusters.find(c=>Math.abs(c.t-g.t)<=1/fps);if(!c){c={t:g.t,points:[]};clusters.push(c);}c.points.push(g);c.t=median(c.points.map(p=>p.t));}
 const cuts=clusters.filter(c=>movingGap(c.points,v,fps)).map(c=>({t:c.t,gap:median(c.points.map(p=>p.height))/v,frames:new Set(c.points.map(p=>p.time)).size}));
 if(!cuts.length||cuts.some((c,i)=>i&&c.t-cuts[i-1].t<1/60))return[base];
 const pieces=[];let start=base.startSeconds;for(const c of cuts){const end=c.t-c.gap/2;if(end-start<1/120)return[base];pieces.push({startSeconds:start,endSeconds:end});start=c.t+c.gap/2;}if(base.endSeconds-start<1/120)return[base];pieces.push({startSeconds:start,endSeconds:base.endSeconds});
 return pieces.map((p,i)=>({...base,...p,durationSeconds:p.endSeconds-p.startSeconds,evidence:{...base.evidence,timingSource:'local-surface-split',intervalFloor:i?cuts[i-1].t:undefined,intervalCeiling:i<cuts.length?cuts[i].t:undefined,splitParts:pieces.length,gapFrames:Math.min(...cuts.map(c=>c.frames)),verified:true}}));
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
  if(!a||a.truncatedStart||a.truncatedEnd||base.evidence.splitParts>1){out.push(base);continue;}
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
 for(let i=0;i<out.length;i++){const fixed=out[i],original=repairOriginals.get(fixed);if(!original)continue;
  const crosses=out.some(other=>{if(other===fixed||other.midiPitch!==fixed.midiPitch||bodyDistance(fixed,other)>=65)return false;const prior=repairOriginals.get(other)||other;
   return original.endSeconds<=prior.startSeconds+.25/fps&&fixed.endSeconds>prior.startSeconds+.25/fps||original.startSeconds>=prior.endSeconds-.25/fps&&fixed.startSeconds<prior.endSeconds-.25/fps;});
  if(crosses){out[i]=original;repairOriginals.delete(fixed);repaired--;}
 }
 // Two primary fragments must not both expand onto the same moving interval.
 const collisions=new Set();for(const a of repairOriginals.keys())for(const b of out){if(a!==b&&a.midiPitch===b.midiPitch&&bodyDistance(a,b)<65&&Math.abs(a.startSeconds-b.startSeconds)<=tol&&Math.abs(a.endSeconds-b.endSeconds)<=tol)collisions.add(a);}
 for(let i=0;i<out.length;i++)if(collisions.has(out[i])){out[i]=repairOriginals.get(out[i]);repaired--;}
 out.sort((a,b)=>a.startSeconds-b.startSeconds||a.midiPitch-b.midiPitch);
 return {notes:out,repaired,rejected};
}

// Recover short repeated bodies independently of primary-line occupancy.
// Each accepted interval must travel at the calibrated speed across separated
// height regions; proximity to an existing same-pitch event limits recovery.
// A missed thin separator can produce more merged observations than split ones.
// A pair of independently moving complete bodies is positive boundary evidence;
// a merged run cannot outvote that evidence merely by occupying more rows.
function preferSeparatedBodies(valid,fps){
 const tol=1/fps,removed=new Set();
 for(const a of valid){
  const parts=valid.filter(b=>b!==a&&b.midiPitch===a.midiPitch&&sameBodyHue(a,b)&&b.durationSeconds<a.durationSeconds*.8&&b.startSeconds>=a.startSeconds-tol&&b.endSeconds<=a.endSeconds+tol).sort((a,b)=>a.startSeconds-b.startSeconds);
  for(const first of parts){if(Math.abs(first.startSeconds-a.startSeconds)>tol)continue;const chain=[first];
   for(const b of parts){if(b===first||b.startSeconds<chain.at(-1).endSeconds+tol*.25)continue;if(b.startSeconds-chain.at(-1).endSeconds>Math.max(2*tol,a.durationSeconds*.25))continue;chain.push(b);}
   if(chain.length>=2&&Math.abs(chain.at(-1).endSeconds-a.endSeconds)<=tol&&chain.reduce((n,b)=>n+b.durationSeconds,0)>=a.durationSeconds*.65){removed.add(a);break;}
  }
 }
 return valid.filter(n=>!removed.has(n));
}
function recoverSurfaceRepeats(notes,lines,groups,v,{fps,height,referenceY,duration}){
 const sameColor=(a,b)=>{const ca=a.colorRGB,cb=b.colorRGB,ma=Math.max(...ca),mb=Math.max(...cb);return ma>0&&mb>0&&(Math.hypot(...ca.map((v,i)=>v/ma-cb[i]/mb))<.22||sameBodyHue(a,b));};
 const byPitch=new Map();for(const n of notes){if(!byPitch.has(n.midiPitch))byPitch.set(n.midiPitch,[]);byPitch.get(n.midiPitch).push(n);}
 const replacements=new Map(),additions=[],tol=1/fps,tracks=[];
 for(const [pitch,existing] of byPitch){
  const projected=[];
  for(let i=1;i<lines.length;i++){const shift=(referenceY-lines[i])/v;for(const b of groups[i].get(pitch)||[]){if(b.truncatedStart||b.truncatedEnd||b.durationSeconds>.35||b.durationSeconds<=0)continue;const s=b.startSeconds+shift,e=b.endSeconds+shift;if(s<0||e>duration)continue;projected.push({row:i,y:lines[i],b,s,e});}}
  projected.sort((a,b)=>a.s-b.s||a.e-b.e);
  const clusters=[];
  for(const p of projected){let best=null,error=Infinity;for(let k=clusters.length-1;k>=0;k--){const c=clusters[k];if(c.s<p.s-2*tol)break;const d=Math.max(Math.abs(c.s-p.s),Math.abs(c.e-p.e));if(d<=tol&&sameColor(c.points[0].b,p.b)&&d<error){best=c;error=d;}}if(!best){best={s:p.s,e:p.e,points:[]};clusters.push(best);}if(!best.points.some(q=>q.row===p.row)){best.points.push(p);best.s=median(best.points.map(q=>q.s));best.e=median(best.points.map(q=>q.e));}}
  const valid=[];
  for(const c of clusters){const points=c.points,regions=new Set(points.map(p=>Math.floor(p.y/(height/16))));if(points.length<12||regions.size<5||Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y))<height*.25)continue;
   const start=robustEdge(points,'startSeconds',v,{fps,height,referenceY,minSpan:height*.25}),end=robustEdge(points,'endSeconds',v,{fps,height,referenceY,minSpan:height*.25});if(!start||!end||Math.abs(start.slope-end.slope)/start.slope>.08||end.time<=start.time||end.time-start.time>.35||start.time<0||end.time>duration)continue;
   const n={...points[0].b,colorRGB:[0,1,2].map(k=>median(points.map(p=>p.b.colorRGB[k]))),startSeconds:start.time,endSeconds:end.time,durationSeconds:end.time-start.time,evidence:{timingSource:'surface-repeat-recovery',timingEstimator:'outlier-filtered-height-balanced-mean',verified:true,surfaceRecoveryRows:Math.min(start.rows,end.rows),surfaceRecoveryRegions:regions.size,edgeVelocityPixelsPerSecond:2/(start.slope+end.slope),primaryStartSeconds:start.time-(referenceY-lines[0])/v,primaryEndSeconds:end.time-(referenceY-lines[0])/v,offsetSeconds:(referenceY-lines[0])/v}};
   // Existing primary events are anchors, not a requirement to see this exact
   // short body at the primary row. No recovery in isolated empty time ranges.
   if(!existing.some(a=>sameColor(a,n)&&Math.max(a.startSeconds-n.endSeconds,n.startSeconds-a.endSeconds)<=Math.max(3/fps,n.durationSeconds*.75)))continue;
   valid.push(n);
  }
  valid.sort((a,b)=>a.startSeconds-b.startSeconds);
  // Overlapping alternatives are ambiguous and must not create new notes.
  const overlaps=(a,n)=>Math.min(n.endSeconds,a.endSeconds)-Math.max(n.startSeconds,a.startSeconds)>tol*.25;
  const separated=preferSeparatedBodies(valid,fps),strongest=separated.filter((n,i)=>!separated.some((a,j)=>i!==j&&overlaps(a,n)&&a.evidence.surfaceRecoveryRegions>=n.evidence.surfaceRecoveryRegions+2&&a.evidence.surfaceRecoveryRows>=n.evidence.surfaceRecoveryRows*1.5));
  const unambiguous=strongest.filter((n,i)=>!strongest.some((a,j)=>i!==j&&overlaps(a,n)));
  for(const a of existing){const covered=unambiguous.filter(n=>sameColor(a,n)&&Math.min(a.endSeconds,n.endSeconds)-Math.max(a.startSeconds,n.startSeconds)>.5*Math.min(a.durationSeconds,n.durationSeconds));if(covered.length>=2&&Math.abs(covered[0].startSeconds-a.startSeconds)<=2/fps&&Math.abs(covered.at(-1).endSeconds-a.endSeconds)<=2/fps){replacements.set(a,covered);tracks.push(...covered);}}
  for(const n of unambiguous){if([...replacements.values()].some(ns=>ns.includes(n)))continue;
   // Any surviving overlapping primary interval owns the identity. Recovery
   // may fill a missing neighbor, but cannot duplicate or trim that interval.
   if(existing.some(a=>!replacements.has(a)&&Math.min(a.endSeconds,n.endSeconds)>Math.max(a.startSeconds,n.startSeconds)))continue;
   additions.push(n);tracks.push(n);
  }
 }
 return{notes:notes.flatMap(n=>replacements.get(n)||[n]).concat(additions).sort((a,b)=>a.startSeconds-b.startSeconds||a.midiPitch-b.midiPitch),added:additions.length,replaced:replacements.size,tracks};
}

function surfaceBodyTracks(lines,observations,v,{fps,height,referenceY,duration}){const tol=1/fps;const grouped=observations.map(ns=>{const map=new Map();for(const n of ns){if(!map.has(n.midiPitch))map.set(n.midiPitch,[]);map.get(n.midiPitch).push(n);}return map;}),pitches=new Set(grouped.flatMap(g=>[...g.keys()])),out=[];
for(const pitch of pitches){const projected=[];for(let row=0;row<lines.length;row++)for(const b of grouped[row].get(pitch)||[])if(!b.truncatedStart&&!b.truncatedEnd){const shift=(referenceY-lines[row])/v;projected.push({row,y:lines[row],b,s:b.startSeconds+shift,e:b.endSeconds+shift});}projected.sort((a,b)=>a.s-b.s||a.e-b.e);const clusters=[];
for(const p of projected){let best=null,error=Infinity;for(let k=clusters.length-1;k>=0;k--){const c=clusters[k];if(c.s<p.s-2*tol)break;const d=Math.max(Math.abs(c.s-p.s),Math.abs(c.e-p.e));if(d<=tol&&sameBodyHue(c.points[0].b,p.b)&&d<error){best=c;error=d;}}if(!best){best={s:p.s,e:p.e,points:[]};clusters.push(best);}if(!best.points.some(q=>q.row===p.row)){best.points.push(p);best.s=median(best.points.map(q=>q.s));best.e=median(best.points.map(q=>q.e));}}
for(const c of clusters){const ps=c.points,bins=new Set(ps.map(p=>Math.floor(p.y/(height/16))));if(ps.length<8||bins.size<5)continue;const opts={fps,height,referenceY,minSpan:height*.25};const start=robustEdge(ps,'startSeconds',v,opts),end=robustEdge(ps,'endSeconds',v,opts);if(!start||!end||end.time<=start.time||Math.abs(start.slope-end.slope)/start.slope>.08)continue;out.push({...ps[0].b,colorRGB:[0,1,2].map(k=>median(ps.map(p=>p.b.colorRGB[k]))),rawColorRGB:[0,1,2].map(k=>median(ps.map(p=>p.b.colorRGB[k]))),startSeconds:start.time,endSeconds:end.time,durationSeconds:end.time-start.time,evidence:{timingSource:'surface-body-consensus',timingEstimator:'outlier-filtered-height-balanced-mean',verified:true,rows:Math.min(start.rows,end.rows),bins:bins.size,minY:Math.min(...ps.map(p=>p.y)),maxY:Math.max(...ps.map(p=>p.y))}});}
}return out.sort((a,b)=>a.startSeconds-b.startSeconds);}
// Reconcile neighboring notes only when complete moving bodies support both
// sides. Track alternatives are computed before ambiguous overlaps are pruned.
function reconcileAdjacentTracks(notes,tracks,uncertain,fps,offset){
 const tol=Math.max(1/fps,.025),byPitch=new Map(),observed=new Map();
 for(const [list,index] of [[notes,byPitch],[tracks,observed]])for(const n of list){
  if(!index.has(n.midiPitch))index.set(n.midiPitch,[]);
  index.get(n.midiPitch).push(n);
 }
 const changes=new Map(),added=[],duplicates=new Set();
 const strong=t=>t.evidence.rows>=12&&t.evidence.bins>=7;
 const overlap=(a,b)=>Math.min(a.endSeconds,b.endSeconds)-Math.max(a.startSeconds,b.startSeconds);
 const withTiming=(track,original)=>({...track,evidence:{...original?.evidence,...track.evidence,timingSource:'adjacent-body-consensus',primaryStartSeconds:original?.evidence.primaryStartSeconds??track.startSeconds-offset,primaryEndSeconds:original?.evidence.primaryEndSeconds??track.endSeconds-offset,offsetSeconds:original?.evidence.offsetSeconds??offset}});
 for(const [pitch,bodies] of observed){
  const existing=byPitch.get(pitch)||[];
  const whiteNeighbors=[...(byPitch.get(pitch-1)||[]),...(byPitch.get(pitch+1)||[])].filter(n=>n.laneType==='white'&&n.evidence.verified);
  if(!whiteNeighbors.length)continue;
  const nearStart=(a,b)=>Math.abs(a.startSeconds-b.startSeconds)<=tol;
  for(const body of bodies){
   if(body.laneType!=='black'||!strong(body))continue;
   const sameStart=bodies.filter(t=>t!==body&&strong(t)&&sameBodyHue(body,t)&&nearStart(body,t));
   // One apparent black-key tail ends with the neighboring white note;
   // the shorter, separately observed black body ends when the white begins.
   if(body.durationSeconds>=.05&&body.durationSeconds<=.16){
    const matched=existing.find(n=>sameBodyHue(body,n)&&nearStart(body,n));
    const neighbor=long=>whiteNeighbors.some(n=>
     n.startSeconds>=body.endSeconds-tol*.55&&Math.abs(n.startSeconds-body.endSeconds)<=tol&&
     Math.abs(n.endSeconds-long.endSeconds)<=tol&&long.endSeconds-body.endSeconds>=Math.max(.045,1.5*tol));
    // A primary interval can inherit a neighbor's end even if no long
    // alternative survives the multi-row fit. In that case, require stronger
    // short-body support and no rival fit of its ending.
    const longer=sameStart.find(neighbor);
    const clearShortEnd=body.evidence.rows>=16&&body.evidence.bins>=8&&
     !sameStart.some(t=>Math.abs(t.endSeconds-body.endSeconds)>tol);
    if(matched&&matched.endSeconds-body.endSeconds>=.035&&
     (longer&&Math.abs(longer.endSeconds-matched.endSeconds)<=2*tol||clearShortEnd&&neighbor(matched))){
     const previous=changes.get(matched);
     if(!previous||body.endSeconds<previous.endSeconds)changes.set(matched,withTiming(body,matched));
    }else if(longer&&!matched&&!existing.some(n=>overlap(n,body)>tol*.3)&&
     !added.some(n=>n.midiPitch===pitch&&nearStart(n,body)))added.push(withTiming(body));
   }
   // The sustained body must be visible across heights and no other same-pitch
   // event may claim the extension. An adjacent short body explains the hole.
   if(body.durationSeconds>=.3&&body.evidence.bins>=8&&body.evidence.rows>=24){
    const match=existing.find(n=>sameBodyHue(body,n)&&nearStart(body,n)&&body.endSeconds-n.endSeconds>=.09);
    const adjacentWhite=match&&whiteNeighbors.find(n=>n.durationSeconds<=.25&&
     n.startSeconds<match.endSeconds+tol&&n.endSeconds>match.endSeconds+tol&&n.endSeconds<body.endSeconds-tol);
    if(adjacentWhite&&!existing.some(n=>n!==match&&overlap(n,body)>tol*.25)&&!sameStart.some(t=>t.durationSeconds<body.durationSeconds-.09)){
     changes.set(match,withTiming(body,match));
     const whiteTracks=(observed.get(adjacentWhite.midiPitch)||[]).filter(t=>strong(t)&&
      nearStart(t,adjacentWhite)&&sameBodyHue(t,adjacentWhite)&&t.endSeconds-adjacentWhite.endSeconds>=.05&&
      t.durationSeconds<=.25&&t.endSeconds<body.endSeconds-tol);
     if(whiteTracks.length&&whiteTracks.every(t=>Math.abs(t.endSeconds-whiteTracks[0].endSeconds)<=tol)){
      changes.set(adjacentWhite,withTiming(whiteTracks[0],adjacentWhite));
     }
     const repeat=bodies.find(t=>strong(t)&&t.evidence.rows>=24&&t.startSeconds>=body.endSeconds+tol*.5&&
      t.startSeconds-body.endSeconds<=.12&&sameBodyHue(t,body)&&!existing.some(n=>overlap(n,t)>tol*.25)&&
      uncertain.some(n=>n.midiPitch===pitch&&Math.abs(n.endSeconds-t.endSeconds)<=tol&&overlap(n,t)>.75*t.durationSeconds));
     if(repeat&&!added.some(n=>n.midiPitch===pitch&&nearStart(n,repeat)))added.push(withTiming(repeat));
    }
    // A contained fragment that shares the observed onset is a duplicate,
    // unless a separately moving body supports its own end.
    const complete=existing.find(n=>nearStart(n,body)&&Math.abs(n.endSeconds-body.endSeconds)<=tol&&
     n.evidence.timingSource==='surface-body-consensus');
    if(complete)for(const fragment of existing){
     if(fragment===complete||!sameBodyHue(fragment,complete)||Math.abs(fragment.startSeconds-complete.startSeconds)>tol*.5||
       fragment.endSeconds>complete.endSeconds-.09||fragment.durationSeconds>complete.durationSeconds*.3||
       sameStart.some(t=>Math.abs(t.endSeconds-fragment.endSeconds)<=tol))continue;
     duplicates.add(fragment);
    }
   }
  }
 }
 return {notes:notes.filter(n=>!duplicates.has(n)).map(n=>changes.get(n)||n).concat(added),changed:changes.size+added.length+duplicates.size};
}

function auditSurfaceBodies(notes,lines,observations,v,opts,appearance,groups,localGaps,seamIndex){
 const {fps,height,referenceY,duration}=opts,tol=1/fps,overlap=(a,b)=>Math.min(a.endSeconds,b.endSeconds)-Math.max(a.startSeconds,b.startSeconds);
 let tracks=preferSeparatedBodies(surfaceBodyTracks(lines,observations,v,opts),fps);
 const adjacentTracks=tracks.filter(n=>!appearance(n));
 tracks=tracks.filter((n,i)=>!tracks.some((a,j)=>i!==j&&a.midiPitch===n.midiPitch&&sameBodyHue(a,n)&&overlap(a,n)>tol/4&&a.evidence.bins>=n.evidence.bins+2&&a.evidence.rows>=n.evidence.rows*1.5));
 tracks=tracks.filter((n,i,all)=>!all.some((a,j)=>i!==j&&a.midiPitch===n.midiPitch&&sameBodyHue(a,n)&&overlap(a,n)>tol/4));
 // Exclude a consistently dim/desaturated edge using same-video body colors.
 tracks=tracks.filter(n=>!appearance(n));
 const strong=n=>n.evidence.timingSource==='local-surface-split'&&n.evidence.gapFrames>=2&&n.evidence.matchedLines>=8||n.truncatedStart||n.truncatedEnd&&n.evidence.primaryEndSeconds>=duration||n.evidence.recoveredLeadingEdge||!appearance(n)&&(n.colorSamples>=3&&Math.max(n.evidence.independentStartRegions||0,n.evidence.independentEndRegions||0)>=5||n.evidence.independentStartRows>=8&&n.evidence.independentEndRows>=8&&n.evidence.independentStartRegions>=5&&n.evidence.independentEndRegions>=5||n.evidence.timingSource!=='common-motion'&&(n.evidence.edgeRows>=8||n.evidence.surfaceRows>=8||n.evidence.surfaceRecoveryRows>=12));
 const out=notes.filter(strong),uncertain=[],used=new Set();let repaired=0;
 for(const n of notes){if(strong(n))continue;
  const matches=tracks.filter(t=>t.midiPitch===n.midiPitch&&sameBodyHue(t,n)&&overlap(t,n)>.5*Math.min(t.durationSeconds,n.durationSeconds)&&Math.min(Math.abs(t.startSeconds-n.startSeconds),Math.abs(t.endSeconds-n.endSeconds))<=2/fps);
  if(matches.length===1){const t=matches[0];
   if(!used.has(t)&&!out.some(a=>a.midiPitch===t.midiPitch&&sameBodyHue(a,t)&&Math.max(Math.abs(a.startSeconds-t.startSeconds),Math.abs(a.endSeconds-t.endSeconds))<tol)){
    out.push({...t,evidence:{...n.evidence,...t.evidence,surfaceBodyRows:t.evidence.rows,surfaceBodyRegions:t.evidence.bins,primaryStartSeconds:n.evidence.primaryStartSeconds,primaryEndSeconds:n.evidence.primaryEndSeconds,offsetSeconds:t.startSeconds-n.evidence.primaryStartSeconds,previousStartSeconds:n.startSeconds,previousEndSeconds:n.endSeconds}});used.add(t);repaired++;
   }
  }else if(matches.length>1||n.truncatedStart){out.push(n);}
  else{
   const available=lines.filter(y=>n.startSeconds-(referenceY-y)/v>=0&&n.endSeconds-(referenceY-y)/v<=duration);
   if(available.length<8||Math.max(...available)-Math.min(...available)<height*.25){out.push(n);continue;}
   uncertain.push({...n,evidence:{...n.evidence,verified:false,rejectionReason:appearance(n)?'short-without-note-body-appearance':'without-separated-body-track'}});
  }
 }
 // Close to the strike line, a long body can appear as several overexposed
 // primary fragments. Prefer the full upstream track when its independent
 // edges agree across the roll and the primary fragments support its onset.
 let sustainedRecovered=0;
 if(referenceY-lines[0]<=height*.05){
  for(const track of tracks){
   if(track.durationSeconds<1||track.evidence.rows<20||track.evidence.bins<8||
    track.startSeconds<0||track.endSeconds>duration||
    out.some(n=>n.midiPitch===track.midiPitch&&overlap(n,track)>tol))continue;
   const fragments=uncertain.filter(n=>n.midiPitch===track.midiPitch&&
    n.startSeconds>=track.startSeconds-2*tol&&n.endSeconds<=track.endSeconds+2*tol&&overlap(n,track)>tol);
   if(fragments.length<2||!fragments.some(n=>Math.abs(n.startSeconds-track.startSeconds)<=2*tol)||
    fragments.reduce((sum,n)=>sum+overlap(n,track),0)<track.durationSeconds*.25)continue;
   out.push({...track,evidence:{...track.evidence,timingSource:'upstream-sustained-body',
    primaryStartSeconds:fragments[0].evidence.primaryStartSeconds,
    primaryEndSeconds:fragments.at(-1).evidence.primaryEndSeconds,
    offsetSeconds:track.startSeconds-fragments[0].evidence.primaryStartSeconds}});
   for(const n of fragments)uncertain.splice(uncertain.indexOf(n),1);
   sustainedRecovered++;
  }
 }
 // A strict upstream fit may find the exposed tail of an occluded white
 // note after its primary fragment was rejected. Try it only as an extension
 // of an existing body, and only commit it if continuous rows confirm the join.
 let joined=out;
 if(referenceY-lines[0]<=height*.05){
  const exposedTails=tracks.filter(t=>t.laneType==='white'&&t.durationSeconds>=.25&&t.evidence.rows>=16&&t.evidence.bins>=7&&
   out.some(n=>n.midiPitch===t.midiPitch&&sameBodyHue(n,t)&&Math.abs(t.startSeconds-n.endSeconds)<=2*tol)&&
   !out.some(n=>n.midiPitch===t.midiPitch&&overlap(n,t)>tol));
  if(exposedTails.length){
   const outputLines=[referenceY,...lines.slice(1)];
   const repaired=healTails([...out,...exposedTails],outputLines,groups,v,localGaps,{fps,height,referenceY,allowOverlap:true});
   joined=out.map(n=>repaired.primary.find(a=>a.midiPitch===n.midiPitch&&a.startSeconds===n.startSeconds&&
    a.endSeconds>n.endSeconds&&exposedTails.some(t=>t.midiPitch===n.midiPitch&&t.endSeconds===a.endSeconds)&&
    !out.some(b=>b!==n&&b.midiPitch===n.midiPitch&&b.startSeconds>=n.endSeconds&&b.startSeconds<a.endSeconds))||n);
  }
 }
 const adjacent=reconcileAdjacentTracks(joined,adjacentTracks,uncertain,fps,(referenceY-lines[0])/v);
 const confirmed=removeSurfaceFragments(adjacent.notes,tracks,fps);
 const recoveredRepeats=restoreSeamedBodies(confirmed,notes,tracks,seamIndex,v,opts);

 return{notes:recoveredRepeats.sort((a,b)=>a.startSeconds-b.startSeconds||a.midiPitch-b.midiPitch),uncertain,repaired,sustainedRecovered,tracks:tracks.length,adjacentRepaired:adjacent.changed};
}

// A noisy primary row can merge a repeat chain with its neighbors. Retain
// an independently tracked chain when its moving seams confirm the body.
function restoreSeamedBodies(confirmed,primary,tracks,seamIndex,v,{fps}){
 if(!seamIndex.size)return confirmed;
 const byPitch=new Map();
 for(const n of primary){
  if(n.durationSeconds<.25)continue;
  if(!byPitch.has(n.midiPitch))byPitch.set(n.midiPitch,[]);
  byPitch.get(n.midiPitch).push(n);
 }
 const result=confirmed.slice(),tolerance=2/fps;
 for(const track of tracks){
  if(track.durationSeconds<.25||track.evidence.rows<30||track.evidence.bins<8||!seamIndex.has(track.midiPitch))continue;
  const covers=(parent)=>parent.startSeconds<=track.startSeconds+.02&&track.startSeconds-parent.startSeconds<.14&&
   parent.endSeconds>=track.endSeconds-tolerance&&sameBodyHue(parent,track);
  const hasPrimary=(byPitch.get(track.midiPitch)||[]).some(covers);
  const indices=[];
  for(let i=0;i<result.length;i++){
   const n=result[i];
   if(n.midiPitch===track.midiPitch&&n.startSeconds<track.endSeconds&&n.endSeconds>track.startSeconds)indices.push(i);
  }
  const existing=result[indices[0]];
  const repair=hasPrimary&&indices.length===1&&covers(existing)&&!existing.evidence.independentStartRows&&
   track.startSeconds-existing.startSeconds>1/fps&&Math.abs(track.endSeconds-existing.endSeconds)<=tolerance;
  const replacement={...track,evidence:{...track.evidence,timingSource:'upstream-repeat-body'}};
  if(!indices.length&&!hasPrimary)continue;
  let tail;
  if(indices.length&&!repair){
   // A flare can fill the gap after a repeat chain. Replace the merged
   // interval only when a second full body explains its remaining tail.
   if(indices.length!==1||!sameBodyHue(existing,track)||existing.endSeconds<track.endSeconds||
    Math.abs(existing.startSeconds-track.startSeconds)>Math.max(tolerance,.05))continue;
   const tailTolerance=Math.max(tolerance,.1);
   const tails=tracks.filter(n=>n.midiPitch===track.midiPitch&&sameBodyHue(n,track)&&
    n.evidence.rows>=24&&n.evidence.bins>=8&&
    n.startSeconds-track.endSeconds>=.5/fps&&n.startSeconds-track.endSeconds<=tailTolerance&&
    n.endSeconds<=existing.endSeconds+tolerance&&Math.abs(n.endSeconds-existing.endSeconds)<=tailTolerance);
   if(tails.length!==1||result.some(n=>n!==existing&&n.midiPitch===track.midiPitch&&
    n.startSeconds<tails[0].endSeconds&&n.endSeconds>track.startSeconds))continue;
   tail=tails[0];
  }
  if(splitChromaSeams([track],seamIndex,v,{fps}).length<3)continue;
  if(indices.length)result[indices[0]]=replacement;
  else result.push(replacement);
  if(tail)result.push(tail);
 }
 return result;
}

// A full moving body can account for two candidates created by the primary
// line. Use its independent edges to keep one event through later overlap resolution.
function removeSurfaceFragments(notes,tracks,fps){
 const tolerance=1/fps,byPitch=new Map(),discarded=new Set(),repairs=new Map();
 for(const n of notes){if(!byPitch.has(n.midiPitch))byPitch.set(n.midiPitch,[]);byPitch.get(n.midiPitch).push(n);}
 for(const list of byPitch.values())list.sort((a,b)=>a.startSeconds-b.startSeconds||b.endSeconds-a.endSeconds);
 for(const track of tracks){
  if(track.evidence.rows<24||track.evidence.bins<8)continue;
  const list=byPitch.get(track.midiPitch)||[];
  for(let i=lowerBound(list,track.startSeconds-tolerance);i+1<list.length&&list[i].startSeconds<=track.startSeconds+tolerance;i++){
   const first=list[i],second=list[i+1];
   if(discarded.has(first)||discarded.has(second)||repairs.has(first)||repairs.has(second)||
    !sameBodyHue(first,track)||!sameBodyHue(second,track))continue;
   const duplicate=first.evidence.timingSource==='surface-repaired'&&second.evidence.timingSource==='surface-repaired'&&
    second.startSeconds-first.startSeconds<=tolerance*.25&&second.endSeconds<=first.endSeconds&&
    Math.abs(second.endSeconds-first.endSeconds)<=tolerance;
   if(duplicate){discarded.add(second);continue;}
   if(first.evidence.timingSource!=='local-surface-split'||second.evidence.timingSource!=='local-surface-split'||
    first.evidence.primaryStartSeconds!==second.evidence.primaryStartSeconds||first.durationSeconds>tolerance*.5||
    second.startSeconds-first.endSeconds>1.5*tolerance||Math.abs(second.endSeconds-track.endSeconds)>tolerance||
    track.endSeconds-second.startSeconds<second.durationSeconds*.6||track.startSeconds>=second.startSeconds||
    (i>0&&list[i-1].endSeconds>track.startSeconds))continue;
   discarded.add(first);
   const startSeconds=Math.max(first.startSeconds,track.startSeconds);
   repairs.set(second,{...second,startSeconds,durationSeconds:second.endSeconds-startSeconds,
    evidence:{...second.evidence,...track.evidence,timingSource:'surface-fragment-repair'}});
  }
 }
 return notes.filter(n=>!discarded.has(n)).map(n=>repairs.get(n)||n);
}

function fuse(lines,observations,{fps,duration,height,referenceY=lines.at(-1),localGaps=[],colorOverlays=[],seams=[],fallbackRow=null}){
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
   if(matches>=8&&maxY-minY>=height*.25){const mean=points.reduce((n,p)=>n+p[0],0)/points.length,den=points.reduce((n,p)=>n+(p[0]-mean)**2,0),slope=points.reduce((n,p)=>n+(p[0]-mean)*(p[1]+p[2])*.5,0)/den;const regions=new Set(points.map(p=>Math.floor(p[0]/(height/16)))).size;if(regions>=5)scored.push({v,fit:1/slope,matches,regions,error:error/matches});}
  }
  scored.sort((a,b)=>b.regions-a.regions||a.error-b.error||b.matches-a.matches);const best=scored[0];if(!best)continue;
  const rival=scored.find(s=>Math.abs(s.v-best.v)/best.v>.12);
  if(rival&&rival.regions>=best.regions*.85)continue;
  votes.push({v:best.fit,primary:a,support:best.matches});
 }
 const speed=median(votes.map(v=>v.v)),inliers=speed?votes.filter(v=>Math.abs(v.v-speed)/speed<=.08):[];
 const supported=inliers.length>=3&&inliers.length>=votes.length*.85;
 if(!supported&&fallbackRow!==null&&fallbackRow>0){
  const order=[fallbackRow,...lines.map((_,index)=>index).filter(index=>index!==fallbackRow)];
  const alternate=fuse(order.map(i=>lines[i]),order.map(i=>observations[i]),
   {fps,duration,height,referenceY,localGaps,colorOverlays:order.map(i=>colorOverlays[i]||[]),seams});
  if(alternate.diagnostics.calibrated){
   alternate.diagnostics.requestedPrimaryY=lines[0];
   alternate.diagnostics.primaryFallback='upper-motion-calibration';
   return alternate;
  }
 }
 // A common shift preserves every primary pitch, color, duration and ordering.
 // Only well-supported dense tracks may override the common delay; never add/delete notes.
 const delay=supported?(referenceY-lines[0])/median(inliers.map(v=>v.v)):0,byPrimary=new Map((supported?inliers:votes).map(v=>[v.primary,v]));
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
 if(supported){
  const commonV=median(inliers.map(v=>v.v)),edgeSpeeds=new Map();for(const n of notes){const v=n.evidence.edgeVelocityPixelsPerSecond;if(v>0&&Math.abs(v-commonV)/commonV<=.08)edgeSpeeds.set(n.midiPitch+':'+n.evidence.primaryStartSeconds,v);}
  const v=edgeSpeeds.size>=3?median([...edgeSpeeds.values()]):commonV,outputLines=lines.slice();outputLines[0]=referenceY;diagnostics.boundaryVelocityPixelsPerSecond=v;
  const joined=healTails(notes,outputLines,groups,v,localGaps,{fps,height,referenceY,allowOverlap:true});
  notes=joined.primary.map(n=>n.evidence?.postSurfaceJoin?{...n,evidence:{...n.evidence,joinedParts:n.surfaceJoinedParts,joinRows:n.surfaceJoinRows,postSurfaceJoin:true}}:n);
  diagnostics.postSurfaceTailJoins=joined.joined;diagnostics.postSurfaceTailJoined=joined.joined.length;
  const independent=refineIndependent(notes,lines,groups,v,{fps,height,referenceY,duration});notes=independent.notes;
  diagnostics.independentStartAveraged=independent.startCount;diagnostics.independentEndAveraged=independent.endCount;diagnostics.overlapRepairsBlocked=independent.blocked;
 }else{diagnostics.postSurfaceTailJoins=[];diagnostics.postSurfaceTailJoined=0;diagnostics.independentStartAveraged=0;diagnostics.independentEndAveraged=0;diagnostics.overlapRepairsBlocked=0;}
 diagnostics.surfaceAveragedNotes=notes.filter(n=>n.evidence.timingEstimator==='outlier-filtered-height-balanced-mean').length;
 diagnostics.timingReference=notes.every(n=>n.evidence.verified)?'keyboard-line-estimated':notes.some(n=>n.evidence.verified)?'mixed-unconfirmed':'upper-line';diagnostics.correctedCandidates=notes.filter(n=>n.evidence.verified).length;diagnostics.unconfirmed=notes.filter(n=>!n.evidence.verified).length;diagnostics.offsetRangeSeconds=notes.length?notes.reduce((r,n)=>[Math.min(r[0],n.evidence.offsetSeconds),Math.max(r[1],n.evidence.offsetSeconds)],[Infinity,-Infinity]):[0,0];diagnostics.warning=diagnostics.unconfirmed?'時刻未補正の候補を保持しています。同期補正・個別確認が必要です。':'複数の高さで開始・終了の軌跡が一致した候補の時刻を補正しました。原音との同期は別途確認してください。';

 if(supported){const restored=recoverSurfaceRepeats(notes,lines,groups,diagnostics.boundaryVelocityPixelsPerSecond||median(inliers.map(x=>x.v)),{fps,height,referenceY,duration});notes=restored.notes;diagnostics.surfaceRepeatAdded=restored.added;diagnostics.surfaceRepeatReplaced=restored.replaced;diagnostics.surfaceRepeatTracks=restored.tracks;}
 // A moving timing fit is insufficient when every observation is only a dim,
 // desaturated background tint. Learn body appearance from this same scan.
 const appearanceCache=new Map();const bodyAppearance=n=>{
  const cacheKey=n.laneType+':'+Math.round((()=>{const c=n.colorRGB,hi=Math.max(...c),lo=Math.min(...c),d=hi-lo;if(!d)return 0;return ((hi===c[0]?(c[1]-c[2])/d:hi===c[1]?2+(c[2]-c[0])/d:4+(c[0]-c[1])/d)*60+360)%360;})());
  let reference=appearanceCache.get(cacheKey);if(reference===undefined){const refs=primary.filter(a=>a.durationSeconds>=2/30&&!a.truncatedStart&&!a.truncatedEnd&&a.laneType===n.laneType&&sameBodyHue(a,n));
  reference=refs.length<6?null:{value:median(refs.map(a=>Math.max(...a.colorRGB))),chroma:median(refs.map(a=>Math.max(...a.colorRGB)-Math.min(...a.colorRGB)))};appearanceCache.set(cacheKey,reference);}
  if(!reference)return null;const {value,chroma}=reference;
  const c=n.rawColorRGB||n.colorRGB;
  if(n.colorSamples>=3&&Math.max(...n.colorRGB)>=value*.6&&Math.max(...n.colorRGB)-Math.min(...n.colorRGB)>=chroma*.5)return null;
  if(Math.max(...c)>=value*.45||Math.max(...c)-Math.min(...c)>=chroma*.35)return null;
  if(n.evidence.independentStartRegions>=6&&n.evidence.independentEndRegions>=6&&supported){
   const v=diagnostics.boundaryVelocityPixelsPerSecond,regions=new Set();
   for(let i=1;i<lines.length;i++){
    const shift=(referenceY-lines[i])/v,list=groups[i].get(n.midiPitch)||[];
    const tolerance=1.25/fps,first=lowerBound(list,n.startSeconds-shift-tolerance);
    for(let j=first;j<list.length&&list[j].startSeconds<=n.startSeconds-shift+tolerance;j++){
     const b=list[j],color=b.colorRGB,high=Math.max(...color);
     if(!b.truncatedStart&&!b.truncatedEnd&&Math.abs(b.endSeconds+shift-n.endSeconds)<=tolerance&&
      sameBodyHue(b,n)&&high>=value*.6&&high-Math.min(...color)>=chroma*.5){
      regions.add(Math.floor(lines[i]/(height/16)));
     }
    }
    if(regions.size>=4)return null;
   }
  }
  return {value,chroma};
 };
 // A short event needs a moving body supported at separated heights.
 const uncertain=[];
 const seamVelocity=diagnostics.boundaryVelocityPixelsPerSecond;
 const seamIndex=supported&&seams.length?indexChromaSeams(seams,seamVelocity,referenceY):new Map();
 if(supported){const audited=auditSurfaceBodies(notes,lines,observations,diagnostics.boundaryVelocityPixelsPerSecond||median(inliers.map(x=>x.v)),{fps,height,referenceY,duration},bodyAppearance,groups,localGaps,seamIndex);notes=audited.notes;uncertain.push(...audited.uncertain);diagnostics.surfaceBodyRejected=audited.uncertain.length;diagnostics.surfaceBodyRepaired=audited.repaired;diagnostics.upstreamSustainedRecovered=audited.sustainedRecovered;diagnostics.surfaceBodyTracks=audited.tracks;diagnostics.adjacentBodyRepairs=audited.adjacentRepaired;}
 if(supported){
 const notePitches=new Map();
 for(const note of notes){if(!notePitches.has(note.midiPitch))notePitches.set(note.midiPitch,[]);notePitches.get(note.midiPitch).push(note);}
 notes=notes.filter(n=>{
  if(n.startSeconds>=duration){uncertain.push({...n,evidence:{...n.evidence,verified:false,rejectionReason:'outside-video'}});return false;}
  if(n.durationSeconds>=2/30||n.truncatedStart||n.truncatedEnd)return true;
  const v=diagnostics.boundaryVelocityPixelsPerSecond||median(inliers.map(x=>x.v)),starts=[],ends=[];let opportunities=0;
  const tol=1/fps,fullBody=[];
  const nearSemitone=[-1,1].some(step=>{
   const nearby=notePitches.get(n.midiPitch+step)||[],i=lowerBound(nearby,n.startSeconds-.25-tol);
   for(let j=i;j<nearby.length&&nearby[j].startSeconds<=n.endSeconds+tol;j++){
    const a=nearby[j];
    if(a.evidence.verified&&a.laneType!==n.laneType&&a.durationSeconds>=n.durationSeconds*1.5&&a.durationSeconds<=.25&&
     a.startSeconds<n.endSeconds+tol*.5&&a.endSeconds>n.startSeconds-tol*.5&&sameBodyHue(n,a))return true;
   }
   return false;
  });
  const expectedOccupancy=Math.min(1,n.durationSeconds*fps),appearance=bodyAppearance(n),bodyRows=[];
  const strongFit=Math.max(n.evidence.surfaceRows||0,n.evidence.surfaceBodyRows||0,n.evidence.surfaceRecoveryRows||0,n.evidence.timingSource==='surface-split'?n.evidence.edgeRows||0:0)>=24;
  for(let i=1;i<lines.length;i++){const shift=(referenceY-lines[i])/v;
   if(n.startSeconds-shift<0||n.endSeconds-shift>duration)continue;opportunities++;
   if(appearance&&(groups[i].get(n.midiPitch)||[]).some(b=>sameBodyHue(n,b)&&!b.truncatedStart&&!b.truncatedEnd&&Math.abs(b.startSeconds+shift-n.startSeconds)<=tol&&Math.abs(b.endSeconds+shift-n.endSeconds)<=tol&&Math.max(...b.colorRGB)>=appearance.value*.6&&Math.max(...b.colorRGB)-Math.min(...b.colorRGB)>=appearance.chroma*.5))bodyRows.push(lines[i]);
   const same=(groups[i].get(n.midiPitch)||[]).filter(b=>(bodyDistance(n,b)<65||
    strongFit&&(sameBodyHue(b,n)||sameBodyHue(b,{colorRGB:n.rawColorRGB||n.colorRGB})))&&b.startSeconds+shift<n.endSeconds+tol&&b.endSeconds+shift>n.startSeconds-tol);
   if(same.some(b=>!b.truncatedStart&&Math.abs(b.startSeconds+shift-n.startSeconds)<=tol))starts.push(lines[i]);
   if(same.some(b=>!b.truncatedEnd&&Math.abs(b.endSeconds+shift-n.endSeconds)<=tol))ends.push(lines[i]);
   if(nearSemitone&&same.some(b=>!b.truncatedStart&&!b.truncatedEnd&&Math.abs(b.startSeconds+shift-n.startSeconds)<=tol&&
    Math.abs(b.endSeconds+shift-n.endSeconds)<=tol&&b.durationSeconds<=n.durationSeconds+tol))fullBody.push(lines[i]);
  }
  const required=Math.max(4,Math.ceil(opportunities*expectedOccupancy*.12));
  const supports=ys=>ys.length>=required&&new Set(ys.map(y=>Math.floor(y/(height/16)))).size>=3&&Math.max(...ys)-Math.min(...ys)>=height*.08;
  const ys=[...new Set([...starts,...ends])],bins=new Set(ys.map(y=>Math.floor(y/(height/16))));
  n.evidence={...n.evidence,shortStartRows:starts.length,shortEndRows:ends.length,shortRequiredRows:required,shortObservationOpportunities:opportunities};
  if(appearance&&(bodyRows.length<3||new Set(bodyRows.map(y=>Math.floor(y/(height/16)))).size<2)){
   uncertain.push({...n,evidence:{...n.evidence,verified:false,rejectionReason:'short-without-note-body-appearance',bodyAppearanceRows:bodyRows.length,referenceBodyValue:appearance.value,referenceBodyChroma:appearance.chroma}});return false;
  }
  if(nearSemitone&&opportunities>=12&&(!supports(fullBody)||
   new Set(fullBody.map(y=>Math.floor(y/(height/16)))).size<5||Math.max(...fullBody)-Math.min(...fullBody)<height*.22)){
   uncertain.push({...n,evidence:{...n.evidence,verified:false,rejectionReason:'short-without-independent-adjacent-body',supportRows:fullBody.length}});return false;
  }
  if(supports(starts)&&supports(ends))return true;
  uncertain.push({...n,evidence:{...n.evidence,verified:false,rejectionReason:'short-without-separated-motion',supportRows:ys.length,supportRegions:bins.size}});return false;
 });}
 // Restore a distinct color observed moving inside a stable held note.
 let recoveredColorOverlays=0;
 if(supported&&colorOverlays.some(row=>row.length)){
  const v=diagnostics.boundaryVelocityPixelsPerSecond||median(inliers.map(x=>x.v));
  const tracks=surfaceBodyTracks(lines,colorOverlays,v,{fps,height,referenceY,duration});
  for(const track of tracks){
   if(track.startSeconds<0||track.endSeconds>duration||
    !notes.some(n=>n.midiPitch===track.midiPitch&&n.startSeconds<track.startSeconds-1/fps&&
     n.endSeconds>track.endSeconds+1/fps&&!sameBodyHue(n,track))||
    notes.some(n=>n.midiPitch===track.midiPitch&&n.startSeconds<track.endSeconds&&
     n.endSeconds>track.startSeconds&&sameBodyHue(n,track)))continue;
   notes.push({...track,evidence:{...track.evidence,timingSource:'same-key-color-overlay',
    primaryStartSeconds:track.startSeconds-delay,primaryEndSeconds:track.endSeconds-delay,offsetSeconds:delay}});
   recoveredColorOverlays++;
  }
  notes.sort((a,b)=>a.startSeconds-b.startSeconds||a.midiPitch-b.midiPitch);
 }
 if(seamIndex.size){
  const count=notes.length;
  notes=splitChromaSeams(notes,seamIndex,seamVelocity,{fps})
   .sort((a,b)=>a.startSeconds-b.startSeconds||a.midiPitch-b.midiPitch);
  notes=splitChromaSeams(notes,seamIndex,seamVelocity,{fps},true)
   .sort((a,b)=>a.startSeconds-b.startSeconds||a.midiPitch-b.midiPitch);
  diagnostics.chromaSeamSplits=notes.length-count;
 }
 diagnostics.recoveredColorOverlays=recoveredColorOverlays;
 diagnostics.shortUnconfirmed=uncertain.length;
 return{notes,unconfirmedNotes:uncertain,diagnostics};
}
// Missing bright/distorted pixels are unknown, never positive note evidence.
// Keep at most 150 ms and bridge only after the same body is seen again.
class OcclusionTracker {
 constructor(options,lanes,width){this.inner=new core.Tracker({...options,minimumSamples:1,observeColorOverlays:true});this.fps=options.fps;this.lanes=lanes;this.width=width;this.queue=[];this.active=new Map();this.bridged=0;}
 push(time,hits,raw){
  const present=new Map(hits.map(h=>[h.pitch,h])),foreign=core.foreignBodyPitches(hits),frame={time,hits:hits.slice(),unknown:new Set()};
  for(const [pitch,last] of this.active){
   const hit=present.get(pitch);
   if(hit){if(bodyDistance(last.hit,hit)<40&&time-last.time<=.15){for(const f of this.queue)if(f.unknown.has(pitch)){f.hits.push(last.hit);f.unknown.delete(pitch);this.bridged++;}}this.active.set(pitch,{hit,time});continue;}
   const l=this.lanes.get(pitch),i=l?Math.round(l.x)*4:-1,c=raw&&i>=0?[raw[i],raw[i+1],raw[i+2]]:null,lum=x=>.2126*x[0]+.7152*x[1]+.0722*x[2];
   // A dark, empty lane is negative evidence; a bright changed body is ambiguous.
   if(!foreign?.has(pitch)&&c&&time-last.time<=.15&&lum(c)>=Math.max(85,lum(last.hit.colorRGB)*.9)&&Math.hypot(...c.map((v,k)=>v-last.hit.colorRGB[k]))>48){frame.unknown.add(pitch);}else this.active.delete(pitch);
  }
  for(const hit of hits)this.active.set(hit.pitch,{hit,time});
  this.queue.push(frame);while(this.queue.length&&time-this.queue[0].time>=.15){const f=this.queue.shift();this.inner.push(f.time,f.hits);}
 }
 finish(){for(const f of this.queue)this.inner.push(f.time,f.hits);this.queue=[];const notes=this.inner.finish();this.discarded=this.inner.discarded;return notes;}
}
// Read a few upstream rows already in the image band. Align their raw
// lane-center colors with the measured scroll speed so a transient flare in
// one row cannot mask a body, or create an onset, across the whole band.
function createBodyProjection(lines,lanes,referenceY,width,fps,duration){
 const frameCount=Math.ceil(duration*fps)+2;
 const rowLimit=Math.min(18,Math.floor(12_000_000/(frameCount*lanes.length)));
 if(rowLimit<8)return null;
 const safe=lines.map((y,i)=>({y,i})).filter(r=>r.y>=referenceY*.06&&r.y<=referenceY*.61).sort((a,b)=>a.y-b.y);
 if(safe.length<8||safe.at(-1).y-safe[0].y<36)return null;
 const rows=new Array(Math.min(rowLimit,safe.length));
 for(let i=0;i<rows.length;i++)rows[i]=safe[Math.round(i*(safe.length-1)/(rows.length-1))];
 const stride=lanes.length*rows.length,frames=new Uint16Array(frameCount*stride),present=new Uint8Array(frameCount);
 // Two bits per cell record whether the colored body reaches each shoulder.
 const shoulders=new Uint8Array(Math.ceil(frames.length/4));
 const shoulderOffsets=lanes.map(l=>Math.max(2,Math.round(l.w*.36))*4);
 const chromaAt=(row,x)=>Math.max(row[x],row[x+1],row[x+2])-Math.min(row[x],row[x+1],row[x+2]);
 const centers=lanes.map(l=>clamp(Math.round(l.x),1,width-2)*4);
 let last=-1;
 return {push(time,rawRows){
  const f=Math.round(time*fps);
  if(f<0||f>=frameCount)return;
  present[f]=1;
  last=Math.max(last,f);
  for(let j=0;j<rows.length;j++){
   const raw=rawRows[rows[j].i],base=f*stride+j*centers.length;
   for(let k=0;k<centers.length;k++){
    const x=centers[k];
    const r=(raw[x-4]+raw[x]+raw[x+4])/3,g=(raw[x-3]+raw[x+1]+raw[x+5])/3,b=(raw[x-2]+raw[x+2]+raw[x+6])/3;
    const index=base+k,offset=shoulderOffsets[k],margin=Math.max(45,(Math.max(r,g,b)-Math.min(r,g,b))*.56);
    frames[index]=((r&248)<<8)|((g&252)<<3)|(b>>3);
    const flags=(x>=offset&&chromaAt(raw,x-offset)>=margin?1:0)|
     (x+offset<raw.length&&chromaAt(raw,x+offset)>=margin?2:0);
    const shift=(index&3)*2;
    shoulders[index>>2]=(shoulders[index>>2]&~(3<<shift))|(flags<<shift);
   }
  }
 },repair(notes,v){
  if(last<1||!v||v<10)return {notes,added:0,split:0};
  const hz=120,ticks=Math.ceil(duration*hz),chroma=new Uint8Array(ticks),colors=new Uint16Array(ticks);
  const offsets=rows.map(row=>(referenceY-row.y)*fps/v);
  const lut=new Uint8Array(65536);
  const rgb=p=>[(p>>11)*255/31,((p>>5)&63)*255/63,(p&31)*255/31].map(Math.round);
  for(let i=0;i<lut.length;i++){
   const c=rgb(i);lut[i]=Math.max(...c)-Math.min(...c);
  }
  const byPitch=new Map();
  for(const note of notes){
   if(!byPitch.has(note.midiPitch))byPitch.set(note.midiPitch,[]);
   byPitch.get(note.midiPitch).push(note);
  }
  const samples=new Uint16Array(rows.length);
  const additions=[],splits=new Map();
  // On the side facing away from an overlapping neighbor, a true body
  // should still be visible across several heights and interior times.
  const hasOuterBody=(laneIndex,flag,start,end)=>{
   let supported=0;
   for(const fraction of [.35,.5,.65]){
    const time=(start+(end-start)*fraction)*fps;
    let count=0,total=0;
    for(let j=0;j<offsets.length;j++){
     const f=Math.round(time-offsets[j]);
     if(f<0||f>last||!present[f])continue;
     const index=f*stride+j*lanes.length+laneIndex;
     if((shoulders[index>>2]>>((index&3)*2))&flag)count++;
     total++;
    }
    if(total>=8&&count>=Math.ceil(total*.6))supported++;
   }
   return supported>=2;
  };
  for(let k=0;k<lanes.length;k++){
   const lane=lanes[k],existing=byPitch.get(lane.pitch);
   if(!existing?.length)continue;
   chroma.fill(0);
   const nearby=new Uint8Array(ticks),observed=new Uint8Array(ticks);
   for(const note of existing){
    nearby.fill(1,Math.max(0,Math.floor((note.startSeconds-.6)*hz)),Math.min(ticks,Math.ceil((note.endSeconds+.6)*hz)));
   }
   for(let i=0;i<ticks;i++){
    if(!nearby[i])continue;
    let count=0;
    const t=i*fps/hz;
    for(let j=0;j<offsets.length;j++){
     const exact=t-offsets[j],f=Math.floor(exact);
     if(f<0||f>=last||!present[f]||!present[f+1])continue;
     const at=f*stride+j*lanes.length+k,first=frames[at],second=frames[at+stride];
     const score=Math.round(lut[first]+(lut[second]-lut[first])*(exact-f));
     // Sort by chroma and carry the source row index for its color.
     samples[count++]=(score<<5)|j;
    }
    if(count<Math.max(8,rows.length*.6))continue;
    const sorted=samples.subarray(0,count);sorted.sort();
    const mid=sorted[count>>1],j=mid&31,f=Math.round(t-offsets[j]);
    observed[i]=1;chroma[i]=mid>>5;colors[i]=frames[f*stride+j*lanes.length+k];
   }
   let start=0,previousBody=null;
   while(start<ticks){
    if(chroma[start]<76){start++;continue;}
    let end=start+1,peak=start;
    while(end<ticks&&chroma[end]>=76){if(chroma[end]>chroma[peak])peak=end;end++;}
    const s=start/hz,e=end/hz,color=rgb(colors[peak]);
    if(end-start>=7&&chroma[peak]>=120){
     const body={start:s,end:e,endTick:end,peak:chroma[peak],colorRGB:color};
     const gapLength=previousBody?start-previousBody.endTick:0;
     if(gapLength>=3&&gapLength<=12){
      let trough=255,visible=true;
      for(let i=previousBody.endTick;i<start;i++){
       visible=visible&&Boolean(observed[i]);
       trough=Math.min(trough,chroma[i]);
      }
      // A short, deep gap across the upstream rows can disappear near impact.
      // Require both complete bodies to explain an existing merged interval.
      if(visible&&trough<=.36*Math.min(previousBody.peak,body.peak)&&sameBodyHue(previousBody,body)){
       const parent=existing.find(n=>!n.truncatedStart&&!n.truncatedEnd&&!splits.has(n)&&!(n.evidence.splitParts>1)&&
        n.durationSeconds>=.5&&Math.abs(n.startSeconds-previousBody.start)<=.055&&Math.abs(n.endSeconds-body.end)<=.055&&
        n.endSeconds-body.start>=.05&&sameBodyHue(n,body));
       if(parent&&!existing.some(n=>n!==parent&&sameBodyHue(n,body)&&
        Math.min(n.endSeconds,body.end)-Math.max(n.startSeconds,previousBody.start)>.025)){
        splits.set(parent,[previousBody,body].map((part,i)=>{
         const startSeconds=part.start,endSeconds=i?parent.endSeconds:part.end;
         return {...parent,startSeconds,endSeconds,durationSeconds:endSeconds-startSeconds,
          evidence:{...parent.evidence,timingSource:'upstream-color-split',splitParts:2,verified:true}};
        }));
       }
      }
     }
     previousBody=body;
    }
    if(end-start>=7&&end-start<=31&&chroma[peak]>=120){
     const overlapping=existing.some(n=>n.startSeconds<e-.017&&n.endSeconds>s+.017);
     const anchor=existing.find(n=>Math.min(Math.abs(n.startSeconds-s),Math.abs(n.endSeconds-e))<=.6&&sameBodyHue(n,{colorRGB:color}));
     if(!overlapping&&anchor&&!existing.some(n=>Math.abs(n.startSeconds-s)<.055)){
      const leaking=[-1,1].some(side=>{
       const neighbor=byPitch.get(lane.pitch+side)||[];
       return neighbor.some(n=>n.evidence.verified&&n.laneType!==lane.type&&
        Math.min(n.endSeconds,e)-Math.max(n.startSeconds,s)>=(e-s)*.75&&
        sameBodyHue(n,{colorRGB:color}))&&!hasOuterBody(k,side>0?1:2,s,e);
      });
      if(leaking){start=end;continue;}
      additions.push({...anchor,startSeconds:s,endSeconds:e,durationSeconds:e-s,colorRGB:color,rawColorRGB:color,
       observationSamples:0,colorSamples:1,truncatedStart:false,truncatedEnd:false,
       evidence:{timingSource:'upstream-color-profile',verified:true}});
     }
    }
    start=end;
   }
  }
  return {notes:notes.flatMap(note=>splits.get(note)||[note]).concat(additions)
   .sort((a,b)=>a.startSeconds-b.startSeconds||a.midiPitch-b.midiPitch),added:additions.length,split:splits.size};
 }};
}

function createScan({width,height,hitLineY,lanes,fps,duration,mode='single',primaryPercent=20,textOverlay=null}){
 const localGaps=[],seams=[],laneCenters=new Map(lanes.map(l=>[l.pitch,clamp(Math.round(l.x),0,width-1)*4]));
 const baseLines=linePlan(hitLineY,height,mode,primaryPercent);
 const primary=baseLines[0],bottom=Math.min(Math.round(hitLineY)-1,primary+24);
 const denseBand={top:Math.max(0,Math.min(primary-24,bottom-48)),bottom};
 const fallbackRow=mode==='motion'&&hitLineY-primary<height*.17?
  baseLines.reduce((best,y,i)=>Math.abs(y-height*.2)<Math.abs(baseLines[best]-height*.2)?i:best,0):null;
 // When the scan is close to the strike effects, inspect seams in a clean
 // upstream strip as well. The normal tracking rows and read bounds stay fixed.
 const useUpstream=mode==='motion'&&primary>height*.32;
 const seamTop=useUpstream?Math.max(Math.min(...baseLines),Math.round(height*.2)-24):denseBand.top;
 const seamBottom=useUpstream?Math.min(Math.max(...baseLines),seamTop+48):denseBand.bottom;
 const seamLines=mode==='motion'&&seamBottom>=seamTop?
  Array.from({length:seamBottom-seamTop+1},(_,i)=>seamTop+i):[];
 const guardLines=textCore?.validationLines(baseLines,textOverlay)||baseLines;
 const lines=[...new Set([...guardLines,...seamLines])],trackers=baseLines.map(()=>mode==='motion'?
  new OcclusionTracker({fps,duration},new Map(lanes.map(l=>[l.pitch,l])),width):new core.Tracker({fps,duration}));
 const detect=core.createRowDetector(width,lanes),textGuard=textCore?.createGuard(guardLines,lanes,textOverlay,{fps});
 const laneRanges=new Map(lanes.map(l=>[l.pitch,{left:Math.max(0,Math.round(l.x-l.w*.45)),right:Math.min(width-1,Math.round(l.x+l.w*.45))}]));
 const pairRanges=new Map(lanes.map(l=>[l.pitch,{left:Math.max(0,Math.round(l.x-l.w*.55)),right:Math.min(width-1,Math.round(l.x+l.w*.55))}]));
 const seamRows=seamLines.map(y=>lines.indexOf(y));
 const projection=mode==='motion'?createBodyProjection(lines,lanes,hitLineY,width,fps,duration):null;
 let lastPairTime=-Infinity;
 return{lines,detect,push(time,rows,rawRows=null,imageTime=time){
  if(rawRows)projection?.push(time,rawRows);
  if(rawRows&&seamRows.length&&seams.length<400000){
   const raw=seamRows.map(i=>rawRows[i]),hits=seamRows.map(i=>rows[i]);
   seams.push(...chromaSeams(raw,hits,laneRanges,time,seamTop));
   if(imageTime>lastPairTime){
    seams.push(...chromaSeams(raw,hits,pairRanges,imageTime,seamTop,true));
    lastPairTime=imageTime;
   }
  }
  textGuard?.observe(time,rows,rawRows);if(mode==='motion'&&localGaps.length<1000000)localGaps.push(...spatialGaps(baseLines,rows.length===baseLines.length?rows:rows.slice(0,baseLines.length),time,baseLines[0],rawRows?.length===baseLines.length?rawRows:rawRows?.slice(0,baseLines.length),laneCenters,denseBand));trackers.forEach((tracker,i)=>tracker.push(time,rows[i],rawRows?.[i]));},finish(){
  const observations=trackers.map((t,i)=>{const ns=t.finish();return textGuard?textGuard.filter(ns,i):ns;}),discarded=trackers[0].discarded;
  if(mode!=='motion')return{notes:observations[0],unconfirmedNotes:[],discarded,diagnostics:{...(textGuard?textGuard.diagnostics():{}),method:mode==='upper'?'upper-single':'single-line',lineYs:baseLines,calibrated:mode==='single',offsetSeconds:0,timingReference:mode==='upper'?'upper-line':'keyboard-line'}};
  const result=fuse(baseLines,observations,{fps,duration,height,referenceY:hitLineY,localGaps,colorOverlays:trackers.map(t=>t.inner.overlays),seams,fallbackRow});if(projection&&result.diagnostics.calibrated){
   const recovered=projection.repair(result.notes,result.diagnostics.boundaryVelocityPixelsPerSecond);
   result.notes=recovered.notes;
   result.diagnostics.profileRecovered=recovered.added;
   result.diagnostics.profileSplit=recovered.split;
  }
  if(textGuard)Object.assign(result.diagnostics,textGuard.diagnostics());result.diagnostics.brightOcclusionBridgedSamples=trackers.reduce((s,t)=>s+(t.bridged||0),0);result.diagnostics.denseBand={...denseBand,rows:denseBand.bottom-denseBand.top+1};result.diagnostics.occlusionRecoveredCandidates=result.notes.filter(n=>n.occlusionRecovered).length;return{...result,discarded};
 }};
}

const api={linePlan,fuse,createScan,normalizePrimaryPercent};if(typeof module==='object'&&module.exports)module.exports=api;else root.PianoRollMotionCore=api;
})(globalThis);
