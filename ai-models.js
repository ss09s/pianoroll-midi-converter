/* Model registry and bounded-lifetime BeatNet worker adapter. No audio upload. */
(function(){
'use strict';
const models=[
 {id:'light',name:'Beat This! 軽量',family:'Beat This!',decoder:'Beat This! postprocess',size:'約10 MB'},
 {id:'full',name:'Beat This! full',family:'Beat This!',decoder:'Beat This! postprocess',size:'約83 MB'},
 ...[1,2,3].map(n=>({id:'beatnet-'+n,name:'BeatNet '+n+'（実験）',family:'BeatNet',decoder:'peak-v1（公式PF/DBNとは異なります）',size:'約1.6 MB'}))
];
let active=null,busy=false;
function abort(){active?.();window.PianoRollBeatAI?.abort();}
async function analyze(buffer,options={}){
 if(busy)throw Error('解析中です');busy=true;
 const id=options.modelType||'light',entry=models.find(m=>m.id===id);if(!entry){busy=false;throw Error('不明なモデルです');}
 const started=performance.now();
 try{
  let result;
  if(!id.startsWith('beatnet-'))result=await window.PianoRollBeatAI.analyze(buffer,options);
  else{
   if(options.modelFile)throw Error('BeatNetは同梱の専用モデルを使用します。「手元のモデル」の選択を解除してください。');
   if(!Number.isFinite(buffer.duration)||buffer.duration<2)throw Error('2秒以上の音声が必要です');
   let cancelled=false;active=()=>{cancelled=true};
   options.onProgress?.('BeatNet用の音声を準備中…');
   const length=Math.floor(buffer.duration*22050),pcm=new Float32Array(length),channels=Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i));
   for(let s=0;s<length;s+=32768){
    if(cancelled)throw new DOMException('中止しました','AbortError');
    for(let i=s;i<Math.min(length,s+32768);i++){const p=i*buffer.sampleRate/22050,k=Math.floor(p),a=p-k;let v=0;for(const ch of channels)v+=(ch[k]||0)*(1-a)+(ch[Math.min(k+1,ch.length-1)]||0)*a;pcm[i]=v/channels.length;}
    if(s%262144===0)await new Promise(r=>setTimeout(r,0));
   }
   if(cancelled)throw new DOMException('中止しました','AbortError');
   result=await new Promise((resolve,reject)=>{
    const worker=new Worker('beatnet-worker.js?v=0.6.9');
    const finish=(error,value)=>{worker.terminate();active=null;error?reject(error):resolve(value)};
    active=()=>finish(new DOMException('中止しました','AbortError'));
    worker.onerror=e=>finish(Error('BeatNet Worker: '+e.message));
    worker.onmessage=({data})=>{if(data.type==='progress')options.onProgress?.(data.message);else if(data.type==='error')finish(Error(data.message));else if(data.type==='result')finish(null,data.result);};
    worker.postMessage({pcm,modelNumber:Number(id.slice(-1))},[pcm.buffer]);
   });
  }
  return {...result,modelId:id,decoder:result.decoder||entry.decoder,elapsedSeconds:(performance.now()-started)/1000,provider:id.startsWith('beatnet-')?'wasm':options.provider||'wasm'};
 }finally{active=null;busy=false;}
}
window.PianoRollModels={models,analyze,abort,get running(){return busy}};
})();
