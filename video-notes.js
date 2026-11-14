/* 0.7.1 browser video scan. One reusable canvas; no frame history or audio upload. */
(()=>{'use strict';
const $=id=>document.getElementById(id),core=window.PianoRollNoteCore;
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
async function run(){
 if(controller)return;
 let snap,restore;try{snap=PianoRollVideoNotes.snapshot();restore=PianoRollVideoNotes.begin();}catch(e){$('noteScanStatus').textContent=e.message;return;}
 const ctrl=controller=new AbortController(),signal=ctrl.signal,video=snap.video,original=video.currentTime,fps=Number($('noteScanFps').value),duration=video.duration;
 const locked=Array.from(document.querySelector('main').children).filter(el=>el!==$('noteScanRun').closest('section')).map(el=>[el,el.inert]);for(const [el]of locked)el.inert=true;
 notify();
 const oldDetails=$('notes').closest('details');oldDetails.inert=true;$('noteScanSetup').disabled=true;$('noteScanResults').inert=true;$('noteScanRun').disabled=true;$('noteScanCancel').hidden=false;$('noteScanProgress').hidden=false;$('noteScanProgress').value=0;$('noteScanExport').disabled=true;
 try{
  const total=Math.ceil(duration*fps);if(!Number.isSafeInteger(total)||total>1000000)throw Error('動画が長すぎます。短い動画に分けてください。');
  const lanes=snap.lanes.filter(l=>Number.isInteger(l.pitch)&&l.pitch>=0&&l.pitch<=127);
  if(!lanes.length)throw Error('有効な音高の鍵盤ガイドがありません。基準鍵を確認してください。');
  const unique=new Set(lanes.map(l=>l.pitch));if(unique.size!==lanes.length)throw Error('鍵盤ガイドの音高が重複しています。基準鍵を確認してください。');
  const canvas=document.createElement('canvas');canvas.width=snap.width;canvas.height=snap.height;const ctx=canvas.getContext('2d',{willReadFrequently:true});
  const tracker=new core.Tracker({fps,duration});
  for(let i=0;i<total;i++){
   check(signal);if(PianoRollMainData.getActiveFile()!==snap.file)throw Error('動画が変更されたため中断しました。');
   const time=i/fps;await seek(video,time,signal);check(signal);
   ctx.drawImage(video,0,0,snap.width,snap.height);
   let row=ctx.getImageData(0,snap.hitLineY,snap.width,1).data;
   // Some decoders report readyState>=2 before the first image can be drawn.
   // Re-seek once instead of treating a transparent initial canvas as silence.
   if(i===0&&!row.some((v,k)=>k%4===3&&v>0)){
    await seek(video,Math.min(duration/2,1/(fps*2)),signal);await seek(video,0,signal);check(signal);
    ctx.drawImage(video,0,0,snap.width,snap.height);row=ctx.getImageData(0,snap.hitLineY,snap.width,1).data;
   }
   tracker.push(time,core.detectRow(row,snap.width,lanes));
   if(i%10===0||i===total-1){$('noteScanProgress').value=(i+1)/total;$('noteScanStatus').textContent=`抽出中 ${Math.round(100*(i+1)/total)}% · ${time.toFixed(1)} / ${duration.toFixed(1)}秒`;await new Promise(r=>setTimeout(r,0));}
  }
  check(signal);
  result={format:'pianoroll-video-notes-seconds-v1',applicationVersion:'0.7.1',source:{name:snap.file.name,size:snap.file.size,durationSeconds:duration},sampling:{samplesPerSecond:fps,intervalSeconds:1/fps,framesProcessed:total,minimumConsecutiveSamples:2},hitLine:{yPixels:snap.hitLineY,width:snap.width,height:snap.height},guide:{...snap.guide,reference:snap.reference,lanes},notes:tracker.finish(),discardedSingleSampleCandidates:tracker.discarded,notice:'Unverified visual candidates. Times refer to hit-line crossings, not beat quantization. No sustain or MIDI export.'};page=0;stale=false;render();
  const truncated=result.notes.filter(n=>n.truncatedStart||n.truncatedEnd).length;
  $('noteScanStatus').textContent=`抽出完了：${result.notes.length}音。${truncated?`動画の端で途切れた候補 ${truncated}音。`:''}音名を押すと開始位置を確認できます。`;
 }catch(e){$('noteScanStatus').textContent=e.name==='AbortError'?'抽出を中止しました。前回の結果がある場合は保持しています。':'抽出できません：'+e.message;}
 finally{
  if(PianoRollMainData.getActiveFile()===snap.file){try{await seek(video,Math.min(original,Math.max(0,duration-.0001)),new AbortController().signal);}catch(_){}}
  restore();controller=null;for(const [el,value]of locked)el.inert=value;
  oldDetails.inert=false;$('noteScanSetup').disabled=false;$('noteScanResults').inert=false;$('noteScanRun').disabled=false;$('noteScanCancel').hidden=true;$('noteScanExport').disabled=!result||stale;notify();
 }
}
$('noteScanRun').onclick=run;$('noteScanCancel').onclick=()=>controller?.abort();
$('noteScanExport').onclick=()=>{if(!result||stale)return;const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='pianoroll-video-notes-v0.7.1.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('file').addEventListener('change',()=>{controller?.abort();result=null;stale=false;page=0;render();$('noteScanRun').disabled=true;$('noteScanStatus').textContent='新しい動画を読み込んでいます。鍵盤ガイドと音名を合わせてください。';});
$('v').addEventListener('loadeddata',()=>{if(!controller){$('noteScanRun').disabled=false;$('noteScanStatus').textContent='鍵盤ガイドと基準鍵の音名を合わせてから抽出してください。';}});
window.PianoRollVideoNoteScan={getResult:()=>result?JSON.parse(JSON.stringify(result)):null,getState:()=>({hasResult:!!result,stale,running:!!controller}),get running(){return !!controller}};
const guideSection=$('refName').closest('section');
function checkGuide(){if(!result||controller)return;try{const snap=PianoRollVideoNotes.snapshot(),before=JSON.stringify(result.guide),after=JSON.stringify({...snap.guide,reference:snap.reference,lanes:snap.lanes.filter(l=>l.pitch>=0&&l.pitch<=127)});const wasStale=stale;stale=before!==after;$('noteScanExport').disabled=stale;if(stale)$('noteScanStatus').textContent='鍵盤ガイドを変更しました。前の結果は再抽出するまで保存できません。';else if(wasStale)$('noteScanStatus').textContent=`前回の鍵盤設定に戻しました。${result.notes.length}音の結果を保存できます。`;if(wasStale!==stale)notify();}catch(_){}}
guideSection.addEventListener('change',checkGuide);guideSection.addEventListener('pointerup',checkGuide);
$('noteScanRun').disabled=$('v').readyState<2;
render();
})();
