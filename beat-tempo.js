/* PianoRoll MIDI Converter 0.6.5 — locally adaptive tempo and missing-beat repair.
 * Turns AI beat timestamps into a *candidate* tempo map. It does not fabricate
 * tempo changes when the AI beat sequence itself has no evidence of them.
 * Compatible with browser and Node.js regression tests.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.PianoRollTempoGrid=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
 function median(values){const a=values.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return NaN;const m=a.length;return m%2?a[(m-1)/2]:(a[m/2-1]+a[m/2])/2;}
 function percentile(values,p){const a=values.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return NaN;const q=clamp(p,0,1)*(a.length-1),i=Math.floor(q);return a[i]+(a[Math.min(i+1,a.length-1)]-a[i])*(q-i);}
 function bpmAt(points,t){if(!points?.length)return NaN;let b=NaN;for(const p of points){if(p.t>t)break;if(Number.isFinite(Number(p.bpm)))b=Number(p.bpm);}return b;}
 function uniqueTimes(raw){return [...new Set((raw||[]).map(Number).filter(t=>Number.isFinite(t)&&t>=0).map(t=>Math.round(t*10000)/10000))].sort((a,b)=>a-b);}
 function deltaLog(a,b){return Math.abs(Math.log(a/b));}
 function simplifyBeats(times){
   // Remove an obviously extra detection situated between two well-spaced beats.
   // Compare against a *local* median, not against a global BPM, to preserve
   // true accelerando and sudden tempo changes.
   let arr=times.slice(),removed=0;
   for(let pass=0;pass<2;pass++){
     const drops=[];
     for(let i=3;i<arr.length-3;i++){
       const prev=arr[i]-arr[i-1],next=arr[i+1]-arr[i],combined=prev+next;
       const neighborhood=[];
       for(let j=Math.max(1,i-5);j<Math.min(arr.length,i+6);j++){
         if(j===i||j===i+1)continue;
         const d=arr[j]-arr[j-1];if(d>.15&&d<3)neighborhood.push(d);
       }
       const typical=median(neighborhood);
       if(!Number.isFinite(typical))continue;
       if(prev<typical*.68&&next<typical*.68&&Math.abs(combined-typical)<typical*.18){drops.push(i);}
     }
     if(!drops.length)break;
     const drop=new Set(drops.filter((v,i)=>i===0||v>drops[i-1]+1));
     arr=arr.filter((_,i)=>!drop.has(i));removed+=drop.size;
   }
   return {times:arr,removed};
 }
 function bestKPath(times,reference,minTempo,maxTempo){
   // Choose how many true beats each AI gap spans. A dynamic program rewards
   // consecutive compatible local tempos, but allows genuine step changes.
   // Unlike 0.6.2 there is NO single seed BPM imposed on the whole song.
   const gaps=[];
   for(let i=1;i<times.length;i++){
     const d=times[i]-times[i-1],t=(times[i]+times[i-1])/2;
     const candidates=[];
     for(let k=1;k<=4;k++){
       const bpm=60*k/d;
       if(bpm<minTempo||bpm>maxTempo)continue;
       const prior=bpmAt(reference,t);
       // Favor fewer invented beats unless independent audio strongly supports them.
       let loss=(k-1)*.32;
       if(Number.isFinite(prior)&&prior>0){
         const err=deltaLog(bpm,prior);
         loss+=Math.min(1.9,2.25*err*err);
       }
       candidates.push({k,bpm,loss});
     }
     if(!candidates.length)candidates.push({k:1,bpm:clamp(60/d,minTempo,maxTempo),loss:2});
     gaps.push({t,a:times[i-1],b:times[i],d,candidates});
   }
   const costs=[],paths=[];
   for(let i=0;i<gaps.length;i++){
     const row=[],back=[];
     for(let j=0;j<gaps[i].candidates.length;j++){
       const cur=gaps[i].candidates[j];
       let best=cur.loss,bestIndex=-1;
       if(i){
         best=Infinity;
         for(let h=0;h<gaps[i-1].candidates.length;h++){
           const prev=gaps[i-1].candidates[h];
           // Capped jump cost: a significant real tempo shift is possible.
           const transition=Math.min(1.35,3.2*deltaLog(cur.bpm,prev.bpm));
           const v=costs[i-1][h]+cur.loss+transition;
           if(v<best){best=v;bestIndex=h;}
         }
       }
       row.push(best);back.push(bestIndex);
     }
     costs.push(row);paths.push(back);
   }
   const choices=new Array(gaps.length);
   let j=costs.at(-1).indexOf(Math.min(...costs.at(-1)));
   for(let i=gaps.length-1;i>=0;i--){choices[i]=gaps[i].candidates[j];j=paths[i][j];}
   return {gaps,choices};
 }
 function breakSegments(intervals,minBpm,maxBpm){
   // Piecewise-constant segmentation, computed over 3-beat median filtered log
   // BPM. Split positions are optimized over *all* beat boundaries, not fixed
   // 8-second windows, which improves the timestamp of genuine step changes.
   const n=intervals.length;
   if(!n)return [];
   const raw=intervals.map(x=>clamp(x.bpm,minBpm,maxBpm));
   const filtered=raw.map((v,i)=>median(raw.slice(Math.max(0,i-1),Math.min(n,i+2))));
   const y=filtered.map(v=>Math.log(v)), sums=new Float64Array(n+1),sq=new Float64Array(n+1);
   for(let i=0;i<n;i++){sums[i+1]=sums[i]+y[i];sq[i+1]=sq[i]+y[i]*y[i];}
   function mean(a,b){return (sums[b]-sums[a])/(b-a)}
   function err(a,b){const len=b-a;return Math.max(0,sq[b]-sq[a]-(sums[b]-sums[a])**2/len);}
   const ranges=[];const minBeats=5;let splits=0;
   function recurse(a,b,depth){
     if(depth>18||b-a<minBeats*2||splits>95){ranges.push([a,b]);return;}
     const baseline=err(a,b);
     let best=-1,gain=0;
     for(let s=a+minBeats;s<=b-minBeats;s++){
       const diff=Math.abs(mean(a,s)-mean(s,b));
       if(diff<.037)continue; // ignore <~3.7% BPM deviations
       const g=baseline-err(a,s)-err(s,b);
       if(g>gain){best=s;gain=g;}
     }
     // A minimum improvement prevents overfitting to random beat jitter.
     if(best<0||gain<.055){ranges.push([a,b]);return;}
     splits++;recurse(a,best,depth+1);recurse(best,b,depth+1);
   }
   recurse(0,n,0);
   ranges.sort((a,b)=>a[0]-b[0]);
   const sectionList=ranges.map(([a,b])=>({t:intervals[a].t,bpm:clamp(median(raw.slice(a,b)),minBpm,maxBpm),length:b-a}));
   // A segmentation boundary is not a tempo change if the medians agree.
   const merged=[];
   for(const s of sectionList){
     if(merged.length && Math.abs(Math.log(s.bpm/merged.at(-1).bpm))<.037){
       merged.at(-1).length+=s.length;
     }else merged.push({...s});
   }
   return merged;
 }
 // Reject a brief isolated tempo excursion only when the values before and
 // after agree. Output the removed events for user review. This is a cleanup
 // heuristic, NOT a proof of musical correctness; keep the original points.
 function suppressShortSpikes(points,options={}) {
   const source=(points||[]).map(p=>({...p})).sort((a,b)=>a.t-b.t);
   const removed=[];const reference=Array.isArray(options.reference)?options.reference:[];
   const maxSeconds=Number.isFinite(options.maxSeconds)?options.maxSeconds:3.5;
   // Repeat because removing one outlier can expose another.
   for(let pass=0;pass<6;pass++){
     let changed=false;
     for(let i=1;i<source.length-1;i++){
       const before=source[i-1],spike=source[i],after=source[i+1];
       const duration=after.t-spike.t;
       if(!(duration>0&&duration<=maxSeconds))continue;
       if(!(before.bpm>0&&spike.bpm>0&&after.bpm>0))continue;
       if(deltaLog(before.bpm,after.bpm)>.055)continue;
       if(deltaLog(spike.bpm,before.bpm)<.115)continue;
       // A second estimator supporting the brief deviation is a reason NOT to
       // remove it automatically. Do not treat a single flat prior as proof.
       if(reference.length>1){
         const q=bpmAt(reference,(spike.t+after.t)/2);
         if(Number.isFinite(q)&&deltaLog(q,spike.bpm)<.06&&deltaLog(q,before.bpm)>.11)continue;
       }
       removed.push({...spike,returnAt:after.t,previousBpm:before.bpm});
       source.splice(i,1);changed=true;break;
     }
     if(!changed)break;
   }
   return {points:source,removed};
 }
 function analyze(rawBeats,opts={}){
   const reference=Array.isArray(opts.reference)?opts.reference.slice().filter(p=>Number.isFinite(p?.t)&&Number.isFinite(p?.bpm)).sort((a,b)=>a.t-b.t):[];
   const maxTempo=clamp(Number(opts.maxBpm)||280,100,350),minTempo=clamp(Number(opts.minBpm)||45,30,100);
   const cleaned=uniqueTimes(rawBeats);
   const empty=reason=>({points:[],beats:cleaned,quality:0,review:true,warning:reason,stats:{missing:0,duplicates:0,ambiguous:0}});
   if(cleaned.length<5)return empty('拍が5個未満です。');
   const simp=simplifyBeats(cleaned),times=simp.times;
   if(times.length<5)return empty('有効な拍が不足しています。');
   const {gaps,choices}=bestKPath(times,reference,minTempo,maxTempo);
   let missing=0,ambiguous=0;
   const recovered=[times[0]];
   for(let i=0;i<gaps.length;i++){
     const {a,b,d}=gaps[i],k=choices[i].k;
     if(k>1){
       for(let j=1;j<k;j++){recovered.push(a+d*j/k);missing++;}
     }
     if(i>0){
       const prev=choices[i-1].bpm,cur=choices[i].bpm;
       if(deltaLog(cur,prev)>.24)ambiguous++;
     }
     recovered.push(b);
   }
   const intervals=[];
   for(let i=0;i<recovered.length-1;i++){
     const dt=recovered[i+1]-recovered[i];
     if(dt>0)intervals.push({t:recovered[i],end:recovered[i+1],bpm:60/dt});
   }
   const sections=breakSegments(intervals,minTempo,maxTempo);
   if(!sections.length)return empty('テンポ区間の推定に失敗しました。');
   const rawPoints=sections.map((s,i)=>({t:i===0?0:+s.t.toFixed(3),bpm:+s.bpm.toFixed(3),quality:0}));
   const cleanup=suppressShortSpikes(rawPoints,{reference});
   const points=cleanup.points;
   const mismatch=[];
   for(const v of intervals){const ref=bpmAt(reference,v.t);if(Number.isFinite(ref))mismatch.push(deltaLog(v.bpm,ref));}
   const frac=missing/Math.max(1,recovered.length-1);
   const anomalous=ambiguous/Math.max(1,choices.length);
   const conflict=median(mismatch);
   const flags=[];
   if(cleanup.removed.length)flags.push(`短時間の孤立したテンポ異常 ${cleanup.removed.length}件を候補から除外（元の候補は保持）`);
   if(frac>.10)flags.push(`${missing}個の欠落拍を補完。補完部分は要確認`);
   if(anomalous>.10)flags.push('拍間隔に大きな変動があります');
   if(Number.isFinite(conflict)&&conflict>.18)flags.push('AIの拍間隔と独立音声BPMに大きな不一致があります');
   if(reference.length>1){
     const vals=reference.map(p=>p.bpm).filter(Number.isFinite),lo=percentile(vals,.15),hi=percentile(vals,.85);
     if(points.length===1&&Number.isFinite(lo)&&hi/lo>1.09)flags.push('独立音声ではテンポ変化候補がありますが、AIの拍列からは変化を検出できません。音声側のテンポマップも確認してください');
   }
   const quality=clamp(1-frac*.7-anomalous*.8-(Number.isFinite(conflict)?Math.max(0,conflict-.06)*.9:0),0,1);
   const review=flags.length>0||quality<.75;
   return {points,rawPoints,removedSpikes:cleanup.removed,beats:recovered,quality:+quality.toFixed(3),review,warning:flags.join('／'),stats:{observed:cleaned.length,recovered:recovered.length,missing,duplicates:simp.removed,ambiguous,spikesSuppressed:cleanup.removed.length,referenceMismatch:Number.isFinite(conflict)?+conflict.toFixed(3):null,changes:points.length-1}};
 }
 return {analyze,median,percentile,bpmAt,suppressShortSpikes};
});
