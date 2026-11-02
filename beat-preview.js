/* PianoRoll MIDI Converter v0.6.4 — original audio + beat click A/B audition.
 * No video/audio files leave the device. Both the reference track and all clicks
 * use ONE AudioContext clock, avoiding media-element and JS timer drift.
 * This is a listening/diagnostic tool; it does not silently change the tempo map.
 */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const ui = {
    source: $('listenBeatsSource'), mode: $('listenMode'), start: $('listenStart'),
    duration: $('listenDuration'), offset: $('listenOffset'), anchor: $('listenAnchor'),
    play: $('listenPlay'), pause: $('listenPause'), stop: $('listenStop'),
    progress: $('listenProgress'), position: $('listenPosition'), beatInfo: $('listenBeatInfo'),
    status: $('listenStatus'), songVolume: $('listenSongVolume'), clickVolume: $('listenClickVolume'),
    accent: $('listenAccent'), cursor: $('listenCursor'), aiAnchor: $('listenAiAnchor'),
    anomaly: $('listenAnomaly')
  };
  if (Object.values(ui).some(x => !x)) return;
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const finite = (v, fallback) => Number.isFinite(Number(v)) ? Number(v) : fallback;
  let ctx = null, buffer = null, lastFile = null, loading = false, loadToken = 0;
  let track = null, songGain = null, clickGain = null;
  let playing = false, paused = false, audioTime = 0, intervalId = null, rafId = null;
  let clipFrom = 0, clipTo = 0, baseClock = 0, clickEvents = [], nextClick = 0;
  let lastInfoUpdate = 0;

  function getChosenFile() {
    // Use the same source as audio BPM and AI analysis. If audio file input is set,
    // it takes priority over the video; otherwise use the last selected video.
    return $('audioFile')?.files?.[0] || window.PianoRollMainData?.getActiveFile() || null;
  }
  function getMap() {
    const tempoPoints=window.PianoRollMainData?.getTempoPoints() || [];
    return tempoPoints.filter(p => Number.isFinite(p.t) && Number.isFinite(p.bpm) && p.bpm > 0)
      .map(p => ({t: Math.max(0, p.t), bpm: p.bpm})).sort((a,b) => a.t-b.t);
  }
  function getAiBeats() {
    const aiBeatTimes=window.PianoRollMainData?.getAiBeats() || [];
    return aiBeatTimes.filter(t => Number.isFinite(t) && t>=0).slice().sort((a,b) => a-b);
  }
  function getDownbeats() {
    const aiDownbeatTimes=window.PianoRollMainData?.getDownbeats() || [];
    return aiDownbeatTimes.filter(t => Number.isFinite(t) && t>=0).slice().sort((a,b)=>a-b);
  }

  // Convert seconds to musical beats with a piecewise-constant editable BPM map.
  // The integral remains continuous at tempo change points, including mid-beat.
  function beatIntegral(seconds, points) {
    const t = Math.max(0, seconds);
    if (!points.length) return t * 2;
    let at = 0, bpm = points[0].bpm, count = 0;
    for (const point of points) {
      if (point.t <= 0) {bpm = point.bpm; continue;}
      if (point.t >= t) break;
      if (point.t > at) {count += (point.t - at) * bpm / 60; at = point.t;}
      bpm = point.bpm;
    }
    return count + (t-at)*bpm/60;
  }
  function beatGridFromMap(start, end, anchor, points, meter = 4) {
    if (!points.length || end <= start) return [];
    const baseline = beatIntegral(anchor, points);
    const lo = Math.ceil(beatIntegral(start, points)-baseline-1e-8);
    const hi = Math.floor(beatIntegral(end, points)-baseline+1e-8);
    const count = hi-lo+1;
    if (count > 30000) throw new Error('再生区間が長すぎます。短い区間を選んでください。');
    const events = [];
    for (let k=lo; k<=hi; k++) {
      const target = baseline + k;
      let left=start, right=end;
      // Monotonic inverse of the tempo integral, preserving fractional BPM.
      for (let j=0; j<33; j++) {
        const mid=(left+right)/2;
        if (beatIntegral(mid,points) < target) left=mid;
        else right=mid;
      }
      const time=(left+right)/2;
      events.push({time, downbeat:((k%meter)+meter)%meter===0});
    }
    return events;
  }
  function selectedEvents(start, end) {
    const shift = clamp(finite(ui.offset.value,0),-500,500)/1000;
    const from = Math.max(0,start-shift-.02), to=end-shift+.02;
    if (ui.source.value==='ai') {
      const beats=getAiBeats(),downs=getDownbeats();
      if (!beats.length) throw new Error('AIによる拍データがありません。先にAI解析を行うか、テンポマップを選択してください。');
      const events=[];let di=0;
      for (const time of beats) {
        if(time<from || time>to)continue;
        while (di<downs.length && downs[di]<time-.07)di++;
        const isDown=di<downs.length && Math.abs(downs[di]-time)<.07;
        const shifted=time+shift;
        if(shifted>=start-1e-5 && shifted<=end+1e-5)events.push({time:shifted, downbeat:isDown});
      }
      return events;
    }
    const map=getMap();
    if(!map.length)throw new Error('テンポマップがありません。先に音声からBPMを解析するか、AI拍からテンポマップを生成してください。');
    const anchor=clamp(finite(ui.anchor.value,0),0,1000000);
    const numerator=Number(($('aiMeter')?.value||'4/4').split('/')[0]);
    const meter=clamp(numerator||4,1,12);
    return beatGridFromMap(from,Math.max(from,to),anchor,map,meter)
      .map(e=>({...e,time:e.time+shift}))
      .filter(e=>e.time>=start-1e-5 && e.time<=end+1e-5);
  }
  function currentTime() {
    if (playing && ctx) return clamp(clipFrom + Math.max(0,ctx.currentTime-baseClock),clipFrom,clipTo);
    return audioTime;
  }
  function playStatus(s) {ui.status.textContent=s;}
  function updateModeGains() {
    const mode=ui.mode.value;
    if(songGain) songGain.gain.value=(mode==='click'?0:finite(ui.songVolume.value,75)/100);
    if(clickGain) clickGain.gain.value=(mode==='song'?0:finite(ui.clickVolume.value,55)/100);
  }
  function uiButtons() {
    ui.play.disabled = loading || (playing && !paused);
    ui.pause.disabled = !playing;
    ui.stop.disabled = !playing && !loading;
    ui.pause.textContent=paused?'▶ 再開':'⏸ 一時停止';
  }
  function updateProgress(force=false) {
    const t=currentTime(), d=buffer?.duration || Math.max(0, window.PianoRollMainData?.getTempoRange()?.[1]||0);
    ui.progress.max = String(Math.max(1,d));
    ui.progress.value = String(clamp(t,0,Math.max(1,d)));
    ui.position.textContent=`${t.toFixed(2)}秒 / ${d>0?d.toFixed(2)+'秒':'未読み込み'}`;
    if(playing && !paused && t>=clipTo-.008) { stopPlayback({keepPosition:true}); return; }
    if(force || Date.now()-lastInfoUpdate>180) {
      const nearby=clickEvents.length ? clickEvents[Math.min(nextClick,clickEvents.length-1)] : null;
      const currentBpm=getMap().length ? window.PianoRollMainData?.getTempoAt(t) : null;
      ui.beatInfo.textContent = `この位置のBPM: ${currentBpm ? currentBpm.toFixed(2) : '未計測'} / ${ui.source.value==='ai'?'AI拍':'BPMマップ'} ${clickEvents.length}拍`;
      lastInfoUpdate=Date.now();
    }
  }
  function cancelLoops(){if(intervalId!==null){clearInterval(intervalId);intervalId=null;}if(rafId!==null){cancelAnimationFrame(rafId);rafId=null;}}
  function tickDisplay(){updateProgress();if(playing)rafId=requestAnimationFrame(tickDisplay);}
  function stopPlayback({keepPosition=false}={}){
    loadToken++; // cancel any pending audio extraction before it can start playing
    cancelLoops();
    if(playing && ctx && keepPosition) audioTime=currentTime();
    if(track){const old=track;track=null;old.onended=null;try{old.stop()}catch{}try{old.disconnect()}catch{}}
    if(songGain){try{songGain.disconnect()}catch{}songGain=null;}
    if(clickGain){try{clickGain.disconnect()}catch{}clickGain=null;}
    playing=false;paused=false;
    if(!keepPosition) audioTime=0;
    updateProgress(true);uiButtons();
  }
  // Schedule using WebAudio time, not JS timer timing; requestAnimationFrame is
  // used for the display only. This is the same clock as the reference recording.
  function clickAt(when,isDown){
    if(!ctx||!clickGain)return;
    const osc=ctx.createOscillator(),env=ctx.createGain();
    const start=Math.max(ctx.currentTime+.002,when),length=isDown?.085:.061;
    osc.type='sine';osc.frequency.setValueAtTime(isDown?1040:670,start);
    osc.frequency.exponentialRampToValueAtTime(isDown?750:510,start+length);
    env.gain.setValueAtTime(.0001,start);
    env.gain.exponentialRampToValueAtTime(isDown?.44:.29,start+.003);
    env.gain.exponentialRampToValueAtTime(.0001,start+length);
    osc.connect(env);env.connect(clickGain);osc.start(start);osc.stop(start+length+.005);
    osc.onended=()=>{try{osc.disconnect();env.disconnect();}catch{}};
  }
  function scheduleClicks(){
    if(!ctx || !playing || paused)return;
    const horizon=ctx.currentTime+.30;
    while(nextClick<clickEvents.length){
      const e=clickEvents[nextClick],when=baseClock+(e.time-clipFrom);
      if(when>horizon)break;
      if(when>ctx.currentTime-.025)clickAt(when,ui.accent.checked&&e.downbeat);
      nextClick++;
    }
  }
  function stopWhenAudioEnds(source){
    if(track!==source)return;
    stopPlayback({keepPosition:true});
    playStatus('選択した区間の再生が終わりました。原曲とクリックのズレを確認してください。');
  }
  async function prepareAudio(token){
    const file=getChosenFile();
    if(!file) throw new Error('元音源がありません。先に動画または「代替音声ファイル」を選択してください。');
    if(!ctx){const AudioContext=window.AudioContext||window.webkitAudioContext;
      if(!AudioContext)throw new Error('このブラウザはWeb Audio APIに対応していません。');
      try{ctx=new AudioContext({sampleRate:22050});}catch{ctx=new AudioContext();}
    }
    // resume() must start in the click handler on iOS Safari, before file decoding.
    await ctx.resume();
    if(buffer && file===lastFile)return buffer;
    loading=true;uiButtons();playStatus(`元音源を準備中：${file.name}\nMOVでは音声トラックの分離に少し時間がかかる場合があります。`);
    const movie=/\.(mov|mp4|m4v)$/i.test(file.name)||/^video\//.test(file.type);
    let decoded=null;
    if(movie){
      if(!window.MovAudioExtractor)throw new Error('mov-audio.js が必要です。GitHub Pagesに配置してください。');
      decoded=await window.MovAudioExtractor.decode(file,ctx,{
        cancelled:()=>token!==loadToken,
        status:message=>{if(token===loadToken)playStatus(`音源を準備中：${message}`);}
      });
    } else {
      const bytes=await file.arrayBuffer();
      if(token!==loadToken)throw new Error('読み込みを中止しました。');
      decoded=await ctx.decodeAudioData(bytes);
    }
    if(token!==loadToken)throw new Error('読み込みを中止しました。');
    if(!decoded||decoded.duration<=0)throw new Error('音声データが空です。');
    buffer=decoded;lastFile=file;return decoded;
  }
  async function play(){
    if(loading)return;
    if(paused && ctx){
      try{await ctx.resume();paused=false;uiButtons();playStatus('再生中。拍クリックが原曲と同期しているか確認してください。');scheduleClicks();}
      catch(e){playStatus('再開できません：'+e.message);}return;
    }
    stopPlayback({keepPosition:false});
    let token=loadToken;uiButtons();
    try{
      // Read beat data before decoding the audio, to give fast feedback.
      const start=clamp(finite(ui.start.value,0),0,1000000);
      const provisionalEnd=start+(ui.duration.value==='all'?36000:Number(ui.duration.value));
      const hasAi=getAiBeats().length>0,hasMap=getMap().length>0;
      if(!hasAi&&!hasMap&&ui.mode.value!=='song')throw new Error('拍データがありません。AI拍検出または音声BPM解析を先に実行してください。');
      if(ui.mode.value!=='song' && ui.source.value==='ai'&&!hasAi){
        if(hasMap){ui.source.value='map';} else throw new Error('AI拍がありません。');
      }
      if(ui.mode.value!=='song'&&ui.source.value==='map'&&!hasMap){
        if(hasAi){ui.source.value='ai';} else throw new Error('テンポマップがありません。');
      }
      const decoded=await prepareAudio(token);
      if(token!==loadToken)return;
      const lo=clamp(start,0,Math.max(0,decoded.duration-.02));
      const length=ui.duration.value==='all'?decoded.duration-lo:Number(ui.duration.value);
      const hi=Math.min(decoded.duration,lo+length);
      if(hi-lo<.1)throw new Error('再生区間が短すぎます。');
      const events=(getAiBeats().length||getMap().length)?selectedEvents(lo,hi):[];
      if(!events.length && ui.mode.value!=='song')throw new Error('選択した範囲に拍がありません。AI拍またはBPMマップの設定、再生時刻を確認してください。');
      clipFrom=lo;clipTo=hi;audioTime=lo;clickEvents=events;nextClick=0;
      songGain=ctx.createGain();clickGain=ctx.createGain();
      songGain.connect(ctx.destination);clickGain.connect(ctx.destination);updateModeGains();
      const src=ctx.createBufferSource();track=src;src.buffer=decoded;src.connect(songGain);
      playing=true;paused=false;
      baseClock=ctx.currentTime+.15;
      src.onended=()=>stopWhenAudioEnds(src);
      // .start is sample-accurate relative to the click events scheduled below.
      src.start(baseClock,lo,hi-lo);
      scheduleClicks();intervalId=setInterval(scheduleClicks,55);
      rafId=requestAnimationFrame(tickDisplay);
      playStatus(`再生中：${lo.toFixed(2)}〜${hi.toFixed(2)}秒。クリック ${events.length}拍。\n原曲のみ／クリックのみを切り替えて聴き比べられます。`);
      uiButtons();
    } catch(e) {
      if(token===loadToken){stopPlayback();playStatus('試聴できません：'+(e?.message||String(e)));}
    } finally {loading=false;uiButtons();}
  }
  async function pause(){
    if(!playing)return;
    if(paused){try{await ctx.resume();paused=false;playStatus('再生を再開しました。');scheduleClicks()}catch(e){playStatus('再開できません：'+e.message);}}
    else{await ctx.suspend();paused=true;playStatus('一時停止中。続きを聴く場合は「再開」。');}
    uiButtons();updateProgress(true);
  }
  function findShortSpikes(points){
    const hits=[];
    for(let i=1;i<points.length-1;i++){
      const prev=points[i-1],cur=points[i],next=points[i+1];
      if(next.t-cur.t>.0 && next.t-cur.t<3.5 && Math.abs(next.bpm-prev.bpm)/prev.bpm<.055 && Math.abs(cur.bpm-prev.bpm)/prev.bpm>.14){
        hits.push({time:cur.t,bpm:cur.bpm,returnTime:next.t,normalBpm:prev.bpm});
      }
    }
    return hits;
  }
  function refreshWarnings(){
    const spikes=findShortSpikes(getMap()),host=ui.anomaly;host.replaceChildren();
    host.hidden=!spikes.length;
    if(!spikes.length)return;
    const txt=document.createElement('div');txt.textContent=`⚠️ 短時間だけ急変して戻るBPM区間が${spikes.length}件あります。誤検出の可能性があるため、音源とクリックで確認してください。自動では削除しません。`;host.append(txt);
    for(const s of spikes.slice(0,6)){
      const b=document.createElement('button');b.className='secondary';b.type='button';
      b.textContent=`${s.time.toFixed(2)}秒：${s.bpm.toFixed(1)}→${s.normalBpm.toFixed(1)} の箇所を試聴`;
      b.addEventListener('click',()=>{ui.start.value=String(Math.max(0,s.time-4).toFixed(2));ui.duration.value='10';ui.source.value='map';host.scrollIntoView({block:'nearest'});playStatus('試聴開始位置を設定しました。「再生」を押してください。');window.PianoRollMainData?.setCursor(s.time);});
      host.append(b);
    }
  }

  ui.play.addEventListener('click',play);
  ui.pause.addEventListener('click',pause);
  ui.stop.addEventListener('click',()=>{stopPlayback();playStatus('停止しました。');});
  ui.songVolume.addEventListener('input',updateModeGains);
  ui.clickVolume.addEventListener('input',updateModeGains);
  ui.mode.addEventListener('change',()=>{updateModeGains();if(playing)playStatus('比較モードを切り替えました。音声とクリックは同じ時間軸で再生しています。');});
  ui.source.addEventListener('change',()=>{if(playing){stopPlayback();playStatus('拍データを変更しました。再生し直すと新しい拍が使われます。');}});
  ui.aiAnchor.addEventListener('click',()=>{const beats=getAiBeats();if(!beats.length){playStatus('AI拍がありません。解析してから設定してください。');return;}ui.anchor.value=beats[0].toFixed(3);playStatus(`テンポマップの基準拍を${beats[0].toFixed(3)}秒に設定しました。`);});
  ui.cursor.addEventListener('click',()=>{const t=window.PianoRollMainData?.getSelectedTime();
    if(!Number.isFinite(t)){playStatus('先にBPMグラフの再生したい位置をタップしてください。');return;}
    ui.start.value=Math.max(0,t-2).toFixed(2);
    playStatus(`グラフの${t.toFixed(2)}秒付近から再生するよう設定しました。`);
  });
  ui.progress.addEventListener('change',()=>{
    const seek=clamp(finite(ui.progress.value,0),0,buffer?.duration||100000);
    const wasPlaying=playing&&!paused;
    if(playing)stopPlayback();
    ui.start.value=seek.toFixed(2);
    audioTime=seek;updateProgress(true);
    if(wasPlaying)void play();
  });
  $('audioFile')?.addEventListener('change',()=>{if(playing)stopPlayback();buffer=null;lastFile=null;playStatus('音声ファイルを変更しました。再生すると新しい音源を準備します。');});
  $('file')?.addEventListener('change',()=>{if(playing)stopPlayback();buffer=null;lastFile=null;playStatus('動画ファイルを変更しました。再生すると新しい音源を準備します。');});
  // Changes to the tempo point editor update the spike suggestions. No mutation
  // of analysis results is performed by this preview module.
  const pointsUi=$('tempoSegments');
  if(pointsUi){const observer=new MutationObserver(()=>refreshWarnings());observer.observe(pointsUi,{childList:true});pointsUi.addEventListener('change',()=>setTimeout(refreshWarnings,0));}
  // Optional feedback log: exact problem time and beat/tempo settings, without audio.
  const issueLog=[];
  function renderIssues(){
    const host=$('listenIssuesList');host.replaceChildren();
    $('listenFeedbackStatus').textContent=issueLog.length?`${issueLog.length}件記録しました。JSONで保存し、開発チャットに添付できます。`:'まだ記録はありません。';
    issueLog.forEach((item,i)=>{
      const row=document.createElement('div');row.className='listen-note';
      const text=document.createElement('span');
      const label=$('listenIssueKind').querySelector(`option[value="${item.kind}"]`)?.textContent || item.kind;
      text.textContent=`${item.time.toFixed(2)}秒 / ${label} / ${item.source} / ${item.bpm?.toFixed(2)||'未計測'} BPM ${item.memo? ' — '+item.memo:''}`;
      const del=document.createElement('button');del.type='button';del.className='secondary';del.textContent='削除';
      del.addEventListener('click',()=>{issueLog.splice(i,1);renderIssues()});
      row.append(text,del);host.append(row);
    });
  }
  $('listenIssueAtNow').addEventListener('click',()=>{$('listenIssueTime').value=currentTime().toFixed(2)});
  $('listenAddIssue').addEventListener('click',()=>{
    const time=finite($('listenIssueTime').value,NaN);
    if(!Number.isFinite(time)||time<0){$('listenFeedbackStatus').textContent='0秒以上の時刻を指定してください。';return;}
    if(issueLog.length>=100){$('listenFeedbackStatus').textContent='記録は最大100件です。';return;}
    const bpm=getMap().length?window.PianoRollMainData.getTempoAt(time):null;
    issueLog.push({time,kind:$('listenIssueKind').value,memo:$('listenIssueMemo').value.slice(0,1000),source:ui.source.value,bpm:Number.isFinite(bpm)?bpm:null});
    renderIssues();$('listenIssueMemo').value='';
  });
  $('listenExport').addEventListener('click',()=>{
    const file=getChosenFile(), payload={
      application:'PianoRoll MIDI Converter',version:'0.6.4',type:'user-beat-audition-feedback',
      notice:'This diagnostic file contains timestamps and user feedback only, not the audio/video.',
      originalFileName:file?.name||null, durationSeconds:buffer?.duration||null,
      audition:{beatSource:ui.source.value,mode:ui.mode.value,phaseAnchorSeconds:finite(ui.anchor.value,0),clickOffsetMilliseconds:finite(ui.offset.value,0)},
      issues:issueLog,aiBeatsSeconds:getAiBeats(),aiDownbeatsSeconds:getDownbeats(),tempoMap:getMap()
    };
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download='pianoroll-v0.6.4-beat-feedback.json';document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),10000);
    $('listenFeedbackStatus').textContent=`診断JSONを保存しました（問題の記録 ${issueLog.length}件）。ファイルをチャットに添付できます。`;
  });
  window.PianoRollBeatPreview={beatIntegral,beatGridFromMap,findShortSpikes,getPreviewState:()=>({playing,paused,loading,clipFrom,clipTo,beats:clickEvents.length}),stop:stopPlayback};
  uiButtons();refreshWarnings();updateProgress(true);
})();
