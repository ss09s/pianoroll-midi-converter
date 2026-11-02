/* PianoRoll MIDI Converter v0.6 – actual on-device neural beat/downbeat inference.
 * Uses @jgorset/beat-this v1.0.0 (MIT) and Beat This! pretrained ONNX weights (MIT).
 * Dependencies / model load only when user presses the AI button.
 * No audio/video data is sent to the CDN. See README for model provenance.
 */
(function(){
  'use strict';
  let running = false;
  let cancelController = null;
  let tracker = null;
  let usedUrl = null;
  const WASM_PATHS = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/';
  const MODEL_LIGHT = 'https://cdn.jsdelivr.net/gh/danigb/beat-this-rs@main/models/beat_this_small.onnx';
  const MODEL_FULL = 'https://github.com/jgorset/beat-this/releases/download/v1.0.0/beat-this.onnx';
  const LIBRARY_CDNS = [
    'https://esm.sh/@jgorset/beat-this@1.0.0?bundle',
    'https://cdn.jsdelivr.net/npm/@jgorset/beat-this@1.0.0/+esm'
  ];
  let libModule = null;
  async function library(){
    if(libModule) return libModule;
    const problems=[];
    for(const url of LIBRARY_CDNS){
      try{
        const candidate = await import(/* webpackIgnore: true */ url);
        if(typeof candidate.createBeatThis === 'function'){
          libModule=candidate;
          return candidate;
        }
        throw Error('createBeatThis関数が見つかりません');
      }catch(e){problems.push(e.message||String(e));}
    }
    throw Error('AIライブラリを読み込めませんでした。通信環境を確認してください。詳細：'+problems.join(' / '));
  }
  function getMono(buffer, signal){
    if(buffer.numberOfChannels < 1)throw Error('音声のチャンネルがありません');
    const sr = buffer.sampleRate;
    const duration = buffer.duration;
    if(!Number.isFinite(duration)||duration<2)throw Error('AI拍検出には2秒以上の音声が必要です');
    // Beat This! explicitly requires mono audio at 22050 Hz.
    const channelCount = Math.min(buffer.numberOfChannels,2);
    const n = Math.floor(duration*22050);
    if(n>22050*60*60)throw Error('60分を超える音声は対象外です');
    const output = new Float32Array(n);
    const channels=Array.from({length:channelCount},(_,i)=>buffer.getChannelData(i));
    // Linear resampling with actual buffer sample rate to avoid iOS rate mismatches.
    for(let i=0;i<n;i++){
      if((i&131071)===0 && signal?.aborted)throw DOMException('中止しました','AbortError');
      const p=i*sr/22050, k=Math.min(channels[0].length-1,Math.floor(p)), k2=Math.min(k+1,channels[0].length-1),a=p-k;
      let value=0;
      for(const c of channels)value+=(c[k]*(1-a)+c[k2]*a)/channelCount;
      output[i]=Math.max(-1,Math.min(1,value));
    }
    return output;
  }
  async function analyze(buffer,options={}){
    if(running)throw Error('AI解析がすでに動作しています');
    running=true;
    cancelController=new AbortController();
    const signal=cancelController.signal;
    const progress=typeof options.onProgress==='function'?options.onProgress:()=>{};
    let objectUrl=null;
    try{
      progress('PCM音声を22,050Hz・モノラルに整えています');
      const mono=getMono(buffer,signal);
      if(signal.aborted)throw DOMException('中止しました','AbortError');
      progress('AIライブラリを読み込んでいます（ネット接続が必要）');
      const {createBeatThis}=await library();
      if(signal.aborted)throw DOMException('中止しました','AbortError');
      if(options.modelFile){
        if(options.modelFile.size<500000)throw Error('ONNXファイルが小さすぎます。Beat This!のモデルを指定してください。');
        objectUrl=URL.createObjectURL(options.modelFile);
      }
      const requestedUrl = objectUrl || (options.modelType === 'full' ? MODEL_FULL : MODEL_LIGHT);
      // An explicit CORS-supported URL is used for the lightweight model; a local
      // file choice is available if the browser refuses a remote weight download.
      progress('AIモデルを読み込み中…（軽量：約10MB／高精度：約83MB）');
      tracker = await createBeatThis({
        modelUrl: requestedUrl,
        executionProvider: options.provider === 'webgpu' ? 'webgpu':'wasm',
        wasmPaths: WASM_PATHS
      });
      usedUrl=requestedUrl;
      if(signal.aborted)throw DOMException('中止しました','AbortError');
      progress('ニューラルネットワークで拍・小節頭を解析中');
      const res=await tracker.analyze(mono,{
        signal,
        onProgress:(stage,done,total)=>{
          if(total>0)progress(`AI解析 ${stage}: ${Math.floor(100*done/total)}% (${done}/${total})`);
        }
      });
      if(signal.aborted)throw DOMException('中止しました','AbortError');
      const clean=(arr)=>Array.from(arr||[]).map(Number).filter(t=>Number.isFinite(t)&&t>=0&&t<=buffer.duration+.2).sort((a,b)=>a-b);
      const beats=clean(res.beats), downbeats=clean(res.downbeats);
      if(beats.length<4)throw Error('AIが十分な拍を検出できませんでした。楽曲を変更するか別モデルを試してください。');
      return {beats,downbeats,model:options.modelFile?'ローカルONNXモデル':options.modelType==='full'?'Beat This! 高精度':'Beat This! 軽量',length:buffer.duration};
    }finally{
      try{if(tracker)await tracker.dispose();}catch(_){}
      tracker=null;
      if(objectUrl)URL.revokeObjectURL(objectUrl);
      usedUrl=null;
      cancelController=null;
      running=false;
    }
  }
  function abort(){if(cancelController)cancelController.abort();}
  window.PianoRollBeatAI={analyze,abort,get running(){return running;},MODEL_FULL,MODEL_LIGHT};
  window.dispatchEvent(new Event('pianoroll-ai-ready'));
})();
