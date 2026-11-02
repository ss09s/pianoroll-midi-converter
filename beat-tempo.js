/* PianoRoll MIDI Converter 0.6.2: testable, dependency-free beat-grid stabilizer.
   Converts detected beat times into a *candidate* tempo map. Never invents certainty.
   Designed for browser and Node.js test execution. */
(function(root, factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.PianoRollTempoGrid=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
  function median(xs){const a=xs.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return NaN;const n=a.length;return n%2?a[(n-1)/2]:(a[n/2-1]+a[n/2])/2;}
  function percentile(xs,p){const a=xs.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return NaN;const q=clamp(p,0,1)*(a.length-1),i=Math.floor(q);return a[i]+(a[Math.min(i+1,a.length-1)]-a[i])*(q-i);}
  function bpmAt(points,t){if(!points?.length)return NaN;let b=Number(points[0].bpm);for(const p of points){if(p.t>t)break;if(Number.isFinite(p.bpm))b=Number(p.bpm);}return b;}
  function smoothMedian(xs,r){return xs.map((_,i)=>median(xs.slice(Math.max(0,i-r),Math.min(xs.length,i+r+1))));}
  function analyze(rawBeats,opts={}){
    const reference=Array.isArray(opts.reference)?opts.reference.slice().sort((a,b)=>a.t-b.t):[];
    const maxTempo=clamp(Number(opts.maxBpm)||280,100,350),minTempo=clamp(Number(opts.minBpm)||45,30,100);
    const times=[...new Set((rawBeats||[]).map(Number).filter(t=>Number.isFinite(t)&&t>=0).map(t=>Math.round(t*10000)/10000))].sort((a,b)=>a-b);
    if(times.length<5)return {points:[],beats:times,quality:0,warning:'拍が5個未満のため推定できません。',stats:{missing:0,duplicates:0}};
    const diffs=times.slice(1).map((t,i)=>t-times[i]).filter(d=>d>.08&&d<3.5);
    if(diffs.length<4)return {points:[],beats:times,quality:0,warning:'有効な拍間隔が不足しています。',stats:{missing:0,duplicates:0}};
    // Initial speed should not be estimated from 4-beat spans: a single missing
    // beat causes a false halving. Short, stable spacings are more robust.
    const typical=percentile(diffs,.32);
    const near=diffs.filter(d=>d>=typical*.75&&d<=typical*1.32);
    let seed=median(near.length>=2?near:diffs);
    let seedBpm=60/seed;
    const r0=median(reference.slice(0,10).map(p=>p.bpm));
    // If almost all observed beats are half-time, a *reliable* audio prior can
    // offer the 2x interpretation, but this ambiguity must be disclosed.
    if(Number.isFinite(r0)&&r0>=minTempo&&r0<=maxTempo){
      const alternatives=[seedBpm,seedBpm*2,seedBpm/2].filter(b=>b>=minTempo&&b<=maxTempo);
      const target=alternatives.reduce((a,b)=>Math.abs(Math.log(b/r0))<Math.abs(Math.log(a/r0))?b:a,alternatives[0]);
      if(Math.abs(Math.log(target/r0))<.12&&Math.abs(Math.log(target/seedBpm))>.5){seedBpm=target;}
    }
    seedBpm=clamp(seedBpm,minTempo,maxTempo);
    let expected=60/seedBpm,missing=0,duplicates=0,ambiguous=0;
    const recovered=[times[0]];
    for(let i=1;i<times.length;i++){
      const a=times[i-1],b=times[i],d=b-a,m=(a+b)/2;
      const base=60/seedBpm;
      const prior=bpmAt(reference,m);
      const refPeriod=Number.isFinite(prior)?60/prior:base;
      // Give nearby, well-supported audio tempo a modest influence, without
      // allowing a noisy isolated reference value to create fictitious beats.
      const period=Math.abs(Math.log(refPeriod/base))<.22?base*.75+refPeriod*.25:base;
      let k=clamp(Math.round(d/period),1,4);
      if(d<period*.44){duplicates++;continue;}
      if(k>=2){
        const err=Math.abs(d/k-period)/period;
        if(err<.19){for(let j=1;j<k;j++){recovered.push(a+d*j/k);missing++;}}
        else ambiguous++;
      }else if(Math.abs(d-period)/period>.32)ambiguous++;
      recovered.push(b);
    }
    if(recovered.length<5)return {points:[],beats:recovered,quality:0,warning:'拍の連続性を復元できません。',stats:{missing,duplicates,ambiguous}};
    const intervals=[];
    for(let i=0;i<recovered.length-1;i++){
      const dur=recovered[i+1]-recovered[i];
      intervals.push({t:recovered[i],end:recovered[i+1],bpm:60/dur});
    }
    // Median of a local window suppresses one missed/extra beat without
    // flattening a real long-lived tempo change.
    let smoothed=smoothMedian(intervals.map(v=>v.bpm),2);
    smoothed=smoothed.map(b=>clamp(b,minTempo,maxTempo));
    const points=[{t:0,bpm:+smoothed[0].toFixed(3),quality:0}];
    const threshold=(a,b)=>Math.max(2.5,Math.min(a,b)*.045);
    let last=smoothed[0];
    let j=1;
    while(j<smoothed.length){
      if(Math.abs(smoothed[j]-last)<=threshold(smoothed[j],last)){j++;continue;}
      const target=median(smoothed.slice(j,Math.min(j+4,smoothed.length)));
      const count=smoothed.slice(j,Math.min(j+4,smoothed.length)).filter(x=>Math.abs(x-target)<=threshold(x,target)).length;
      if(count>=Math.min(3,smoothed.length-j)&&Math.abs(target-last)>threshold(target,last)){
        const change=Math.max(0,intervals[j].t);
        // Avoid emitting multiple tempo points only a fraction of a beat apart.
        if(change-points[points.length-1].t>=.5){
          points.push({t:+change.toFixed(3),bpm:+target.toFixed(3),quality:0});last=target;
        }
      }
      j++;
    }
    // Use median over each segment to determine fractional BPM. This avoids
    // quantizing to 1 or 2 BPM and reduces 130.1 -> 130.4 -> 130.0 chatter.
    for(let i=0;i<points.length;i++){
      const end=i+1<points.length?points[i+1].t:Infinity;
      const section=intervals.filter(v=>v.t>=points[i].t-.001&&v.t<end-.001).map(v=>v.bpm);
      const sectionMedian=median(section);
      if(Number.isFinite(sectionMedian)&&section.length>=2)points[i].bpm=+clamp(sectionMedian,minTempo,maxTempo).toFixed(3);
    }
    // Compare with audio baseline, accounting for octave errors when reporting.
    const referenceDiffs=intervals.filter(v=>Number.isFinite(bpmAt(reference,v.t))).map(v=>{
      const b=bpmAt(reference,v.t),r=v.bpm/b;
      return Math.min(Math.abs(Math.log(r)),Math.abs(Math.log(r*2)),Math.abs(Math.log(r/2)));
    });
    const mismatch=referenceDiffs.length?median(referenceDiffs):NaN;
    const inferredFraction=missing/Math.max(1,recovered.length-1);
    const anomalyFraction=ambiguous/Math.max(1,times.length-1);
    const quality=clamp(1-inferredFraction*.8-anomalyFraction*1.7-(Number.isFinite(mismatch)?Math.max(0,mismatch-.08)*1.5:0),0,1);
    const flags=[];
    if(inferredFraction>.18)flags.push(`欠落拍を${missing}件補完（${Math.round(inferredFraction*100)}%）。倍・半テンポを要確認`);
    if(anomalyFraction>.12)flags.push(`不規則な拍間隔が${ambiguous}件あります`);
    if(Number.isFinite(mismatch)&&mismatch>.19)flags.push('従来の音声BPMと大きく不一致');
    if(quality<.7&&!flags.length)flags.push('拍追跡の信頼度が低い');
    // Any substantial repaired sequence must be reviewed before being applied.
    const review=flags.length>0||quality<.75;
    return {points,beats:recovered,quality:+quality.toFixed(3),review,warning:flags.join('／'),stats:{observed:times.length,recovered:recovered.length,missing,duplicates,ambiguous,referenceMismatch:Number.isFinite(mismatch)?+mismatch.toFixed(3):null}};
  }
  return {analyze,median,percentile,bpmAt};
});
