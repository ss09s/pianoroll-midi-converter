import {videoPackets} from './video-demux.mjs?v=0.7.16';
import './note-core.js?v=0.7.16';
import {decoderColorSpace} from './video-color.mjs?v=0.7.16';
const core=globalThis.PianoRollNoteCore;
self.onmessage=async({data})=>{
 if(data.type!=='scan')return;
 const {file,width,height,hitLineY,lanes,fps,duration}=data,total=Math.ceil(duration*fps),started=performance.now();
 let display=null,codedSize=null,decoder,previous=null,index=0,error=null,lastProgress=0,decoded=0,lastTimestamp=-Infinity;
 const canvas=new OffscreenCanvas(width,1),ctx=canvas.getContext('2d',{willReadFrequently:true}),detect=core.createRowDetector(width,lanes),tracker=new core.Tracker({fps,duration});
 const audit=[];
 const metrics={engine:'webcodecs-worker',frames:total,decodedFrames:0,imageMs:0,detectMs:0,readMs:0,queueWaitMs:0,hardwareAcceleration:'browser-choice',phaseTimesOverlap:true,maxDecodeQueue:0};
 const progress=()=>{const now=performance.now();if(now-lastProgress>=100){lastProgress=now;postMessage({type:'progress',processed:index,total,elapsedMs:now-started});}};
 // Match the HTML media timeline at integer microsecond precision (floor sampling targets).
 const consume=(frame,until)=>{
  let hits=null;
  while(index<total&&Math.floor(index*1e6/fps)<until){
   if(Math.floor(index*1e6/fps)<frame.timestamp)throw Error('映像の開始時刻を対応付けられません');
   if(!hits){const start=performance.now();if(display.rotation===0)ctx.drawImage(frame,0,-hitLineY,width,height);else{const [a,b,c,d,e,f]=display.transform,sx=width/display.width,sy=height/display.height;ctx.setTransform(sx*a,sy*b,sx*c,sy*d,sx*e,sy*f-hitLineY);ctx.drawImage(frame,0,0,codedSize.width,codedSize.height);ctx.resetTransform();}const row=ctx.getImageData(0,0,width,1).data;metrics.imageMs+=performance.now()-start;const d=performance.now();hits=detect(row);metrics.detectMs+=performance.now()-d;}
   if(data.audit){const row=ctx.getImageData(0,0,width,1).data;let hash=2166136261;for(const v of row)hash=Math.imul(hash^v,16777619);audit.push({index,timestamp:frame.timestamp,hash:hash>>>0,hits});}tracker.push(index/fps,hits);index++;
  }
 };
 try{
  if(typeof VideoDecoder!=='function')throw Error('このブラウザーはWorker内VideoDecoderに非対応です');
  if(!ctx)throw Error('Worker内の画像処理に非対応です');
  metrics.nativeColorSpace=data.colorSpace??null;metrics.canvasColorSpace=ctx.getContextAttributes?.().colorSpace||'srgb';
  decoder=new VideoDecoder({output:frame=>{
   try{if(error)return;if(frame.timestamp<lastTimestamp)throw Error('映像の表示時刻が前後しています');lastTimestamp=frame.timestamp;
    if(previous){consume(previous,frame.timestamp);previous.close();previous=null;}
    previous=frame;frame=null;decoded++;progress();
   }catch(e){error=e;}finally{frame?.close();}
  },error:e=>{error=e;}});
  const configure=async track=>{display=track.display;codedSize=track.video;metrics.display=display;const colorSpace=decoderColorSpace(data.colorSpace);metrics.colorSpaceOverride=colorSpace??null;const support=await VideoDecoder.isConfigSupported({...track.config,...(colorSpace?{colorSpace}:{})});if(!support.supported)throw Error('この映像設定はWebCodecsでデコードできません（'+track.codec+'）');decoder.configure(support.config);metrics.codec=track.codec;metrics.codedWidth=track.video.width;metrics.codedHeight=track.video.height;metrics.mediaTime=track.mediaTime;metrics.colorSpace=data.colorSpace;};
  let readStart=performance.now();
  for await(const {sample:s,track} of videoPackets(file,configure,info=>{metrics.input=info;})){
   metrics.readMs+=performance.now()-readStart;if(error)throw error;
   const waitStart=performance.now();
   while(decoder.decodeQueueSize>=8){
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{decoder.removeEventListener('dequeue',done);reject(Error('デコード待ちがタイムアウトしました'));},10000);function done(){clearTimeout(timer);resolve();}decoder.addEventListener('dequeue',done,{once:true});});if(error)throw error;
   }
   metrics.queueWaitMs+=performance.now()-waitStart;
   decoder.decode(new EncodedVideoChunk({type:s.is_sync?'key':'delta',timestamp:Math.round((s.cts-track.mediaTime)*1e6/track.timescale),duration:Math.round(s.duration*1e6/track.timescale),data:s.data}));
   metrics.maxDecodeQueue=Math.max(metrics.maxDecodeQueue,decoder.decodeQueueSize);readStart=performance.now();
  }
  await decoder.flush();if(error)throw error;if(!previous)throw Error('映像フレームがありません');
  consume(previous,Infinity);if(index!==total)throw Error('サンプリングが完了しませんでした');
  metrics.decodedFrames=decoded;metrics.totalMs=performance.now()-started;
  postMessage({type:'result',notes:tracker.finish(),discarded:tracker.discarded,metrics,...(data.audit?{audit}:{})});
 }catch(e){postMessage({type:'error',message:e.message||String(e),diagnostics:{...metrics,nativeColorSpace:data.colorSpace??null}});}
 finally{previous?.close();if(decoder&&decoder.state!=='closed')decoder.close();}
};
