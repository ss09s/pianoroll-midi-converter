/* v0.6.9-ui1 — compact user workflow, with the original controls restored on legacy view. */
(()=>{
'use strict';
const $=id=>document.getElementById(id),legacy=$('legacyMenus'),moves=[];
function move(id,target,label){
 const node=$(id),anchor=document.createComment('legacy:'+id);node.before(anchor);
 let host=$(target);if(label){const l=document.createElement('label');const text=document.createElement('span');text.textContent=label;l.append(text);host.append(l);host=l;}
 const slot=document.createComment('simple:'+id);host.append(slot,node);moves.push({node,anchor,host,slot});return node;
}
const ai=move('aiModelKind','simpleModel','AIモデル');
move('aiRun','simpleRun').textContent='AIで解析';move('aiStop','simpleRun').textContent='中止';
move('audioFile','simpleAnalysisSettings','別の音声を使う（任意）');move('aiBackend','simpleAnalysisSettings','処理方式');
move('tempoChart','simpleChart');
const playhead=document.createElement('div');playhead.id='simplePlayhead';playhead.setAttribute('aria-hidden','true');playhead.hidden=true;$('simpleChart').append(playhead);
const legend=document.createElement('p');legend.className='simple-chart-legend';legend.textContent='青線：BPM　緑：拍　ピンク：小節頭（候補）';$('simpleChart').append(legend);
function refreshPlayhead(){
 const range=PianoRollMainData.getTempoRange(),match=$('listenPosition').textContent.match(/^([0-9.]+)/);if(!range||!match||legacy.open){playhead.hidden=true;return;}
 const full=range[1]-range[0],span=full*(Number($('tempoZoom').value)||1),lo=range[0]+(full-span)*Number($('tempoPan').value)/100,t=Number(match[1]);
 const w=$('tempoChart').width;playhead.hidden=t<lo||t>lo+span;playhead.style.left=(100*(45/w+(1-65/w)*(t-lo)/Math.max(.001,span)))+'%';playhead.style.height=$('tempoChart').getBoundingClientRect().height+'px';
}
new MutationObserver(refreshPlayhead).observe($('listenPosition'),{childList:true,subtree:true,characterData:true});
for(const id of ['listenPlay','listenPause','listenStop'])move(id,'simpleTransport');
move('listenProgress','simpleProgress');move('listenPosition','simplePosition');move('listenBeatInfo','simplePosition');
const bpm=document.createElement('span');bpm.id='simpleBpm';bpm.textContent='BPM —';$('simplePosition').append(bpm);
move('listenBeatsSource','simpleSource','クリックの基準');
move('listenMode','simpleMode','聴き方');
move('cursorEditor','simpleCursor');
move('aiMeter','simpleMeter','拍子（要確認）');move('aiBeatUnit','simpleMeter','1拍の長さ');
for(const id of ['tempoMapHalf','tempoMapDouble','aiExportGrid'])move(id,'simpleMapTools');
$('aiExportGrid').textContent='解析結果を保存';$('tempoMapHalf').textContent='BPM ÷2';$('tempoMapDouble').textContent='BPM ×2';
for(const [id,label] of [['listenSongVolume','原曲の音量'],['listenClickVolume','クリックの音量'],['listenStart','再生開始（秒）'],['listenDuration','再生範囲'],['listenOffset','クリックの位置補正（ms）'],['listenAccent','小節頭の音を変える'],['listenAccentSource','小節頭の決め方'],['listenBeatPhase','最初の拍の番号'],['listenAnchor','テンポマップの基準拍（秒）']])move(id,'simpleSound',label);
const rename=(id,values)=>{for(const opt of $(id).options)if(values[opt.value])opt.textContent=values[opt.value];};
rename('listenBeatsSource',{ai:'AIの拍',map:'編集したBPMの拍'});rename('listenMode',{both:'原曲 ＋ クリック',song:'原曲のみ',click:'クリックのみ'});
rename('aiBackend',{wasm:'CPU（標準）',webgpu:'WebGPU'});
const mirror=(id,target,transform=x=>x)=>{const update=()=>{$(target).textContent=transform($(id).textContent)};new MutationObserver(update).observe($(id),{childList:true,subtree:true,characterData:true});return update;};
mirror('aiRuntimeStatus','simpleAnalysisStatus',text=>text.startsWith('✅')?'解析が完了しました。下のタイムラインで拍を確認してください。':text);
mirror('listenStatus','simplePlaybackStatus',text=>text.split('\n')[0]);
function refreshBpm(){const match=$('listenBeatInfo').textContent.match(/BPM: ([0-9.]+)/);const map=PianoRollMainData.getTempoPoints();const t=PianoRollMainData.getSelectedTime()??0;bpm.textContent=match&&window.PianoRollBeatPreview?.getPreviewState().playing?`${match[1]} BPM`:map.length?`${PianoRollMainData.getTempoAt(t).toFixed(2)} BPM`:'BPM —';}
new MutationObserver(refreshBpm).observe($('listenBeatInfo'),{childList:true,subtree:true,characterData:true});
let refreshQueued=false;
function refresh(){
 const beats=PianoRollMainData.getAiBeats(),map=PianoRollMainData.getTempoPoints(),hasData=beats.length>0||map.length>0;
 $('simpleEmpty').hidden=hasData;$('simpleChart').hidden=!hasData;
 $('simpleResultCount').textContent=beats.length?`${beats.length}拍`:map.length?'テンポマップあり':'解析前';
 $('aiExportGrid').disabled=beats.length<2;
 const state=window.PianoRollBeatPreview?.getPreviewState();
 if(!hasData||$('aiRun').disabled)$('listenPlay').disabled=true;else if(!state?.loading&&(!state?.playing||state?.paused))$('listenPlay').disabled=false;
 refreshBpm();
}
window.addEventListener('pianoroll-grid-change',()=>{if(!refreshQueued){refreshQueued=true;queueMicrotask(()=>{refreshQueued=false;refresh();});}});
window.addEventListener('pianoroll-ai-complete',()=>{
 if(!legacy.open){PianoRollUIBridge.adoptAi();$('listenBeatsSource').value='ai';$('listenStart').value='0';$('listenDuration').value='all';}
 refresh();
});
// All original controls remain usable. Opening legacy restores them to their
// original positions, rather than creating duplicate inputs or competing states.
legacy.addEventListener('toggle',()=>{
 const old=legacy.open;
 for(const {node,anchor,slot} of moves){if(old)anchor.after(node);else slot.after(node);}
 $('simpleWorkspace').hidden=old;
 fitChart();refresh();refreshPlayhead();
});
$('tempoChart').addEventListener('pointerdown',()=>{
 if(legacy.open)return;
 const t=PianoRollMainData.getSelectedTime();if(!Number.isFinite(t))return;
 $('listenStart').value=t.toFixed(2);$('listenStart').dispatchEvent(new Event('change'));$('listenPosition').textContent=`${t.toFixed(2)}秒から再生`;
 refreshBpm();
});
for(const id of ['applyCursorBpm','tempoMapHalf','tempoMapDouble'])$(id).addEventListener('click',()=>{
 $('listenBeatsSource').value='map';$('listenBeatsSource').dispatchEvent(new Event('change'));refreshBpm();
});
$('aiMeter').addEventListener('change',()=>{if(!legacy.open)PianoRollUIBridge.setMeter($('aiMeter').value);});
$('aiRun').addEventListener('click',()=>{if(!legacy.open)$('aiModelFile').value='';},true);
const reset=document.createElement('button');reset.type='button';reset.className='secondary';reset.textContent='AIの結果に戻す';reset.id='simpleReset';reset.onclick=()=>{if(PianoRollUIBridge.adoptAi()){$('listenBeatsSource').value='ai';$('listenBeatsSource').dispatchEvent(new Event('change'));$('simplePlaybackStatus').textContent='BPMをAIの解析結果に戻しました。';refresh();}};$('simpleMapTools').append(reset);
$('aiBeatUnit').addEventListener('change',()=>{if(!legacy.open&&PianoRollMainData.getAiBeats().length)PianoRollUIBridge.adoptAi();});
let locked=false,sourceDisabled=[];
function syncBusy(){const busy=$('aiRun').disabled;
 $('simpleAnalysis').setAttribute('aria-busy',String(busy));
 if(busy&&!locked){locked=true;sourceDisabled=['file','audioFile','aiModelKind','aiBackend'].map(id=>[$(id),$(id).disabled]);for(const [el] of sourceDisabled)el.disabled=true;$('simpleTransport').inert=true;legacy.inert=true;}
 if(!busy&&locked){locked=false;for(const [el,value] of sourceDisabled)el.disabled=value;$('simpleTransport').inert=false;legacy.inert=false;refresh();}
}
new MutationObserver(syncBusy).observe($('aiRun'),{attributes:true,attributeFilter:['disabled']});
for(const id of ['file','audioFile'])$(id).addEventListener('change',()=>{
 if(legacy.open){refresh();return;}
 PianoRollUIBridge.clearSource();$('simpleAnalysisStatus').textContent='音源を変更しました。「AIで解析」を押してください。';$('simplePlaybackStatus').textContent='解析後、ここから試聴できます。';
 $('listenPosition').textContent='0.00秒 / 未読み込み';$('listenBeatInfo').textContent='';$('listenProgress').value='0';refresh();
});
$('listenPlay').addEventListener('click',()=>{if(!legacy.open&&!PianoRollMainData.getAiBeats().length&&!PianoRollMainData.getTempoPoints().length)$('simplePlaybackStatus').textContent='先にAIで解析してください。';});
function fitChart(){const c=$('tempoChart'),w=legacy.open?1100:Math.max(300,Math.round($('simpleChart').clientWidth||340)),h=legacy.open?350:w<600?200:280;if(c.width!==w||c.height!==h){c.width=w;c.height=h;}PianoRollUIBridge.redraw();refreshPlayhead();}
new ResizeObserver(()=>fitChart()).observe($('simpleReview'));
fitChart();
$('simpleAnalysisStatus').textContent='動画を選んで「AIで解析」を押してください。';
refresh();
})();
