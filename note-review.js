/* 0.7.11: editable seconds-based piano roll, synchronized with the original video. */
(()=>{'use strict';
const $=id=>document.getElementById(id),video=$('v'),core=PianoRollNoteCore,scan=PianoRollVideoNoteScan;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const openButton=document.createElement('button');openButton.id='noteReviewOpen';openButton.type='button';openButton.textContent='キーエディターで確認';openButton.disabled=true;$('noteScanExport').after(openButton);
const panel=document.createElement('details');panel.id='noteReview';panel.className='note-review';panel.innerHTML=`<summary>原動画と抽出ノートを比較</summary><div class="nr-body">
<div class="nr-warning" id="nrWarning" hidden></div><div class="nr-layout"><div class="nr-video" id="nrVideo"></div><div class="nr-editor">
<div class="nr-controls nr-toolbar"><div class="nr-top">
<div class="nr-edit-tools"><button type="button" id="nrEdit" aria-label="ノート削除モード" title="ノート削除モード" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m4 16-1 5 5-1L20 8l-4-4ZM14 6l4 4"/></svg></button><button type="button" id="nrUndo" aria-label="元に戻す" title="元に戻す" disabled><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 5 4 10l5 5M4 10h10a6 6 0 0 1 0 12"/></svg></button><button type="button" id="nrRedo" aria-label="やり直す" title="やり直す" disabled><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m15 5 5 5-5 5M20 10H10a6 6 0 0 0 0 12"/></svg></button></div><div class="nr-transport" role="group" aria-label="再生操作"><button type="button" id="nrStart" aria-label="先頭に戻る" title="先頭に戻る" ><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 4v16M19 5l-11 7 11 7Z"/></svg></button><button type="button" id="nrPlay" aria-label="再生" title="再生" data-playing="false"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path class="nr-play-symbol" d="m7 4 14 8-14 8Z"/><path class="nr-pause-symbol" d="M5 4h5v16H5zM14 4h5v16h-5z"/></svg></button><button type="button" id="nrStop" aria-label="停止" title="停止" ><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 5h14v14H5Z"/></svg></button></div>
<label class="nr-mix"><span>原音</span><input id="nrMix" aria-label="原音と抽出音の比率" type="range" min="0" max="100" step="1" value="50"/><span>抽出音</span><output id="nrMixInfo" class="nr-sr">50 : 50</output></label><button id="nrDone" type="button" hidden>完了</button></div>
<div class="nr-bottom"><button type="button" id="nrExpand" aria-label="拡大表示" title="拡大表示" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 3H3v6M15 3h6v6M3 15v6h6M21 15v6h-6"/></svg></button><button type="button" id="nrFollowButton" aria-label="再生位置に追従" title="再生位置に追従" aria-pressed="true"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3v18M3 12h18m-4-4 4 4-4 4"/></svg></button><label class="nr-zoom">横<input id="nrZoomX" aria-label="横ズーム" type="range" min="0" max="100" step="0.1" value="0"/></label><label class="nr-zoom">縦<input id="nrZoomY" aria-label="縦ズーム" type="range" min="1" max="48" step="0.1" value="1"/></label><label class="nr-follow-mode"><span class="nr-sr">追従方式</span><select id="nrFollowMode" aria-label="追従方式"><option value="fixed" selected>バー固定</option><option value="page">ページ送り</option></select></label><output class="nr-time" id="nrTime">0.00秒</output></div></div><div id="nrModeNotice" class="nr-mode-notice" role="status" aria-live="polite" hidden><span aria-hidden="true">●</span> ノート削除モード</div><div class="nr-ruler"><canvas id="nrRuler" aria-hidden="true"></canvas></div><div class="nr-scroll" id="nrScroll"><div class="nr-surface" id="nrSurface"><canvas id="nrRoll" role="img" aria-label="抽出ノートのピアノロール。縦は音高、横は秒。ノートまたは時間位置をタップして選択します。"></canvas><div id="nrCursor" class="nr-cursor" aria-hidden="true"></div></div></div>
<label class="nr-pan" hidden>表示位置<input id="nrPan" type="range" min="0" max="1" step="0.01" value="0"/><span id="nrRange">0–8秒</span></label>
</div></div><output class="nr-selected" id="nrSelected" aria-live="polite">ノートをタップすると、音高・開始・終了・長さを確認できます。</output>
<div id="nrAudioNotice" class="nr-warning" hidden></div><details class="nr-settings"><summary>再生・表示の設定</summary><div class="nr-options"><label><span>縦・横ズームの縮小制限を解除（全音域・全曲）</span><input type="checkbox" id="nrUnlimitedZoom"/></label><label>再生速度<select id="nrRate"><option value=".25">0.25倍</option><option value=".5">0.5倍</option><option value="1" selected>通常</option><option value="1.5">1.5倍</option><option value="2">2倍</option></select></label><label>抽出音の音量<input id="nrVolume" type="range" min="0" max="100" value="50"/></label><label><span>再生位置に追従</span><input id="nrFollow" type="checkbox" checked/></label></div><p class="nr-help">PC（グリッド上）：ホイールで縦移動、Shiftで横移動、Ctrlで横ズーム、Ctrl＋Shiftで縦ズーム。Spaceで再生・一時停止、Alt単独で削除モード、Fで追従、Enterで拡大表示、Ctrl＋Zで元に戻す、Ctrl＋Shift＋Z / Ctrl＋Yでやり直し。抽出音は確認用の簡易音源です。</p></details><p class="nr-help">縦は音高、横は秒。一指でスクロール、二指で縦・横にズーム、ダブルタップした位置から再生します。縦スクロールでは追従を維持します。オレンジの線が再生位置。ノートをタップすると一時停止して開始位置へ移動します。「ノート削除」オンのときだけタップで削除します。↶ / ↷で取り消し・やり直しができます。</p></div>`;
$('noteScanResults').before(panel);
const panelHome=document.createComment('editor position');panel.before(panelHome);
const home=document.createComment('original video position');video.before(home);
let data=null,notes=[],duration=0,pitchMin=48,pitchMax=72,viewStart=0,span=16,width=340,keyW=44,rowH=1,selected=null,hitRects=[];
let editing=false,undoStack=[],redoStack=[],hovered=false,bodyOverflow=null,firstZoom=true,minZoomDefault=true;
let ctx=null,master=null,limiter=null,mediaSource=null,originalGain=null,raf=null,buffering=false,starting=false,token=0,nextNote=0,needsActive=true,seen=new Set(),clock=null,oldVideo=null,lastText=0,lastPaused=null;
const voices=new Map();
function stopSound(){
 for(const {osc,gain} of voices.values()){try{osc.stop();osc.disconnect();gain.disconnect();}catch(_){}}
 voices.clear();seen.clear();nextNote=0;needsActive=true;clock=null;
}
async function audioReady(){

 if(!ctx){const AC=window.AudioContext||window.webkitAudioContext;ctx=new AC();master=ctx.createGain();master.gain.value=Number($('nrVolume').value)/100*mixValue();mediaSource=ctx.createMediaElementSource(video);originalGain=ctx.createGain();mediaSource.connect(originalGain);originalGain.connect(ctx.destination);originalGain.gain.value=panel.open?1-mixValue():1;limiter=ctx.createDynamicsCompressor();limiter.threshold.value=-18;limiter.ratio.value=6;master.connect(limiter);limiter.connect(ctx.destination);}
 applyMix();await ctx.resume();$('nrAudioNotice').hidden=ctx.state==='running';
}
function voice(note,time,rate){
 if(seen.has(note.id)||note.endSeconds<=time||!ctx||ctx.state!=='running')return;
 seen.add(note.id);const when=ctx.currentTime+Math.max(0,(note.startSeconds-time)/rate),end=ctx.currentTime+Math.max(.008,(note.endSeconds-time)/rate);
 const osc=ctx.createOscillator(),gain=ctx.createGain();osc.type='triangle';osc.frequency.value=440*Math.pow(2,(note.midiPitch-69)/12);
 gain.gain.setValueAtTime(0,when);gain.gain.linearRampToValueAtTime(.13,when+.004);gain.gain.setValueAtTime(.09,Math.min(end,when+.08));gain.gain.linearRampToValueAtTime(0,end+.008);
 osc.connect(gain);gain.connect(master);voices.set(note.id,{osc,gain});osc.onended=()=>{if(voices.get(note.id)?.osc===osc)voices.delete(note.id);try{osc.disconnect();gain.disconnect();}catch(_){}};osc.start(when);osc.stop(end+.012);
}
function schedule(){
 if(!panel.open||video.paused||video.seeking||buffering||document.hidden||mixValue()===0||!ctx||ctx.state!=='running')return;
 const t=video.currentTime,rate=video.playbackRate;
 if(clock&&(rate!==clock.rate||Math.abs(t-(clock.t+(ctx.currentTime-clock.a)*rate))>.12))stopSound();
 clock={t,a:ctx.currentTime,rate};
 if(needsActive){for(const note of notes)if(note.startSeconds<t&&note.endSeconds>t)voice(note,t,rate);let a=0,b=notes.length;while(a<b){const m=(a+b)>>1;if(notes[m].startSeconds<t)a=m+1;else b=m;}nextNote=a;needsActive=false;}
 const horizon=t+.10*rate;
 while(nextNote<notes.length&&notes[nextNote].startSeconds<=horizon)voice(notes[nextNote++],t,rate);
}
function canvas(id,w,h){const can=$(id),dpr=Math.min(2,window.devicePixelRatio||1);can.width=Math.round(w*dpr);can.height=Math.round(h*dpr);can.style.width=w+'px';can.style.height=h+'px';const g=can.getContext('2d');g.setTransform(dpr,0,0,dpr,0,0);return g;}
let pixelsPerSecond=40,scrollFrame=null,wantedSpan=16;
function followState(){const on=$('nrFollow').checked;$('nrFollowButton').setAttribute('aria-label',on?'再生位置に追従：オン':'再生位置に追従：オフ');$('nrFollowButton').setAttribute('aria-pressed',String(on));}
function minRow(){return $('nrUnlimitedZoom').checked?Math.max(.5,Math.min(10,viewport.clientHeight/(pitchMax-pitchMin+1))):Math.max(2,viewport.clientHeight/60);}
function maxSpan(){return Math.max(.25,Math.min(duration,$('nrUnlimitedZoom').checked?duration:16));}
function leadSeconds(){return $('nrFollowMode').value==='page'?0:span*.25;}
function render(){
 if(!panel.open||!data)return;
 rowH=minZoomDefault?minRow():Math.max(rowH,minRow());$('nrZoomY').min=String(minRow());
 const viewport=$('nrScroll');width=Math.max(240,viewport.clientWidth||340);wantedSpan=Math.min(wantedSpan,maxSpan());span=Math.min(duration,wantedSpan);span=Math.max(.001,span);
 const plot=width-keyW-10;pixelsPerSecond=plot/span;const fullHeight=(pitchMax-pitchMin+1)*rowH;
 $('nrSurface').style.width=(width+($('nrFollowMode').value==='page'?duration-span:duration)*pixelsPerSecond)+'px';$('nrSurface').style.height=Math.max(viewport.clientHeight,fullHeight)+'px';
 viewStart=viewport.scrollLeft/pixelsPerSecond-leadSeconds();const offsetY=viewport.scrollTop,h=viewport.clientHeight,g=canvas('nrRoll',width,h),r=canvas('nrRuler',width,27);
 $('nrRoll').style.left=viewport.scrollLeft+'px';$('nrRoll').style.top=offsetY+'px';
 g.fillStyle='#fff';g.fillRect(0,0,width,h);g.font=Math.min(11,rowH-2)+'px system-ui';
 for(let pitch=pitchMax;pitch>=pitchMin;pitch--){const y=(pitchMax-pitch)*rowH-offsetY,black=[1,3,6,8,10].includes(pitch%12);g.fillStyle=black?'#edf1f6':'#fafcff';g.fillRect(keyW,y,width-keyW,rowH);g.strokeStyle='#dfe6ee';g.beginPath();g.moveTo(0,y+rowH);g.lineTo(width,y+rowH);g.stroke();}
 // White-key bodies extend beneath the raised black keys.
 g.fillStyle='#e9ecf1';g.fillRect(0,0,keyW,h);
 for(let pitch=pitchMax+1;pitch>=pitchMin-1;pitch--){if([1,3,6,8,10].includes((pitch+120)%12))continue;const y=(pitchMax-pitch)*rowH-offsetY,above=[1,3,6,8,10].includes((pitch+1+120)%12),below=[1,3,6,8,10].includes((pitch-1+120)%12),top=y-(above?rowH*.5:0),bottom=y+rowH+(below?rowH*.5:0);g.fillStyle='#f7f8fa';g.fillRect(0,top,keyW,bottom-top);g.strokeStyle='#8f98a5';g.lineWidth=.7;g.strokeRect(0,top,keyW,bottom-top);if((pitch+120)%12===0&&rowH*12>=12){const fontSize=clamp(rowH*.8,6,24);g.font=fontSize+'px system-ui';g.fillStyle='#606c7b';g.fillText(core.noteName(pitch),keyW-fontSize*1.5-3,y+rowH*.5+fontSize*.35);}}
 for(let pitch=pitchMax;pitch>=pitchMin;pitch--){if(![1,3,6,8,10].includes(pitch%12))continue;const y=(pitchMax-pitch)*rowH-offsetY;g.fillStyle='#202632';g.fillRect(0,y+.3,keyW*.62,Math.max(.5,rowH-.6));g.strokeStyle='#10151e';g.strokeRect(0,y+.3,keyW*.62,Math.max(.5,rowH-.6));}

 r.fillStyle='#f0f4fa';r.fillRect(0,0,width,27);r.font='11px system-ui';r.fillStyle='#61758e';r.fillText('音高',5,18);
 const step=span<=4?.5:span<=8?1:span<=16?2:Math.ceil(span/7);
 for(let t=Math.max(0,Math.ceil(viewStart/step)*step);t<=viewStart+span+.0001;t+=step){const x=keyW+(t-viewStart)/span*plot;g.strokeStyle='#d7e1ee';g.beginPath();g.moveTo(x,0);g.lineTo(x,h);g.stroke();r.fillStyle='#61758e';r.fillText(t.toFixed(step<1?1:0)+'s',Math.min(width-28,x+3),18);}
 hitRects=[];g.save();g.beginPath();g.rect(keyW,0,plot+1,h);g.clip();
 for(const note of notes){if(note.startSeconds>viewStart+span)break;if(note.endSeconds<viewStart)continue;const x=keyW+(note.startSeconds-viewStart)/span*plot,y=(pitchMax-note.midiPitch)*rowH+Math.min(2,rowH*.15)-offsetY,w=Math.max(2,(note.endSeconds-note.startSeconds)/span*plot);const color=note.colorRGB||[67,139,218];g.fillStyle=`rgb(${color[0]},${color[1]},${color[2]})`;g.fillRect(x,y,w,Math.max(.6,rowH-Math.min(4,rowH*.3)));g.strokeStyle=note.id===selected?'#c56a0b':'#3d648c';g.lineWidth=note.id===selected?2:1;g.strokeRect(x+.5,y+.5,w-1,Math.max(.5,rowH-Math.min(5,rowH*.4)));if(w>33&&rowH>=14){g.fillStyle='#172b45';g.font='10px system-ui';g.fillText(note.noteName||core.noteName(note.midiPitch),x+3,y+10);}hitRects.push({id:note.id,x,y,w,h:Math.max(.6,rowH-Math.min(4,rowH*.3))});}
 g.restore();if(editing){g.fillStyle='rgba(220,45,65,.07)';g.fillRect(keyW,0,width-keyW,h);}$('nrRange').textContent=`${viewStart.toFixed(1)}–${(viewStart+span).toFixed(1)}秒`;$('nrPan').max=String(Math.max(0,duration-span));$('nrPan').value=String(viewStart);$('nrPan').disabled=duration<=span;followState();paintCursor();
}
function paintCursor(){
 const t=video.currentTime,viewport=$('nrScroll');
 $('nrCursor').hidden=!panel.open||t<viewStart||t>viewStart+span;
 $('nrCursor').style.left=(viewport.scrollLeft+keyW+(t-viewStart)*pixelsPerSecond)+'px';$('nrCursor').style.top=viewport.scrollTop+'px';$('nrCursor').style.height=viewport.clientHeight+'px';
 if(performance.now()-lastText>80||video.paused){$('nrTime').textContent=`${t.toFixed(2)} / ${duration.toFixed(2)}秒`;lastText=performance.now();}
 if(lastPaused!==video.paused){lastPaused=video.paused;const play=$('nrPlay'),label=video.paused?'再生':'一時停止';play.setAttribute('data-playing',String(!video.paused));play.setAttribute('aria-label',label);play.setAttribute('title',label);}
}
function cursor(force=false){
 const t=video.currentTime;
 if(!contacts.size&&panel.open&&$('nrFollow').checked&&(!video.paused||force)&&($('nrFollowMode').value!=='page'||force||t<viewStart||t>viewStart+span*.88)){
  const target=$('nrFollowMode').value==='page'?clamp(t-span*.18,0,Math.max(0,duration-span)):t;const left=target*pixelsPerSecond;if(Math.abs($('nrScroll').scrollLeft-left)>.5){$('nrScroll').scrollLeft=left;render();}else paintCursor();
 }else paintCursor();
}
function tick(){raf=null;if(!panel.open)return;cursor();schedule();if(!video.paused&&!video.ended)raf=requestAnimationFrame(tick);}
function wake(){if(panel.open&&raf===null)raf=requestAnimationFrame(tick);}
function seek(time){stopInertia();token++;starting=false;video.pause();stopSound();video.currentTime=clamp(time,0,duration);cursor();}
function selectAt(event){
 const rect=$('nrRoll').getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top;if(x<keyW)return;
 let hit=null;for(const candidate of hitRects)if(x>=Math.max(keyW,candidate.x)-2&&x<=candidate.x+Math.max(4,candidate.w)+2&&y>=candidate.y-2&&y<=candidate.y+candidate.h+2){hit=candidate;break;}
 if(editing){if(hit)removeNote(hit.id);return;}
 if(hit){selected=hit.id;const note=notes.find(n=>n.id===selected);seek(note.startSeconds);$('nrSelected').textContent=`${note.noteName} / MIDI ${note.midiPitch} · 開始 ${note.startSeconds.toFixed(3)}秒 → 終了 ${note.endSeconds.toFixed(3)}秒 · 長さ ${(note.endSeconds-note.startSeconds).toFixed(3)}秒${note.truncatedStart||note.truncatedEnd?'（動画の端で途切れた候補）':''}`;}
 else{selected=null;seek(viewStart+clamp((x-keyW)/(width-keyW-10),0,1)*span);$('nrSelected').textContent=`${video.currentTime.toFixed(3)}秒へ移動しました。ノートを選ぶと詳細を確認できます。`;}
 render();
}
const viewport=$('nrScroll'),contacts=new Map();let gesture=null,suppressTap=false,inertia=null,velocity={x:0,y:0},lastMove=null;
function stopInertia(){if(inertia!==null)cancelAnimationFrame(inertia);inertia=null;velocity={x:0,y:0};}
function glide(){let last=performance.now();function frame(now){const dt=Math.min(40,Math.max(0,now-last));last=now;const x=viewport.scrollLeft,y=viewport.scrollTop;viewport.scrollLeft+=velocity.x*dt;viewport.scrollTop+=velocity.y*dt;velocity.x*=Math.exp(-dt/240);velocity.y*=Math.exp(-dt/240);if(Math.abs(viewport.scrollLeft-x)<.01)velocity.x=0;if(Math.abs(viewport.scrollTop-y)<.01)velocity.y=0;render();if(Math.hypot(velocity.x,velocity.y)>.015)inertia=requestAnimationFrame(frame);else inertia=null;}inertia=requestAnimationFrame(frame);}

function local(e){const r=viewport.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};}
function beginGesture(){const points=[...contacts.values()];gesture={points:points.map(p=>({...p})),left:viewport.scrollLeft,top:viewport.scrollTop,span,rowH,pps:pixelsPerSecond,lead:leadSeconds()};}
function zoomTo(nextSpan,nextRow,x=(width+keyW)/2,y=viewport.clientHeight/2,base=null){
 stopInertia();if(nextRow!==rowH)minZoomDefault=false;
 const old=base||{left:viewport.scrollLeft,top:viewport.scrollTop,pps:pixelsPerSecond,rowH,lead:leadSeconds()};
 const time=(old.left+Math.max(0,x-keyW))/old.pps-(old.lead||0),pitch=(old.top+y)/old.rowH;
 wantedSpan=clamp(nextSpan,Math.min(.25,duration),maxSpan());rowH=clamp(nextRow,minRow(),48);render();
 viewport.scrollLeft=(time+leadSeconds())*pixelsPerSecond-Math.max(0,x-keyW);viewport.scrollTop=pitch*rowH-y;render();
 $('nrZoomX').value=String(maxSpan()>.25?clamp(100*Math.log(maxSpan()/wantedSpan)/Math.log(maxSpan()/.25),0,100):50);$('nrZoomY').min=String(minRow());$('nrZoomY').value=String(rowH);
}
viewport.addEventListener('pointerdown',e=>{if(e.button!==0&&e.pointerType==='mouse')return;stopInertia();lastMove={...local(e),time:performance.now()};contacts.set(e.pointerId,local(e));viewport.setPointerCapture(e.pointerId);if(contacts.size>1){suppressTap=true;cancelTap();}beginGesture();});
viewport.addEventListener('pointermove',e=>{
 if(!contacts.has(e.pointerId)||!gesture)return;contacts.set(e.pointerId,local(e));const p=[...contacts.values()],start=gesture.points;
 if(p.length===2&&start.length===2){velocity={x:0,y:0};e.preventDefault();const scale=PianoRollEditorGesture.pinch(start[0],start[1],p[0],p[1]);const x=(start[0].x+start[1].x)/2,y=(start[0].y+start[1].y)/2;zoomTo(gesture.span/scale.x,gesture.rowH*scale.y,x,y,gesture);return;}
 if(p.length!==1||start.length!==1)return;
 const dx=p[0].x-start[0].x,dy=p[0].y-start[0].y;
 if(Math.hypot(dx,dy)>6){suppressTap=true;cancelTap();}if(!suppressTap)return;
 // Vertical panning preserves follow. Only an intentional horizontal pan disengages it.
 if(!video.paused&&Math.abs(dx)>8&&Math.abs(dx)>Math.abs(dy)*1.2){$('nrFollow').checked=false;followState();}
 const now=performance.now(),dt=Math.max(1,now-lastMove.time);velocity={x:clamp((lastMove.x-p[0].x)/dt,-3,3),y:clamp((lastMove.y-p[0].y)/dt,-3,3)};lastMove={...p[0],time:now};viewport.scrollLeft=gesture.left-dx;viewport.scrollTop=gesture.top-dy;e.preventDefault();
});
let tapTimer=null,lastTap=null;
function cancelTap(){if(tapTimer!==null)clearTimeout(tapTimer);tapTimer=null;lastTap=null;}
function tapAt(e){const now=performance.now();if(lastTap&&now-lastTap.time<=300&&Math.hypot(e.clientX-lastTap.x,e.clientY-lastTap.y)<24){const rect=$('nrRoll').getBoundingClientRect(),time=viewStart+clamp((e.clientX-rect.left-keyW)/(width-keyW-10),0,1)*span;cancelTap();seek(time);void $('nrPlay').onclick();return;}
 cancelTap();lastTap={time:now,x:e.clientX,y:e.clientY};const point={clientX:e.clientX,clientY:e.clientY};tapTimer=setTimeout(()=>{tapTimer=null;lastTap=null;if(panel.open)selectAt(point);},300);
}
function endPointer(e,cancelled){
 if(!contacts.has(e.pointerId))return;const tap=!cancelled&&!suppressTap&&contacts.size===1;contacts.delete(e.pointerId);if(viewport.hasPointerCapture(e.pointerId))viewport.releasePointerCapture(e.pointerId);
 if(cancelled)cancelTap();if(tap)tapAt(e);if(!contacts.size&&!cancelled&&suppressTap&&lastMove&&performance.now()-lastMove.time<100&&Math.hypot(velocity.x,velocity.y)>.03)glide();if(contacts.size)beginGesture();else{gesture=null;suppressTap=false;cursor();wake();}
}
viewport.addEventListener('pointerup',e=>endPointer(e,false));viewport.addEventListener('pointercancel',e=>endPointer(e,true));
viewport.addEventListener('lostpointercapture',e=>{if(contacts.has(e.pointerId))endPointer(e,true);});
viewport.addEventListener('wheel',e=>{
 e.preventDefault();cancelTap();stopInertia();const unit=e.deltaMode===1?16:e.deltaMode===2?viewport.clientHeight:1,dy=e.deltaY*unit,dx=e.deltaX*unit;
 if(e.ctrlKey){const factor=Math.exp(clamp(dy,-200,200)*.004),p=local(e);zoomTo(e.shiftKey?span:span*factor,e.shiftKey?rowH/factor:rowH,p.x,p.y);return;}
 const horizontal=e.shiftKey||Math.abs(dx)>Math.abs(dy);if(horizontal){viewport.scrollLeft+=e.shiftKey?(dy||dx):dx;if(!video.paused){$('nrFollow').checked=false;followState();}}else viewport.scrollTop+=dy;
 render();
},{passive:false});
viewport.addEventListener('pointerenter',()=>hovered=true);viewport.addEventListener('pointerleave',()=>hovered=false);
viewport.tabIndex=0;viewport.setAttribute('aria-label','ノート表示。一指でスクロール、二指で縦横ズーム');
viewport.addEventListener('scroll',()=>{if(scrollFrame===null)scrollFrame=requestAnimationFrame(()=>{scrollFrame=null;render();});},{passive:true});
$('nrFollowButton').onclick=()=>{$('nrFollow').checked=!$('nrFollow').checked;followState();cursor(true);};
$('nrUnlimitedZoom').checked=false;
$('nrUnlimitedZoom').onchange=()=>zoomTo(span,rowH);
function expand(value){
 cancelTap();stopInertia();const was=panel.classList.contains('nr-expanded');if(was===value)return;
 panel.classList.toggle('nr-expanded');$('nrDone').hidden=!value;$('nrExpand').setAttribute('aria-pressed',String(value));
 if(value){bodyOverflow=document.body.style.overflow;document.body.append(panel);document.body.style.overflow='hidden';fitOverlay();}else{document.body.style.overflow=bodyOverflow??'';bodyOverflow=null;panelHome.after(panel);for(const key of ['width','height','left','top'])panel.style[key]='';}
 render();cursor(true);
}
function fitOverlay(){if(!panel.classList.contains('nr-expanded'))return;const vv=window.visualViewport;panel.style.width=(vv?.width||window.innerWidth)+'px';panel.style.height=(vv?.height||window.innerHeight)+'px';panel.style.left=(vv?.offsetLeft||0)+'px';panel.style.top=(vv?.offsetTop||0)+'px';render();}
window.addEventListener('resize',fitOverlay);window.visualViewport?.addEventListener('resize',fitOverlay);window.visualViewport?.addEventListener('scroll',fitOverlay);
function feedback(button){if(button&&!button.disabled)button.animate?.([{opacity:.6},{opacity:1}],{duration:220});}
panel.addEventListener('click',e=>feedback(e.target.closest?.('button')));
$('nrExpand').onclick=()=>expand(!panel.classList.contains('nr-expanded'));$('nrDone').onclick=()=>expand(false);
function historyState(){$('nrUndo').disabled=!undoStack.length;$('nrRedo').disabled=!redoStack.length;}
function changed(){
 stopSound();selected=null;data={...data,notes:notes.map(({id,...n})=>n)};scan.replaceNotes?.(data.notes);historyState();render();wake();
 $('nrSelected').textContent=`${notes.length}音 · 削除は↶で元に戻せます。`;
}
function removeNote(id){if(scan.getState().stale||scan.running)return;const index=notes.findIndex(n=>n.id===id);if(index<0)return;undoStack.push({note:notes[index],index});redoStack=[];notes.splice(index,1);changed();}
$('nrEdit').onclick=()=>{cancelTap();editing=!editing;$('nrModeNotice').hidden=!editing;panel.classList.toggle('nr-editing');$('nrEdit').setAttribute('aria-pressed',String(editing));$('nrEdit').setAttribute('aria-label',editing?'ノート削除モード：オン':'ノート削除モード：オフ');render();};
$('nrUndo').onclick=()=>{cancelTap();if(!undoStack.length||scan.getState().stale||scan.running)return;const action=undoStack.pop();notes.splice(action.index,0,action.note);redoStack.push(action);changed();};
$('nrRedo').onclick=()=>{cancelTap();if(!redoStack.length||scan.getState().stale||scan.running)return;const action=redoStack.pop(),index=notes.findIndex(n=>n.id===action.note.id);if(index>=0)notes.splice(index,1);undoStack.push(action);changed();};
document.addEventListener('keydown',e=>{
 if(e.key==='Escape'&&panel.classList.contains('nr-expanded')){e.preventDefault();expand(false);return;}
 if(!panel.open||!hovered||e.metaKey||e.target?.closest?.('input,select,textarea,[contenteditable="true"]'))return;
 if(e.key==='Alt'&&!e.ctrlKey&&!e.shiftKey){e.preventDefault();if(!e.repeat){feedback($('nrEdit'));$('nrEdit').onclick();}return;}if(e.altKey)return;
 const key=e.key.toLowerCase();let action=null;
 if(e.ctrlKey){if(key==='z')action=e.shiftKey?'nrRedo':'nrUndo';else if(key==='y')action='nrRedo';}
 else if(!e.shiftKey){if(e.code==='Space'||key===' ')action='nrPlay';else if(key==='f')action='nrFollowButton';else if(key==='enter')action='nrExpand';}
 if(action){e.preventDefault();if(!e.repeat){feedback($(action));void $(action).onclick();}}
});
$('nrFollowMode').onchange=()=>{stopInertia();render();cursor(true);};
$('nrZoomX').oninput=()=>zoomTo(maxSpan()*Math.pow(.25/maxSpan(),Number($('nrZoomX').value)/100),rowH);
$('nrZoomY').oninput=()=>zoomTo(span,Number($('nrZoomY').value));
viewport.addEventListener('dblclick',e=>e.preventDefault());
function mixValue(){return clamp(Number($('nrMix').value)/100,0,1);}
function applyMix(){const mix=mixValue();$('nrMixInfo').textContent=`${Math.round((1-mix)*100)} : ${Math.round(mix*100)}`;if(panel.open)video.muted=mix===1;if(originalGain)originalGain.gain.setValueAtTime(panel.open?1-mix:1,ctx.currentTime);if(master)master.gain.setValueAtTime(Number($('nrVolume').value)/100*mix,ctx.currentTime);}
function applyMode(){applyMix();stopSound();wake();}
function close(){hovered=false;expand(false);cancelTap();panel.classList.remove('nr-expanded');$('nrExpand').setAttribute('aria-pressed','false');stopInertia();contacts.clear();gesture=null;suppressTap=false;token++;starting=false;if(raf!==null){cancelAnimationFrame(raf);raf=null;}video.pause();stopSound();if(video.parentElement===$('nrVideo'))home.after(video);if(oldVideo){if(originalGain)originalGain.gain.setValueAtTime(1,ctx.currentTime);video.muted=oldVideo.muted;video.playbackRate=oldVideo.rate;oldVideo=null;}if(panel.open)panel.open=false;}
function onData(){
 const state=scan.getState();openButton.disabled=!state.hasResult||state.running;
 if(state.running||!state.hasResult){close();if(!state.hasResult){data=null;notes=[];selected=null;}return;}
 const next=scan.getResult();if(!data||data.source.name!==next.source.name||data.notes.length!==next.notes.length||JSON.stringify(data.notes)!==JSON.stringify(next.notes)){
  firstZoom=true;minZoomDefault=true;wantedSpan=16;undoStack=[];redoStack=[];historyState();video.pause();stopSound();data=next;duration=next.source.durationSeconds;notes=next.notes.map((n,id)=>({...n,id})).sort((a,b)=>a.startSeconds-b.startSeconds||a.midiPitch-b.midiPitch);selected=null;viewStart=0;$('nrFollow').checked=true;followState();
  pitchMin=notes.length?Math.min(23,Math.max(0,notes.reduce((p,n)=>Math.min(p,n.midiPitch),127)-2)):23;pitchMax=notes.length?Math.min(127,notes.reduce((p,n)=>Math.max(p,n.midiPitch),0)+2):72;
  $('nrSelected').textContent=notes.length?'ノートをタップすると、音高・開始・終了・長さを確認できます。':'抽出結果は0音です。原動画を確認し、鍵盤ガイドや検出条件を見直してください。';
 }
 $('nrWarning').hidden=!state.stale;$('nrWarning').textContent='ガイドを変更しています。前回抽出した結果を表示中です。再抽出して比較してください。';render();
}
openButton.onclick=()=>{if(!data)return;panel.open=true;panel.scrollIntoView({block:'start',behavior:'smooth'});};
panel.addEventListener('toggle',()=>{
 if(!panel.open){close();return;}if(!data||scan.running){panel.open=false;return;}
 oldVideo={muted:video.muted,rate:video.playbackRate};video.pause();$('nrVideo').append(video);video.playbackRate=Number($('nrRate').value);applyMode();if(firstZoom){rowH=minRow();firstZoom=false;}render();zoomTo(wantedSpan,rowH);$('nrScroll').scrollTop=Math.max(0,((pitchMax-pitchMin+1)*rowH-$('nrScroll').clientHeight)/2);render();cursor(true);wake();
});
$('nrPlay').onclick=async()=>{
 if(!panel.open||!data||starting)return;if(!video.paused){token++;video.pause();stopSound();return;}
 starting=true;const serial=++token;
 try{PianoRollBeatPreview?.stop();await audioReady();if(serial!==token||!panel.open)return;applyMode();if(video.ended)video.currentTime=0;await video.play();if(serial!==token){video.pause();return;}wake();}
 catch(e){$('nrAudioNotice').hidden=false;$('nrAudioNotice').textContent='再生できません：'+e.message;stopSound();}
 finally{starting=false;cursor();}
};
$('nrStart').onclick=()=>{seek(0);cursor(true);};$('nrStop').onclick=()=>seek(0);
$('nrRate').onchange=()=>{if(panel.open)video.playbackRate=Number($('nrRate').value);stopSound();wake();};
$('nrMix').oninput=()=>{applyMix();if(mixValue()===0)stopSound();else{needsActive=true;wake();}void audioReady().then(wake).catch(e=>{$('nrAudioNotice').hidden=false;$('nrAudioNotice').textContent='音声を有効にできません：'+e.message;});};
$('nrVolume').oninput=applyMix;
$('nrPan').oninput=()=>{$('nrScroll').scrollLeft=Number($('nrPan').value)*pixelsPerSecond;if(!video.paused)$('nrFollow').checked=false;render();};$('nrFollow').onchange=()=>{followState();cursor(true);};
for(const event of ['pause','ended','seeking','ratechange','waiting'])video.addEventListener(event,()=>{if(event==='waiting')buffering=true;stopSound();cursor();if(!video.paused)wake();});
video.addEventListener('seeked',()=>{buffering=false;cursor();wake();});video.addEventListener('playing',()=>{buffering=false;wake();if(panel.open)void audioReady().catch(()=>{});});video.addEventListener('timeupdate',()=>{if(panel.open)cursor();});
document.addEventListener('visibilitychange',()=>{stopInertia();stopSound();if(!document.hidden)wake();});
window.addEventListener('pianoroll-notes-change',onData);window.addEventListener('pagehide',e=>{close();if(ctx){if(e.persisted)void ctx.suspend();else void ctx.close();}});
video.addEventListener('pointerdown',()=>{if(ctx)void ctx.resume().catch(()=>{});});
new ResizeObserver(()=>{if(panel.open)render();}).observe($('nrScroll'));
window.PianoRollNoteReview={getState:()=>({open:panel.open,editing,undoCount:undoStack.length,redoCount:redoStack.length,maximumSpanSeconds:maxSpan(),timeSeconds:video.currentTime,selectedNote:selected,noteCount:notes.length,viewStartSeconds:viewStart,viewSpanSeconds:span,pitchMin,pitchMax,keyWidth:keyW,width,rowHeight:rowH,minimumRowHeight:minRow(),inertiaActive:inertia!==null,followMode:$('nrFollowMode').value,scrollTop:viewport.scrollTop,following:$('nrFollow').checked,liveVoices:voices.size,mixRatio:mixValue(),originalLevel:originalGain?.gain.value??null,synthLevel:master?.gain.value??null,audioState:ctx?.state||'not-created'}),close};
onData();
})();
