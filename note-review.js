/* 0.7.2: read-only seconds-based piano roll, synchronized with the original video. */
(()=>{'use strict';
const $=id=>document.getElementById(id),video=$('v'),core=PianoRollNoteCore,scan=PianoRollVideoNoteScan;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const openButton=document.createElement('button');openButton.id='noteReviewOpen';openButton.type='button';openButton.textContent='キーエディターで確認';openButton.disabled=true;$('noteScanExport').after(openButton);
const panel=document.createElement('details');panel.id='noteReview';panel.className='note-review';panel.innerHTML=`<summary>原動画と抽出ノートを比較</summary><div class="nr-body">
<div class="nr-warning" id="nrWarning" hidden></div><div class="nr-layout"><div class="nr-video" id="nrVideo"></div><div class="nr-editor">
<div class="nr-controls"><button id="nrPlay" type="button">▶ 再生</button><button id="nrStop" class="secondary" type="button">■ 停止</button><button id="nrPrev" class="secondary" type="button" aria-label="指定fpsで1コマ戻る">−1コマ</button><button id="nrNext" class="secondary" type="button" aria-label="指定fpsで1コマ進む">＋1コマ</button><output class="nr-time" id="nrTime">0.00秒</output></div>
<div class="nr-controls"><label>聴き方<select id="nrMode"><option value="both">原曲 ＋ 抽出音</option><option value="video">原曲のみ</option><option value="notes">抽出音のみ</option></select></label><label>表示範囲<select id="nrZoom"><option value="4">4秒</option><option value="8" selected>8秒</option><option value="16">16秒</option><option value="all">全体</option></select></label></div>
<div class="nr-controls nr-view-tools"><button type="button" id="nrFollowButton" aria-pressed="true">追従 オン</button><span>縦ズーム</span><button type="button" class="secondary" id="nrPitchOut" aria-label="音高表示を縮小">−</button><button type="button" class="secondary" id="nrPitchIn" aria-label="音高表示を拡大">＋</button></div><div class="nr-ruler"><canvas id="nrRuler" aria-hidden="true"></canvas></div><div class="nr-scroll" id="nrScroll"><div class="nr-surface" id="nrSurface"><canvas id="nrRoll" role="img" aria-label="抽出ノートのピアノロール。縦は音高、横は秒。ノートまたは時間位置をタップして選択します。"></canvas><div id="nrCursor" class="nr-cursor" aria-hidden="true"></div></div></div>
<label class="nr-pan" hidden>表示位置<input id="nrPan" type="range" min="0" max="1" step="0.01" value="0"/><span id="nrRange">0–8秒</span></label>
</div></div><output class="nr-selected" id="nrSelected" aria-live="polite">ノートをタップすると、音高・開始・終了・長さを確認できます。</output>
<div id="nrAudioNotice" class="nr-warning" hidden></div><details class="nr-settings"><summary>再生・表示の設定</summary><div class="nr-options"><label>再生速度<select id="nrRate"><option value=".25">0.25倍</option><option value=".5">0.5倍</option><option value="1" selected>通常</option><option value="1.5">1.5倍</option><option value="2">2倍</option></select></label><label>コマ送りの基準fps<select id="nrFps"><option value="30">30 fps</option><option value="60">60 fps</option></select></label><label>抽出音の音量<input id="nrVolume" type="range" min="0" max="100" value="50"/></label><label><span>再生位置に追従</span><input id="nrFollow" type="checkbox" checked/></label></div><p class="nr-help">コマ送りは指定fpsの間隔です。元動画に合わせてください。抽出音は確認用の簡易音源です。</p></details><p class="nr-help">縦は音高、横は秒。指で上下左右にスクロールできます。オレンジの線が再生位置。ノートをタップすると一時停止して開始位置へ移動します。編集・拍への量子化は行いません。</p></div>`;
$('noteScanResults').before(panel);
const home=document.createComment('original video position');video.before(home);
let data=null,notes=[],duration=0,pitchMin=48,pitchMax=72,viewStart=0,span=8,width=340,keyW=44,rowH=16,selected=null,hitRects=[];
let ctx=null,master=null,limiter=null,raf=null,buffering=false,starting=false,token=0,nextNote=0,needsActive=true,seen=new Set(),clock=null,oldVideo=null,lastText=0;
const voices=new Map();
function stopSound(){
 for(const {osc,gain} of voices.values()){try{osc.stop();osc.disconnect();gain.disconnect();}catch(_){}}
 voices.clear();seen.clear();nextNote=0;needsActive=true;clock=null;
}
async function audioReady(){
 if($('nrMode').value==='video')return;
 if(!ctx){const AC=window.AudioContext||window.webkitAudioContext;ctx=new AC();master=ctx.createGain();master.gain.value=Number($('nrVolume').value)/100;limiter=ctx.createDynamicsCompressor();limiter.threshold.value=-18;limiter.ratio.value=6;master.connect(limiter);limiter.connect(ctx.destination);}
 await ctx.resume();$('nrAudioNotice').hidden=ctx.state==='running';
}
function voice(note,time,rate){
 if(seen.has(note.id)||note.endSeconds<=time||!ctx||ctx.state!=='running')return;
 seen.add(note.id);const when=ctx.currentTime+Math.max(0,(note.startSeconds-time)/rate),end=ctx.currentTime+Math.max(.008,(note.endSeconds-time)/rate);
 const osc=ctx.createOscillator(),gain=ctx.createGain();osc.type='triangle';osc.frequency.value=440*Math.pow(2,(note.midiPitch-69)/12);
 gain.gain.setValueAtTime(0,when);gain.gain.linearRampToValueAtTime(.13,when+.004);gain.gain.setValueAtTime(.09,Math.min(end,when+.08));gain.gain.linearRampToValueAtTime(0,end+.008);
 osc.connect(gain);gain.connect(master);voices.set(note.id,{osc,gain});osc.onended=()=>{if(voices.get(note.id)?.osc===osc)voices.delete(note.id);try{osc.disconnect();gain.disconnect();}catch(_){}};osc.start(when);osc.stop(end+.012);
}
function schedule(){
 if(!panel.open||video.paused||video.seeking||buffering||document.hidden||$('nrMode').value==='video'||!ctx||ctx.state!=='running')return;
 const t=video.currentTime,rate=video.playbackRate;
 if(clock&&(rate!==clock.rate||Math.abs(t-(clock.t+(ctx.currentTime-clock.a)*rate))>.12))stopSound();
 clock={t,a:ctx.currentTime,rate};
 if(needsActive){for(const note of notes)if(note.startSeconds<t&&note.endSeconds>t)voice(note,t,rate);let a=0,b=notes.length;while(a<b){const m=(a+b)>>1;if(notes[m].startSeconds<t)a=m+1;else b=m;}nextNote=a;needsActive=false;}
 const horizon=t+.10*rate;
 while(nextNote<notes.length&&notes[nextNote].startSeconds<=horizon)voice(notes[nextNote++],t,rate);
}
function canvas(id,w,h){const can=$(id),dpr=Math.min(2,window.devicePixelRatio||1);can.width=Math.round(w*dpr);can.height=Math.round(h*dpr);can.style.width=w+'px';can.style.height=h+'px';const g=can.getContext('2d');g.setTransform(dpr,0,0,dpr,0,0);return g;}
let pixelsPerSecond=40,scrollFrame=null;
function followState(){const on=$('nrFollow').checked;$('nrFollowButton').textContent=on?'追従 オン':'追従する';$('nrFollowButton').setAttribute('aria-pressed',String(on));}
function render(){
 if(!panel.open||!data)return;
 const viewport=$('nrScroll');width=Math.max(240,viewport.clientWidth||340);span=$('nrZoom').value==='all'?duration:Math.min(duration,Number($('nrZoom').value));span=Math.max(.001,span);
 const plot=width-keyW-10;pixelsPerSecond=plot/span;const fullHeight=(pitchMax-pitchMin+1)*rowH;
 $('nrSurface').style.width=(width+(duration-span)*pixelsPerSecond)+'px';$('nrSurface').style.height=Math.max(viewport.clientHeight,fullHeight)+'px';
 viewStart=viewport.scrollLeft/pixelsPerSecond;const offsetY=viewport.scrollTop,h=viewport.clientHeight,g=canvas('nrRoll',width,h),r=canvas('nrRuler',width,27);
 $('nrRoll').style.left=viewport.scrollLeft+'px';$('nrRoll').style.top=offsetY+'px';
 g.fillStyle='#fff';g.fillRect(0,0,width,h);g.font=Math.min(11,rowH-2)+'px system-ui';
 for(let pitch=pitchMax;pitch>=pitchMin;pitch--){const y=(pitchMax-pitch)*rowH-offsetY,black=[1,3,6,8,10].includes(pitch%12);g.fillStyle=black?'#edf1f6':'#fafcff';g.fillRect(keyW,y,width-keyW,rowH);g.strokeStyle='#dfe6ee';g.beginPath();g.moveTo(0,y+rowH);g.lineTo(width,y+rowH);g.stroke();g.fillStyle=black?'#26334b':'white';g.fillRect(0,y,keyW,rowH);g.fillStyle=black?'white':'#4b6079';g.fillText(core.noteName(pitch),4,y+Math.min(12,rowH-1));}
 r.fillStyle='#f0f4fa';r.fillRect(0,0,width,27);r.font='11px system-ui';r.fillStyle='#61758e';r.fillText('音高',5,18);
 const step=span<=4?.5:span<=8?1:span<=16?2:Math.ceil(span/7);
 for(let t=Math.ceil(viewStart/step)*step;t<=viewStart+span+.0001;t+=step){const x=keyW+(t-viewStart)/span*plot;g.strokeStyle='#d7e1ee';g.beginPath();g.moveTo(x,0);g.lineTo(x,h);g.stroke();r.fillStyle='#61758e';r.fillText(t.toFixed(step<1?1:0)+'s',Math.min(width-28,x+3),18);}
 hitRects=[];g.save();g.beginPath();g.rect(keyW,0,plot+1,h);g.clip();
 for(const note of notes){if(note.startSeconds>viewStart+span)break;if(note.endSeconds<viewStart)continue;const x=keyW+(note.startSeconds-viewStart)/span*plot,y=(pitchMax-note.midiPitch)*rowH+2-offsetY,w=Math.max(2,(note.endSeconds-note.startSeconds)/span*plot);const color=note.colorRGB||[67,139,218];g.fillStyle=`rgb(${color[0]},${color[1]},${color[2]})`;g.fillRect(x,y,w,rowH-4);g.strokeStyle=note.id===selected?'#c56a0b':'#3d648c';g.lineWidth=note.id===selected?2:1;g.strokeRect(x+.5,y+.5,w-1,rowH-5);if(w>33&&rowH>=14){g.fillStyle='#172b45';g.font='10px system-ui';g.fillText(note.noteName||core.noteName(note.midiPitch),x+3,y+10);}hitRects.push({id:note.id,x,y,w,h:rowH-4});}
 g.restore();$('nrRange').textContent=`${viewStart.toFixed(1)}–${(viewStart+span).toFixed(1)}秒`;$('nrPan').max=String(Math.max(0,duration-span));$('nrPan').value=String(viewStart);$('nrPan').disabled=duration<=span;followState();paintCursor();
}
function paintCursor(){
 const t=video.currentTime,viewport=$('nrScroll');
 $('nrCursor').hidden=!panel.open||t<viewStart||t>viewStart+span;
 $('nrCursor').style.left=(viewport.scrollLeft+keyW+(t-viewStart)*pixelsPerSecond)+'px';$('nrCursor').style.top=viewport.scrollTop+'px';$('nrCursor').style.height=viewport.clientHeight+'px';
 if(performance.now()-lastText>80||video.paused){$('nrTime').textContent=`${t.toFixed(2)} / ${duration.toFixed(2)}秒`;lastText=performance.now();}
 $('nrPlay').textContent=video.paused?'▶ 再生':'⏸ 一時停止';
}
function cursor(force=false){
 const t=video.currentTime;
 if(panel.open&&$('nrFollow').checked&&(force||t<viewStart||t>viewStart+span*.88)){
  const target=clamp(t-span*.18,0,Math.max(0,duration-span));const left=target*pixelsPerSecond;if(Math.abs($('nrScroll').scrollLeft-left)>.5){$('nrScroll').scrollLeft=left;render();}else paintCursor();
 }else paintCursor();
}
function tick(){raf=null;if(!panel.open)return;cursor();schedule();if(!video.paused&&!video.ended)raf=requestAnimationFrame(tick);}
function wake(){if(panel.open&&raf===null)raf=requestAnimationFrame(tick);}
function seek(time){token++;starting=false;video.pause();stopSound();video.currentTime=clamp(time,0,duration);cursor();}
function selectAt(event){
 const rect=$('nrRoll').getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top;if(x<keyW)return;
 let hit=null;for(const candidate of hitRects)if(x>=Math.max(keyW,candidate.x)-2&&x<=candidate.x+Math.max(4,candidate.w)+2&&y>=candidate.y-2&&y<=candidate.y+candidate.h+2){hit=candidate;break;}
 if(hit){selected=hit.id;const note=notes.find(n=>n.id===selected);seek(note.startSeconds);$('nrSelected').textContent=`${note.noteName} / MIDI ${note.midiPitch} · 開始 ${note.startSeconds.toFixed(3)}秒 → 終了 ${note.endSeconds.toFixed(3)}秒 · 長さ ${note.durationSeconds.toFixed(3)}秒${note.truncatedStart||note.truncatedEnd?'（動画の端で途切れた候補）':''}`;}
 else{selected=null;seek(viewStart+clamp((x-keyW)/(width-keyW-10),0,1)*span);$('nrSelected').textContent=`${video.currentTime.toFixed(3)}秒へ移動しました。ノートを選ぶと詳細を確認できます。`;}
 render();
}
let pointer=null;
const viewport=$('nrScroll');
viewport.addEventListener('pointerdown',e=>{pointer={x:e.clientX,y:e.clientY,left:viewport.scrollLeft,top:viewport.scrollTop,id:e.pointerId,moved:false};});
viewport.addEventListener('pointermove',e=>{if(!pointer)return;const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;if(Math.hypot(dx,dy)>6){pointer.moved=true;$('nrFollow').checked=false;followState();if(e.pointerType==='mouse'){viewport.setPointerCapture(e.pointerId);viewport.scrollLeft=pointer.left-dx;viewport.scrollTop=pointer.top-dy;}}});
viewport.addEventListener('pointercancel',()=>{if(pointer){$('nrFollow').checked=false;followState();}pointer=null;});
viewport.addEventListener('pointerup',e=>{if(pointer&&!pointer.moved)selectAt(e);pointer=null;});
viewport.addEventListener('wheel',()=>{$('nrFollow').checked=false;followState();},{passive:true});
viewport.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(e.key)){$('nrFollow').checked=false;followState();}});
viewport.tabIndex=0;viewport.setAttribute('aria-label','ノート表示。上下左右にスクロールできます');
viewport.addEventListener('scroll',()=>{if(scrollFrame===null)scrollFrame=requestAnimationFrame(()=>{scrollFrame=null;render();});},{passive:true});
$('nrFollowButton').onclick=()=>{$('nrFollow').checked=true;followState();cursor(true);};
function pitchZoom(delta){const old=rowH,center=viewport.scrollTop+viewport.clientHeight/2;rowH=clamp(rowH+delta,10,36);render();viewport.scrollTop=center/old*rowH-viewport.clientHeight/2;render();$('nrPitchOut').disabled=rowH<=10;$('nrPitchIn').disabled=rowH>=36;}
$('nrPitchOut').onclick=()=>pitchZoom(-2);$('nrPitchIn').onclick=()=>pitchZoom(2);
function applyMode(){if(panel.open)video.muted=$('nrMode').value==='notes';stopSound();wake();}
function close(){token++;starting=false;if(raf!==null){cancelAnimationFrame(raf);raf=null;}video.pause();stopSound();if(video.parentElement===$('nrVideo'))home.after(video);if(oldVideo){video.muted=oldVideo.muted;video.playbackRate=oldVideo.rate;oldVideo=null;}if(panel.open)panel.open=false;}
function onData(){
 const state=scan.getState();openButton.disabled=!state.hasResult||state.running;
 if(state.running||!state.hasResult){close();if(!state.hasResult){data=null;notes=[];selected=null;}return;}
 const next=scan.getResult();if(!data||data.source.name!==next.source.name||data.notes.length!==next.notes.length||JSON.stringify(data.notes)!==JSON.stringify(next.notes)){
  video.pause();stopSound();data=next;duration=next.source.durationSeconds;notes=next.notes.map((n,id)=>({...n,id})).sort((a,b)=>a.startSeconds-b.startSeconds||a.midiPitch-b.midiPitch);selected=null;viewStart=0;$('nrFollow').checked=true;followState();
  pitchMin=notes.length?Math.max(0,notes.reduce((p,n)=>Math.min(p,n.midiPitch),127)-2):48;pitchMax=notes.length?Math.min(127,notes.reduce((p,n)=>Math.max(p,n.midiPitch),0)+2):72;
  $('nrFps').value=String(next.sampling.samplesPerSecond===60?60:30);$('nrSelected').textContent=notes.length?'ノートをタップすると、音高・開始・終了・長さを確認できます。':'抽出結果は0音です。原動画を確認し、鍵盤ガイドや検出条件を見直してください。';
 }
 $('nrWarning').hidden=!state.stale;$('nrWarning').textContent='ガイドを変更しています。前回抽出した結果を表示中です。再抽出して比較してください。';render();
}
openButton.onclick=()=>{if(!data)return;panel.open=true;panel.scrollIntoView({block:'start',behavior:'smooth'});};
panel.addEventListener('toggle',()=>{
 if(!panel.open){close();return;}if(!data||scan.running){panel.open=false;return;}
 oldVideo={muted:video.muted,rate:video.playbackRate};video.pause();$('nrVideo').append(video);video.playbackRate=Number($('nrRate').value);applyMode();render();$('nrScroll').scrollTop=Math.max(0,((pitchMax-pitchMin+1)*rowH-$('nrScroll').clientHeight)/2);render();cursor(true);wake();
});
$('nrPlay').onclick=async()=>{
 if(!panel.open||!data||starting)return;if(!video.paused){token++;video.pause();stopSound();return;}
 starting=true;const serial=++token;
 try{PianoRollBeatPreview?.stop();await audioReady();if(serial!==token||!panel.open)return;applyMode();if(video.ended)video.currentTime=0;await video.play();if(serial!==token){video.pause();return;}wake();}
 catch(e){$('nrAudioNotice').hidden=false;$('nrAudioNotice').textContent='再生できません：'+e.message;stopSound();}
 finally{starting=false;cursor();}
};
$('nrStop').onclick=()=>seek(0);$('nrPrev').onclick=()=>seek(video.currentTime-1/Number($('nrFps').value));$('nrNext').onclick=()=>seek(video.currentTime+1/Number($('nrFps').value));
$('nrRate').onchange=()=>{if(panel.open)video.playbackRate=Number($('nrRate').value);stopSound();wake();};
$('nrMode').onchange=()=>{void audioReady().then(()=>{applyMode();wake();}).catch(e=>{$('nrAudioNotice').hidden=false;$('nrAudioNotice').textContent='抽出音を有効にできません：'+e.message;});};
$('nrVolume').oninput=()=>{if(master)master.gain.setValueAtTime(Number($('nrVolume').value)/100,ctx.currentTime);};
$('nrZoom').onchange=()=>{const wanted=$('nrZoom').value==='all'?duration:Number($('nrZoom').value);render();$('nrScroll').scrollLeft=Math.max(0,video.currentTime-wanted/2)*pixelsPerSecond;render();};$('nrPan').oninput=()=>{$('nrScroll').scrollLeft=Number($('nrPan').value)*pixelsPerSecond;$('nrFollow').checked=false;render();};$('nrFollow').onchange=()=>{followState();cursor(true);};
for(const event of ['pause','ended','seeking','ratechange','waiting'])video.addEventListener(event,()=>{if(event==='waiting')buffering=true;stopSound();cursor();if(!video.paused)wake();});
video.addEventListener('seeked',()=>{buffering=false;cursor();wake();});video.addEventListener('playing',()=>{buffering=false;wake();if(panel.open&&$('nrMode').value!=='video')void audioReady().catch(()=>{});});video.addEventListener('timeupdate',()=>{if(panel.open)cursor();});
document.addEventListener('visibilitychange',()=>{stopSound();if(!document.hidden)wake();});
window.addEventListener('pianoroll-notes-change',onData);window.addEventListener('pagehide',()=>{close();if(ctx)void ctx.close();ctx=null;});
new ResizeObserver(()=>{if(panel.open)render();}).observe($('nrScroll'));
window.PianoRollNoteReview={getState:()=>({open:panel.open,timeSeconds:video.currentTime,selectedNote:selected,noteCount:notes.length,viewStartSeconds:viewStart,viewSpanSeconds:span,pitchMin,pitchMax,keyWidth:keyW,width,rowHeight:rowH,scrollTop:viewport.scrollTop,following:$('nrFollow').checked,liveVoices:voices.size,mode:$('nrMode').value,audioState:ctx?.state||'not-created'}),close};
onData();
})();
