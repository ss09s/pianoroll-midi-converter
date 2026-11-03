/* Runs one model per worker. Termination releases ONNX/WASM memory on stop/completion. */
importScripts('beatnet-core.js');
self.onmessage=async({data})=>{
 let session;
 try{
  const {pcm,modelNumber,diagnostics=false}=data;
  if(![1,2,3].includes(modelNumber)||!(pcm instanceof Float32Array))throw Error('BeatNet入力が不正です');
  const progress=message=>postMessage({type:'progress',message});
  progress('BeatNet：WASM実行環境を準備中…');
  const ort=await import('./vendor/ort/ort.wasm.min.mjs');
  ort.env.wasm.numThreads=1;ort.env.wasm.wasmPaths=new URL('./vendor/ort/',self.location.href).href;
  const read=async(path)=>{const r=await fetch(path);if(!r.ok)throw Error(path+' HTTP '+r.status);return r.arrayBuffer()};
  const [win,bank]=await Promise.all([read('vendor/beatnet/window.f64'),read('vendor/beatnet/filterbank.f32')]);
  const frontend=new PianoRollBeatNetCore.Frontend(new Float64Array(win),new Float32Array(bank));
  session=await ort.InferenceSession.create('vendor/beatnet/beatnet-'+modelNumber+'.onnx',{executionProviders:['wasm'],graphOptimizationLevel:'basic',enableCpuMemArena:false,enableMemPattern:false});
  for(const name of ['features','hidden','cell'])if(!session.inputNames.includes(name))throw Error('モデル入力名が不正: '+name);
  const frames=Math.ceil(pcm.length/441),activations=new Float32Array(frames*2),references=diagnostics?new Float32Array(frames*603):null;
  const h=new Float32Array(300),c=new Float32Array(300);
  const sample=k=>k>=0&&k<pcm.length?pcm[k]:0;
  for(let i=0;i<frames;i++){
   const f=frontend.process(sample,i*441),feeds={features:new ort.Tensor('float32',f,[1,1,272]),hidden:new ort.Tensor('float32',h,[2,1,150]),cell:new ort.Tensor('float32',c,[2,1,150])};let out;
   try{
    out=await session.run(feeds);
    const p=out.probabilities.data;
    if(p.length!==3||!Array.from(p).every(x=>Number.isFinite(x)&&x>=0&&x<=1)||Math.abs(p[0]+p[1]+p[2]-1)>1e-4)throw Error('BeatNetの確率出力が不正です');
    activations[i*2]=p[0];activations[i*2+1]=p[1];h.set(out.hidden_out.data);c.set(out.cell_out.data);
    if(references){references.set(p,i*603);references.set(h,i*603+3);references.set(c,i*603+303);}
   }finally{Object.values(feeds).forEach(t=>t.dispose());if(out)Object.values(out).forEach(t=>t.dispose());}
   if(i%50===0)progress(`BeatNet ${modelNumber}：${Math.round(100*i/frames)}%（${(i*.02).toFixed(1)}秒）`);
  }
  const result={...PianoRollBeatNetCore.decode(activations,pcm.length/22050),length:pcm.length/22050,model:`BeatNet ${modelNumber} / peak-v1`,modelId:'beatnet-'+modelNumber,activations,frameRate:50};
  if(references)result.references=references;
  await session.release();session=null;
  postMessage({type:'result',result},[activations.buffer,...(references?[references.buffer]:[])]);
 }catch(e){postMessage({type:'error',message:e.message||String(e)});}
 finally{if(session)try{await session.release()}catch(_){}}
};
