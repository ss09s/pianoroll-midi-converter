/* PianoRoll MIDI Converter v0.6.3 – staged diagnostics and reliability checks.
 * Full and small models may use different input tensor names ('spect' or
 * 'spectrogram'). Never hard-code the ONNX feed name: inspect session.inputNames.
 * Uses @jgorset/beat-this 1.0.0 DSP/postprocessing and onnxruntime-web 1.23.2.
 * Audio remains on device. Model/JS are fetched on user request.
 */
(function(){
  'use strict';
  const SAMPLE_RATE=22050, HOP=441, BANDS=128, WINDOW=1500, BORDER=6;
  const WASM_PATHS='https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/';
  const MODEL_LIGHT='https://cdn.jsdelivr.net/gh/danigb/beat-this-rs@main/models/beat_this_small.onnx';
  const MODEL_FULL='https://huggingface.co/aaatmy/beat-this-onnx/resolve/main/beat-this-final0.onnx?download=true';
  const MODEL_FULL_FALLBACK='https://github.com/jgorset/beat-this/releases/download/v1.0.0/beat-this.onnx';
  const LIBRARY_CDNS=[
    'https://esm.sh/@jgorset/beat-this@1.0.0?bundle',
    'https://cdn.jsdelivr.net/npm/@jgorset/beat-this@1.0.0/+esm'
  ];
  const ORT_CDNS=[
    'https://esm.sh/onnxruntime-web@1.23.2/webgpu?bundle',
    'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/webgpu/+esm'
  ];
  let dsp=null, ortRuntime=null, running=false, controller=null;
  const abortError=()=>new DOMException('中止しました','AbortError');
  function check(signal){ if(signal?.aborted)throw abortError(); }
  async function importFirst(urls,valid,label){
    const errors=[];
    for(const url of urls){
      try{
        const mod=await import(/* webpackIgnore: true */ url);
        if(valid(mod))return mod;
        throw new Error('必要なAPIが見つかりません');
      }catch(e){errors.push((e?.message||String(e)).slice(0,160));}
    }
    throw new Error(label+'の読み込みに失敗しました。ネット接続をご確認ください。 '+errors.join(' / '));
  }
  async function dependencies(){
    if(!dsp)dsp=await importFirst(LIBRARY_CDNS,m=>typeof m.extractFeatures==='function'&&typeof m.postprocess==='function','音声特徴抽出ライブラリ');
    if(!ortRuntime)ortRuntime=await importFirst(ORT_CDNS,m=>m.InferenceSession&&m.Tensor&&m.env,'ONNX Runtime');
    return {dsp,ort:ortRuntime};
  }
  // Only read PCM needed for this inference window. Avoid holding a duplicate
  // 10–30 MB resampled track on memory-constrained mobile Safari.
  function readMono(buffer,first,count,signal){
    const n=Math.max(0,Math.floor(count));
    const output=new Float32Array(n);
    const channelCount=Math.min(2,buffer.numberOfChannels);
    if(channelCount<1)throw new Error('音声チャンネルがありません');
    const channels=Array.from({length:channelCount},(_,i)=>buffer.getChannelData(i));
    const srcLen=channels[0].length, ratio=buffer.sampleRate/SAMPLE_RATE;
    for(let i=0;i<n;i++){
      if((i&8191)===0)check(signal);
      const pos=(first+i)*ratio;
      const k=Math.min(srcLen-1,Math.max(0,Math.floor(pos)));
      const next=Math.min(k+1,srcLen-1), a=Math.max(0,Math.min(1,pos-k));
      let v=0;
      for(const c of channels)v+=c[k]*(1-a)+c[next]*a;
      output[i]=Math.max(-1,Math.min(1,v/channelCount));
    }
    return output;
  }
  // Many browsers refuse model loading after a GitHub Releases redirect (CORS,
  // intermediate auth or a URL fetch problem). Fetch explicitly and give a
  // useful error, instead of passing a URL to ONNX Runtime and getting "Load failed".
  // Hugging Face hosts the original final0 export (spectrogram -> beat/downbeat).
  // This may still fail if the host is blocked, offline, or memory is exhausted.
  async function fetchFullModel(progress,signal){
    const origins=[MODEL_FULL,MODEL_FULL_FALLBACK],problems=[];
    for(let ix=0;ix<origins.length;ix++){
      check(signal);
      const url=origins[ix];
      let response;
      try{
        progress(`高精度モデルを取得中：提供元${ix+1}/${origins.length}（約82MB）…`);
        response=await fetch(url,{mode:'cors',cache:'default',signal});
        if(!response.ok)throw new Error('HTTP '+response.status);
        const type=response.headers.get('content-type')||'';
        const size=Number(response.headers.get('content-length')||0);
        if(size && size < 30000000)throw new Error('応答がONNXモデルではありません（容量 '+size+' bytes）');
        // The full ONNX model is ~82 MB. No extra copy: keep one ArrayBuffer.
        const body=await response.arrayBuffer();
        check(signal);
        if(body.byteLength<30000000)throw new Error('不完全なモデル（'+body.byteLength+' bytes、HTML/認証画面の可能性）');
        progress(`高精度モデル取得済み（${(body.byteLength/1048576).toFixed(1)}MiB）。初期化しています…`);
        return new Uint8Array(body);
      }catch(e){
        if(signal.aborted)throw abortError();
        problems.push(`提供元${ix+1}: ${e?.message||String(e)}`);
      }
    }
    throw new Error('高精度モデルを自動取得できません。'+problems.join(' / ')+'。ダウンロード済みの .onnx を「手元のモデル」で選択すると利用できます。');
  }
  const logitValid=(v)=>v instanceof Float32Array && v.length>0;
  function getOutput(result,name,session){
    let tensor=result[name];
    if(!tensor){
      const names=session.outputNames||[];
      const actual=names.find(x=>x.toLowerCase()===name.toLowerCase());
      tensor=actual?result[actual]:undefined;
    }
    if(!tensor)throw new Error('モデルの出力 '+name+' がありません。対応モデルを選択してください。');
    return tensor.data;
  }
  async function analyze(buffer,options={}){
    if(running)throw new Error('AI解析がすでに動作しています');
    if(!buffer||!Number.isFinite(buffer.duration)||buffer.duration<2)throw new Error('2秒以上のデコード済み音声が必要です');
    running=true;controller=new AbortController();
    const signal=controller.signal;
    const progress=typeof options.onProgress==='function'?options.onProgress:()=>{};
    let session=null;
    let stage='開始';
    try{
      stage='依存ライブラリの取得';progress('AI解析ライブラリと実行環境を準備しています…');
      const {dsp,ort}=await dependencies();
      check(signal);
      ort.env.wasm.wasmPaths=WASM_PATHS;
      ort.env.wasm.numThreads=1;
      const provider=options.provider==='webgpu'?'webgpu':'wasm';
      const isFull=options.modelType==='full';
      let modelSource=isFull?null:MODEL_LIGHT;
      if(options.modelFile){
        if(!/\.onnx$/i.test(options.modelFile.name))throw new Error('.onnxファイルを選択してください');
        if(options.modelFile.size<500000)throw new Error('ONNXモデルが小さすぎます。正しいモデルを選択してください');
        progress('選択したONNXモデルを読み取っています…');
        modelSource=new Uint8Array(await options.modelFile.arrayBuffer());
        check(signal);
      }else if(isFull){
        stage='高精度モデルのダウンロード';
        modelSource=await fetchFullModel(progress,signal);
      }
      stage='ONNXモデルの取得・初期化';progress('モデル初期化中（軽量：約10MB／高精度：約83MB）…');
      try{session=await ort.InferenceSession.create(modelSource,{
        executionProviders:[provider],graphOptimizationLevel:'all'
      });}catch(err){
        const detail=err?.message||String(err);
        const model=options.modelType==='full'?'高精度（約83MB）':'軽量';
        throw new Error(`${model}モデル初期化失敗（${provider}）：${detail}。高精度モデルでは端末メモリ・対応ONNX演算・モデル取得状況が影響します。`);
      }
      check(signal);
      const inputs=session.inputNames||[], outputs=session.outputNames||[];
      if(inputs.length!==1)throw new Error('モデル入力が1つではありません: '+inputs.join(', '));
      if(!outputs.some(x=>x.toLowerCase()==='beat')||!outputs.some(x=>x.toLowerCase()==='downbeat')){
        throw new Error('拍・小節頭の出力がありません: '+outputs.join(', '));
      }
      // Source of the v0.6 bug: @jgorset/beat-this hard-codes {spect}, but the
      // lightweight model actually requires a feed called 'spectrogram'.
      // Using session.inputNames[0] supports both ONNX model naming conventions.
      const inputName=inputs[0];
      progress(`モデル接続確認：入力「${inputName}」／出力「${outputs.join('、')}」`);
      stage='特徴量抽出・推論';const sampleCount=Math.floor(buffer.duration*SAMPLE_RATE);
      if(!Number.isSafeInteger(sampleCount)||sampleCount<2*SAMPLE_RATE)throw new Error('音声が短すぎます');
      const frames=Math.floor(sampleCount/HOP)+1;
      const starts=[];
      for(let s=-BORDER;s<frames-BORDER;s+=WINDOW-2*BORDER)starts.push(s);
      if(frames>WINDOW-2*BORDER)starts[starts.length-1]=frames-(WINDOW-BORDER);
      const beat=new Float32Array(frames),downbeat=new Float32Array(frames);
      beat.fill(-1000);downbeat.fill(-1000);
      let writtenUntil=0;
      for(let j=0;j<starts.length;j++){
        check(signal);
        progress(`AI推論中：${j+1}/${starts.length} 区間（${Math.round((j+1)*100/starts.length)}%）`);
        const start=starts[j],first=Math.max(0,start),stop=Math.min(start+WINDOW,frames);
        const left=Math.max(0,-start),right=Math.max(0,Math.min(BORDER,start+WINDOW-frames));
        const validCount=stop-first+left+right;
        const pcmBegin=Math.max(0,first*HOP-1024);
        const pcmEnd=Math.min(sampleCount,stop*HOP+1024);
        const pcm=readMono(buffer,pcmBegin,pcmEnd-pcmBegin,signal);
        check(signal);
        const features=dsp.extractFeatures(pcm,first,stop-first,sampleCount,pcmBegin);
        if(!(features instanceof Float32Array)||features.length!==(stop-first)*BANDS){
          throw new Error('メルスペクトログラムの形状が不正です。');
        }
        // Pad short inputs to WINDOW for ONNX models with fixed time dimension.
        const input=new Float32Array(WINDOW*BANDS);
        input.set(features,left*BANDS);
        let tensor=null,result=null;
        try{
          tensor=new ort.Tensor('float32',input,[1,WINDOW,BANDS]);
          result=await session.run({[inputName]:tensor});
          check(signal);
          const b=getOutput(result,'beat',session),d=getOutput(result,'downbeat',session);
          if(!logitValid(b)||!logitValid(d)||b.length<validCount||d.length<validCount){
            throw new Error('モデル出力の長さが不足しています。出力: '+b?.length+'/'+d?.length+', 必要: '+validCount);
          }
          const from=Math.max(BORDER,writtenUntil-start,0);
          const to=Math.min(validCount-BORDER,frames-start);
          for(let i=from;i<to;i++){
            const idx=start+i;
            if(idx>=0&&idx<frames){beat[idx]=b[i];downbeat[idx]=d[i];}
          }
          writtenUntil=Math.max(writtenUntil,start+validCount-BORDER);
        }finally{
          try{tensor?.dispose?.()}catch(_){}
          if(result)for(const value of Object.values(result))try{value?.dispose?.()}catch(_){}
        }
        // Yield to Safari's event loop between inference windows.
        if(j+1<starts.length)await new Promise(r=>setTimeout(r,0));
      }
      check(signal);
      progress('拍・小節頭を時刻に変換しています…');
      stage='拍時刻の後処理';const result=dsp.postprocess(beat,downbeat);
      const clean=arr=>Array.from(arr||[]).map(Number).filter(t=>Number.isFinite(t)&&t>=0&&t<buffer.duration+.1).sort((a,b)=>a-b);
      const beats=clean(result.beats),downbeats=clean(result.downbeats);
      if(beats.length<4)throw new Error('十分な拍が検出できませんでした。音楽が明瞭な区間を含むか確認してください。');
      return {beats,downbeats,length:buffer.duration,model:options.modelFile?'指定したONNXモデル':options.modelType==='full'?'Beat This! 高精度':'Beat This! 軽量'};
    }catch(err){
      // This error is now actionable rather than the generic v0.6 text.
      if(/missing in ['"]feeds['"]|input .+ missing/i.test(err.message||'')){
        throw new Error('モデルの入力名が一致しません。モデル構成情報：'+(session?.inputNames||[]).join(', ')+'。詳細：'+err.message);
      }
      if(err?.name==='AbortError')throw err;
      const detail=err?.message||String(err);
      throw new Error(`AI処理失敗［${stage}］：${detail}`);
    }finally{
      if(session){try{await session.release()}catch(_){}}
      running=false;controller=null;
    }
  }
  function abort(){controller?.abort()}
  window.PianoRollBeatAI={analyze,abort,get running(){return running},MODEL_FULL,MODEL_LIGHT};
  window.dispatchEvent(new Event('pianoroll-ai-ready'));
})();
