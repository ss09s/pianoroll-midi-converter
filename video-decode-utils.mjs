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
