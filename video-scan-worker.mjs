import {videoPackets,decoderChunkInit} from './video-demux.mjs?v=0.7.49';
import './note-core.js?v=0.7.57';
import './text-overlay.js?v=0.7.49';
import './motion-core.js?v=0.7.64';
import './frame-reader.js?v=0.7.49';
import {decoderColorSpace} from './video-color.mjs?v=0.7.18';
import {waitForDecodeCapacity,configureVideoDecoder,verifyDecoderFrameColor} from './video-decode-utils.mjs?v=0.7.51';
const core=globalThis.PianoRollNoteCore;
self.onmessage=async({data})=>{
 if(data.type!=='scan')return;
 const {file,width,height,hitLineY,lanes,fps,duration}=data,total=Math.ceil(duration*fps),started=performance.now();
 let display=null,codedSize=null,selectedConfig=null,expectedColor=null,decoder,previous=null,index=0,error=null,lastProgress=0,decoded=0,lastTimestamp=-Infinity;
 const tracker=globalThis.PianoRollMotionCore.createScan({width,height,hitLineY,lanes,fps,duration,mode:data.detectionMode,primaryPercent:data.primaryPercent,textOverlay:data.textOverlay}),canvas=new OffscreenCanvas(width,height),reader=globalThis.PianoRollFrameReader.createReader(canvas,width,height,tracker.lines),ctx=reader.ctx,detect=tracker.detect;
 const audit=[],failure=new AbortController();
 const fail=e=>{if(!error){error=e;failure.abort(e);}};
 const metrics={workerVersion:'0.7.64',engine:'webcodecs-worker',frames:total,decodedFrames:0,imageMs:0,drawMs:0,pixelReadMs:0,trackingMs:0,detectMs:0,readMs:0,queueWaitMs:0,hardwareAcceleration:'browser-choice',phaseTimesOverlap:true,maxDecodeQueue:0,stage:'container'};
 const progress=(force=false)=>{const now=performance.now();if(force||now-lastProgress>=100){lastProgress=now;postMessage({type:'progress',processed:index,total,elapsedMs:now-started,stage:metrics.stage});}};
 // Match the HTML media timeline at integer microsecond precision (floor sampling targets).
 const consume=(frame,until)=>{
  let hits=null,rows=null;
  while(index<total&&Math.floor(index*1e6/fps)<until){
   if(Math.floor(index*1e6/fps)<frame.timestamp)throw Error('映像の開始時刻を対応付けられません');
   if(!hits){rows=reader.read(frame,display,codedSize,metrics);const d=performance.now();hits=rows.map(detect);metrics.detectMs+=performance.now()-d;
    if(data.audit){let hash=2166136261;for(const row of rows)for(const v of row)hash=Math.imul(hash^v,16777619);audit.push({index,timestamp:frame.timestamp,hash:hash>>>0,hits:tracker.lines.length===1?hits[0]:hits});}
   }
   const trackingStart=performance.now();tracker.push(index/fps,hits,rows,frame.timestamp/1e6);metrics.trackingMs+=performance.now()-trackingStart;index++;
  }
 };
 try{
  if(typeof VideoDecoder!=='function')throw Error('このブラウザーはWorker内VideoDecoderに非対応です');
  if(!ctx)throw Error('Worker内の画像処理に非対応です');
  metrics.nativeColorSpace=data.colorSpace??null;metrics.canvasColorSpace=ctx.getContextAttributes?.().colorSpace||'srgb';
  decoder=new VideoDecoder({output:frame=>{
   try{if(error)return;if(selectedConfig?.automaticColor)verifyDecoderFrameColor(frame,expectedColor);if(frame.timestamp<lastTimestamp)throw Error('映像の表示時刻が前後しています');lastTimestamp=frame.timestamp;
    if(previous){consume(previous,frame.timestamp);previous.close();previous=null;}
    previous=frame;frame=null;decoded++;progress();
   }catch(e){fail(e);}finally{frame?.close();}
  },error:e=>{fail(e);}});
  const configure=async track=>{metrics.stage='decoder-check';progress(true);display=track.display;codedSize=track.video;metrics.display=display;const colorSpace=decoderColorSpace(data.colorSpace);metrics.colorSpaceOverride=colorSpace??null;expectedColor=colorSpace;metrics.decoderConfigAttempts=[];selectedConfig=await configureVideoDecoder(VideoDecoder,decoder,{...track.config,...(colorSpace?{colorSpace}:{})},{signal:failure.signal,onAttempt:attempt=>{metrics.decoderConfigAttempts.push(attempt);progress(true);}});metrics.selectedDecoderConfig={hardwareAcceleration:selectedConfig.config.hardwareAcceleration||'no-preference',dimensions:selectedConfig.config.codedWidth?'container':'bitstream',color:selectedConfig.automaticColor?'bitstream':'explicit'};metrics.stage='decoding';metrics.codec=track.codec;metrics.codedWidth=track.video.width;metrics.codedHeight=track.video.height;metrics.mediaTime=track.mediaTime;metrics.colorSpace=data.colorSpace;};
  let readStart=performance.now();
  for await(const {sample:s,track} of videoPackets(file,configure,info=>{metrics.input=info;progress(true);})){
   metrics.readMs+=performance.now()-readStart;if(error)throw error;
   const waitStart=performance.now();
   await waitForDecodeCapacity(decoder,8,failure.signal);
   metrics.queueWaitMs+=performance.now()-waitStart;
   decoder.decode(new EncodedVideoChunk(decoderChunkInit(s,track)));
   metrics.maxDecodeQueue=Math.max(metrics.maxDecodeQueue,decoder.decodeQueueSize);readStart=performance.now();progress();
  }
  metrics.stage='flush';progress(true);const flushStart=performance.now();await decoder.flush();metrics.flushMs=performance.now()-flushStart;if(error)throw error;if(!previous)throw Error('映像フレームがありません');
  consume(previous,Infinity);if(index!==total)throw Error('サンプリングが完了しませんでした');
  metrics.stage='fusion';progress(true);const finishStart=performance.now(),final=tracker.finish();metrics.fusionMs=performance.now()-finishStart;metrics.stage='complete';metrics.decodedFrames=decoded;metrics.totalMs=performance.now()-started;
  postMessage({type:'result',...final,metrics,...(data.audit?{audit}:{})});
 }catch(e){postMessage({type:'error',message:e.message||String(e),diagnostics:{...metrics,decodedFrames:decoded,nativeColorSpace:data.colorSpace??null}});}
 finally{previous?.close();if(decoder&&decoder.state!=='closed')decoder.close();}
};
