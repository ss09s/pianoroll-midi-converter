/* 0.7.26 browser video scan. One reusable canvas; no frame history or audio upload. */
(()=>{'use strict';
const $=id=>document.getElementById(id),core=window.PianoRollNoteCore,motion=window.PianoRollMotionCore,readerCore=window.PianoRollFrameReader,scriptBase=document.currentScript?.src||document.baseURI;
let controller=null,result=null,page=0,stale=false;
const abort=()=>new DOMException('中止しました','AbortError');
function check(signal){if(signal.aborted)throw abort();}
function seek(video,time,signal){return new Promise((resolve,reject)=>{
 check(signal);let timer;
 const cleanup=()=>{clearTimeout(timer);video.removeEventListener('seeked',done);video.removeEventListener('error',failed);signal.removeEventListener('abort',cancel);};
 const done=()=>{if(video.readyState<2){failed();return;}cleanup();resolve();};
 const failed=()=>{cleanup();reject(Error('動画のフレームを取得できませんでした。'))};
 const cancel=()=>{cleanup();reject(abort());};
 video.pause();if(Math.abs(video.currentTime-time)<1e-7&&video.readyState>=2){resolve();return;}
 video.addEventListener('seeked',done);video.addEventListener('error',failed);signal.addEventListener('abort',cancel,{once:true});
 timer=setTimeout(()=>{cleanup();reject(Error('動画の移動がタイムアウトしました。形式・読み込み状況を確認してください。'));},12000);
 try{video.currentTime=time;}catch(e){cleanup();reject(e);}
});}
function notify(){window.dispatchEvent(new CustomEvent('pianoroll-notes-change'));}
function render(){
 const notes=result?.notes||[],body=$('noteScanTable').tBodies[0];body.replaceChildren();page=Math.max(0,Math.min(page,Math.max(0,Math.ceil(notes.length/50)-1)));
 for(const note of notes.slice(page*50,(page+1)*50)){
  const tr=document.createElement('tr'),cell=document.createElement('td'),button=document.createElement('button');button.type='button';button.className='secondary';button.textContent=note.noteName;button.title='開始位置を動画で確認';button.onclick=()=>{const video=$('v');video.pause();video.currentTime=note.startSeconds;$('v').scrollIntoView({block:'center',behavior:'smooth'});};cell.append(button);tr.append(cell);
  for(const n of [note.startSeconds,note.endSeconds,note.durationSeconds]){const td=document.createElement('td');td.textContent=n.toFixed(3);tr.append(td);}body.append(tr);
 }
 const host=$('noteScanPage');host.replaceChildren();
 for(const [text,delta] of [['前へ',-1],['次へ',1]]){const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent=text;b.disabled=!notes.length||delta<0&&page===0||delta>0&&(page+1)*50>=notes.length;b.onclick=()=>{page+=delta;render();};host.append(b);}
 const count=document.createElement('span');count.textContent=`${notes.length}音 / ${notes.length?page+1:0}ページ目`;host.append(count);$('noteScanExport').disabled=!result||stale;notify();
}
function scanWorker(snap,lanes,fps,duration,signal,progress){return new Promise((resolve,reject)=>{
 check(signal);if(typeof Worker!=='function'||typeof OffscreenCanvas!=='function'){reject(Error('Worker画像処理に非対応です'));return;}
 let worker,timer,settled=false;
 const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',cancel);if(worker){worker.onmessage=null;worker.onerror=null;worker.terminate();}error?reject(error):resolve(value);};
 const cancel=()=>finish(abort()),arm=()=>{clearTimeout(timer);timer=setTimeout(()=>finish(Error('高速方式の応答がタイムアウトしました')),20000);};
 signal.addEventListener('abort',cancel,{once:true});
 try{
  worker=new Worker(new URL('video-scan-worker.mjs?v=0.7.26',scriptBase),{type:'module'});arm();
  worker.onerror=e=>{e.preventDefault();finish(Error('高速方式を読み込めません。Worker・追加ファイルの対応を確認してください'));};
  worker.onmessage=({data})=>{arm();if(data.type==='progress')progress(data.processed,data.total);else if(data.type==='result')finish(null,data);else if(data.type==='error')finish(Object.assign(Error(data.message),{diagnostics:data.diagnostics}));};
  let colorSpace;const probe=new VideoFrame(snap.video,{timestamp:0});try{colorSpace=probe.colorSpace.toJSON();}finally{probe.close();}
  worker.postMessage({type:'scan',colorSpace,file:snap.file,width:snap.width,height:snap.height,hitLineY:snap.hitLineY,detectionMode:snap.detectionMode,primaryPercent:snap.primaryPercent,lanes,fps,duration});
 }catch(e){finish(e);}
});}
async function scanCompat(snap,lanes,fps,duration,signal,progress){
 const video=snap.video,total=Math.ceil(duration*fps),canvas=document.createElement('canvas');
 const tracker=motion.createScan({width:snap.width,height:snap.height,hitLineY:snap.hitLineY,lanes,fps,duration,mode:snap.detectionMode,primaryPercent:snap.primaryPercent}),reader=readerCore.createReader(canvas,snap.width,snap.height,tracker.lines),detect=tracker.detect,metrics={engine:'video-seek',seekMs:0,imageMs:0,drawMs:0,pixelReadMs:0,trackingMs:0,detectMs:0,frames:total},started=performance.now();let lastProgress=started;
 for(let i=0;i<total;i++){
  check(signal);if(PianoRollMainData.getActiveFile()!==snap.file)throw Error('動画が変更されたため中断しました。');
  const time=i/fps,seekStart=performance.now();await seek(video,time,signal);check(signal);metrics.seekMs+=performance.now()-seekStart;let rows=reader.read(video,null,null,metrics);
  if(i===0&&!rows.some(row=>row.some((v,k)=>k%4===3&&v>0))){await seek(video,Math.min(duration/2,1/(fps*2)),signal);await seek(video,0,signal);check(signal);rows=reader.read(video,null,null,metrics);}
  const detectStart=performance.now();const hits=rows.map(detect);metrics.detectMs+=performance.now()-detectStart;const trackingStart=performance.now();tracker.push(time,hits);metrics.trackingMs+=performance.now()-trackingStart;
  if(performance.now()-lastProgress>=100||i===total-1){lastProgress=performance.now();progress(i+1,total,`${time.toFixed(1)} / ${duration.toFixed(1)}秒`);await new Promise(r=>setTimeout(r,0));}
 }
 check(signal);const finishStart=performance.now(),final=tracker.finish();metrics.fusionMs=performance.now()-finishStart;metrics.totalMs=performance.now()-started;return {...final,metrics};
}
async function run(){
 if(controller)return;
 let snap,restore,completed=false;try{snap=PianoRollVideoNotes.snapshot();snap.detectionMode=['motion','upper'].includes($('noteScanDetection')?.value)?$('noteScanDetection').value:'single';snap.colorMode=$('noteScanColor')?.value||'two';snap.primaryPercent=Math.max(3,Math.min(65,Number($('noteScanPrimaryHeight')?.value)||20));restore=PianoRollVideoNotes.begin();}catch(e){$('noteScanStatus').textContent=e.message;return;}
 const ctrl=controller=new AbortController(),signal=ctrl.signal,video=snap.video,original=video.currentTime,fps=Number($('noteScanFps').value),duration=video.duration;
 const locked=Array.from(document.querySelector('main').children).filter(el=>el!==$('noteScanRun').closest('section')).map(el=>[el,el.inert]);for(const [el]of locked)el.inert=true;
 notify();
 const oldDetails=$('notes').closest('details');oldDetails.inert=true;$('noteScanSetup').disabled=true;$('noteScanResults').inert=true;$('noteScanRun').disabled=true;$('noteScanCancel').hidden=false;$('noteScanProgress').hidden=false;$('noteScanProgress').value=0;$('noteScanExport').disabled=true;
 try{
  const total=Math.ceil(duration*fps);if(!Number.isSafeInteger(total)||total>1000000)throw Error('動画が長すぎます。短い動画に分けてください。');
  const lanes=snap.lanes.filter(l=>Number.isInteger(l.pitch)&&l.pitch>=0&&l.pitch<=127);
  if(!lanes.length)throw Error('有効な音高の鍵盤ガイドがありません。基準鍵を確認してください。');
  const unique=new Set(lanes.map(l=>l.pitch));if(unique.size!==lanes.length)throw Error('鍵盤ガイドの音高が重複しています。基準鍵を確認してください。');
  const progress=(processed,total,label)=>{$('noteScanProgress').value=processed/total;$('noteScanStatus').textContent=`抽出中 ${Math.round(100*processed/total)}% · ${label}`;};
  const wallStart=performance.now();let extraction,fallbackReason=null,fallbackDiagnostics=null;
  const modeInfo=$('noteScanModeInfo');if(modeInfo){modeInfo.hidden=false;modeInfo.textContent=($('noteScanEngine')?.value==='compat')?'互換方式で抽出中です。':'高速方式への対応を確認しています…';}
  if(($('noteScanEngine')?.value||'auto')!=='compat'){
   try{extraction=await scanWorker(snap,lanes,fps,duration,signal,(n,total)=>progress(n,total,'連続デコード'));}
   catch(e){check(signal);fallbackReason=e.message;fallbackDiagnostics=e.diagnostics??null;if(modeInfo)modeInfo.textContent='互換方式に切り替えました：'+fallbackReason;$('noteScanStatus').textContent='互換方式で解析します…';}
  }
  if(!extraction)extraction=await scanCompat(snap,lanes,fps,duration,signal,progress);
  check(signal);if(PianoRollMainData.getActiveFile()!==snap.file)throw Error('動画が変更されたため中断しました。');
  const colorStart=performance.now(),colorResult=core.normalizeColors(extraction.notes,snap.colorMode);extraction.notes=colorResult.notes;const colorMs=performance.now()-colorStart;
  const metrics={colorMs,...extraction.metrics,wallMs:performance.now()-wallStart,fallbackReason,fallbackDiagnostics};
  result={colorMode:snap.colorMode,colorPalette:colorResult.palette,unclassifiedColors:colorResult.unclassified,performance:metrics,format:'pianoroll-video-notes-seconds-v1',applicationVersion:'0.7.26',detectionMode:snap.detectionMode,primaryPercent:snap.primaryPercent,source:{name:snap.file.name,size:snap.file.size,durationSeconds:duration},detection:extraction.diagnostics||{method:snap.detectionMode},sampling:{samplesPerSecond:fps,intervalSeconds:1/fps,framesProcessed:total,minimumConsecutiveSamples:2},hitLine:{yPixels:snap.hitLineY,width:snap.width,height:snap.height},guide:{...snap.guide,reference:snap.reference,lanes},notes:extraction.notes,unconfirmedNotes:extraction.unconfirmedNotes||[],discardedSingleSampleCandidates:extraction.discarded,notice:'Unverified visual candidates. Times refer to hit-line crossings, not beat quantization. No sustain or MIDI export.'};page=0;stale=false;$('noteScanProgress').value=1;render();
  window.PianoRollPerformance?.show(result);
  if($('noteScanDiagnostics'))$('noteScanDiagnostics').textContent=JSON.stringify({source:result.source,performance:metrics,detection:result.detection,browser:navigator.userAgent,logicalProcessors:navigator.hardwareConcurrency??null,workerSupported:typeof Worker==='function',videoDecoderSupported:typeof VideoDecoder==='function',note:'Logical processor count does not prove decoder parallelism. Hardware decoding use is not exposed.'},null,2);
  if(modeInfo&&!fallbackReason)modeInfo.textContent=metrics.engine==='webcodecs-worker'?'高速方式で抽出しました（'+metrics.codec+'）。':'互換方式で抽出しました。';
  const d=result.detection;if(modeInfo&&d.method==='dense-primary-calibration')modeInfo.textContent+=' 上側候補：'+d.primaryCandidates+'音、速度確認：'+d.motionTracks+'音、時刻補正：'+(d.offsetRangeSeconds||[d.offsetSeconds,d.offsetSeconds]).map(v=>v.toFixed(3)).join('〜')+'秒（'+d.correctedCandidates+'音）。'+d.warning;
  if(modeInfo&&d.method==='upper-single')modeInfo.textContent+=' 時刻は上側線の通過時刻です。キーエディタの同期補正で原音に合わせられます。';
  if(modeInfo)modeInfo.textContent+=' 色分類：'+result.colorPalette.length+'種類、未分類'+result.unclassifiedColors+'音。';
  if(modeInfo&&d.edgeRefined!==undefined)modeInfo.textContent+=' 先端・末端の再推定：'+d.edgeRefined+'音、連打分離：'+d.splitCandidates+'候補→'+d.splitNotes+'音。';
  if(modeInfo&&d.localSplitCandidates!==undefined)modeInfo.textContent+=' 主線周辺の面で連打分離：'+d.localSplitCandidates+'候補→'+d.localSplitNotes+'音。';
  const truncated=result.notes.filter(n=>n.truncatedStart||n.truncatedEnd).length;
  $('noteScanStatus').textContent=`抽出完了：${result.notes.length}音（${metrics.engine==='webcodecs-worker'?'高速方式':'互換方式'}・${(metrics.wallMs/1000).toFixed(1)}秒）。${truncated?`動画の端で途切れた候補 ${truncated}音。`:''}音名を押すと開始位置を確認できます。`;completed=true;
 }catch(e){const info=$('noteScanModeInfo');if(info)info.textContent=e.name==='AbortError'?'処理を中止しました。':'処理に失敗しました：'+e.message;$('noteScanStatus').textContent=e.name==='AbortError'?'抽出を中止しました。前回の結果がある場合は保持しています。':'抽出できません：'+e.message;}
 finally{
  if(PianoRollMainData.getActiveFile()===snap.file){try{await seek(video,Math.min(original,Math.max(0,duration-.0001)),new AbortController().signal);}catch(_){}}
  restore();controller=null;for(const [el,value]of locked)el.inert=value;
  oldDetails.inert=false;$('noteScanSetup').disabled=false;$('noteScanResults').inert=false;$('noteScanRun').disabled=false;$('noteScanCancel').hidden=true;$('noteScanExport').disabled=!result||stale;notify();if(completed)window.dispatchEvent(new CustomEvent('pianoroll-notes-ready'));
 }
}
$('noteScanRun').onclick=run;$('noteScanCancel').onclick=()=>controller?.abort();
$('noteScanExport').onclick=()=>{if(!result||stale)return;const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='pianoroll-video-notes-v0.7.26.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('file').addEventListener('change',()=>{window.PianoRollPerformance?.clear();if($('noteScanModeInfo')){$('noteScanModeInfo').hidden=true;$('noteScanModeInfo').textContent='';}if($('noteScanDiagnostics'))$('noteScanDiagnostics').textContent='抽出後に表示します。';controller?.abort();result=null;stale=false;page=0;render();$('noteScanRun').disabled=true;$('noteScanStatus').textContent='新しい動画を読み込んでいます。鍵盤ガイドと音名を合わせてください。';});
$('v').addEventListener('loadeddata',()=>{if(!controller){$('noteScanRun').disabled=false;$('noteScanStatus').textContent='鍵盤ガイドと基準鍵の音名を合わせてから抽出してください。';}});
window.PianoRollVideoNoteScan={shiftTiming:seconds=>{if(!result||controller||stale||!Number.isFinite(seconds)||Math.abs(seconds)>10)return false;const delta=seconds-(result.timingAdjustmentSeconds||0);result.notes=result.notes.map(n=>({...n,startSeconds:n.startSeconds+delta,endSeconds:n.endSeconds+delta}));result.timingAdjustmentSeconds=seconds;render();return true;},replaceNotes:notes=>{if(!result||controller||stale)return false;result.notes=JSON.parse(JSON.stringify(notes));page=0;render();$('noteScanStatus').textContent=`編集済み：${result.notes.length}音。`;return true;},getResult:()=>result?JSON.parse(JSON.stringify(result)):null,getState:()=>({hasResult:!!result,stale,running:!!controller}),get running(){return !!controller}};
const guideSection=$('refName').closest('section');
function checkGuide(){
 if(!result||controller)return;
 const mode=['motion','upper'].includes($('noteScanDetection')?.value)?$('noteScanDetection').value:'single',percent=Math.max(3,Math.min(65,Number($('noteScanPrimaryHeight')?.value)||20)),wasStale=stale;
 let guideChanged=false;try{const snap=PianoRollVideoNotes.snapshot();guideChanged=JSON.stringify(result.guide)!==JSON.stringify({...snap.guide,reference:snap.reference,lanes:snap.lanes.filter(l=>l.pitch>=0&&l.pitch<=127)});}catch(_){guideChanged=true;}
 stale=(result.colorMode||'two')!==($('noteScanColor')?.value||'two')||guideChanged||(result.detectionMode||'single')!==mode||(result.detectionMode!=='single'&&(result.primaryPercent||20)!==percent);
 $('noteScanExport').disabled=stale;
 if(stale)$('noteScanStatus').textContent='鍵盤ガイド・主判定線・検出方法を変更しました。前の結果は再抽出するまで保存できません。';
 else if(wasStale)$('noteScanStatus').textContent=`前回の設定に戻しました。${result.notes.length}音の結果を保存できます。`;
 if(wasStale!==stale)notify();
}
$('noteScanColor')?.addEventListener('change',checkGuide);$('noteScanPrimaryHeight')?.addEventListener('input',checkGuide);$('noteScanPrimaryHeight')?.addEventListener('change',checkGuide);$('noteScanDetection')?.addEventListener('change',checkGuide);guideSection.addEventListener('change',checkGuide);guideSection.addEventListener('pointerup',checkGuide);
$('noteScanRun').disabled=$('v').readyState<2;
render();
})();
