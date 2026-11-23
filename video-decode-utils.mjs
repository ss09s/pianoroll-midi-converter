/* Wait for actual capacity; reject immediately on asynchronous decoder failure. */
export function waitForDecodeCapacity(decoder,limit,signal,timeoutMs=10000){
 if(signal?.aborted)return Promise.reject(signal.reason||Error('映像デコーダーが停止しました'));
 if(decoder.state!=='configured')return Promise.reject(Error('映像デコーダーが停止しました'));
 if(decoder.decodeQueueSize<limit)return Promise.resolve();
 return new Promise((resolve,reject)=>{
 let timer,settled=false;
 const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);decoder.removeEventListener('dequeue',ready);signal?.removeEventListener('abort',failed);error?reject(error):resolve();};
 const failed=()=>finish(signal.reason||Error('映像デコーダーが停止しました'));
 const ready=()=>{if(signal?.aborted)return failed();if(decoder.state!=='configured')return finish(Error('映像デコーダーが停止しました'));if(decoder.decodeQueueSize<limit)finish();};
 decoder.addEventListener('dequeue',ready);signal?.addEventListener('abort',failed,{once:true});
 timer=setTimeout(()=>finish(Error('デコード待ちがタイムアウトしました')),timeoutMs);ready();
});}

// Negotiate optional hints for this stream; never rewrite codec/profile or bytes.
export async function configureVideoDecoder(Decoder,decoder,config,{signal,onAttempt=()=>{}}={}){
 const colors=[config];if(config.colorSpace){const automatic={...config};delete automatic.colorSpace;colors.push(automatic);}
 let lastError;
 for(let color=0;color<colors.length;color++)for(const dimensions of [true,false])for(const hardwareAcceleration of ['no-preference','prefer-hardware','prefer-software']){
  if(signal?.aborted)throw signal.reason||Error('デコード設定の確認を中止しました');
  const candidate={...colors[color],hardwareAcceleration};if(!dimensions){delete candidate.codedWidth;delete candidate.codedHeight;}
  const attempt={hardwareAcceleration,dimensions:dimensions?'container':'bitstream',color:color?'bitstream':'explicit',supported:false};
  try{const support=await Decoder.isConfigSupported(candidate);if(signal?.aborted)throw signal.reason||Error('デコード設定の確認を中止しました');attempt.supported=support.supported;
   if(support.supported){decoder.configure(support.config);onAttempt(attempt);return{config:support.config,automaticColor:color>0};}
  }catch(e){if(signal?.aborted||decoder.state==='closed')throw e;lastError=e;attempt.error=e.message||String(e);}
  onAttempt(attempt);
 }
 const error=Error('この映像設定はWebCodecsでデコードできません（'+config.codec+'）。ハードウェア・ソフトウェア等の設定を確認しました'+(lastError?'：'+lastError.message:''));error.name='NotSupportedError';throw error;
}
export function verifyDecoderFrameColor(frame,expected){
 for(const [key,value]of Object.entries(expected||{}))if(frame.colorSpace?.[key]!==value)throw Error('自動デコードの色設定が原動画と一致しないため互換方式を使用します（'+key+'）');
}
