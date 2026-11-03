/* Same-source result archive and one-to-one beat/downbeat reference scoring. */
(function(root){
'use strict';
function score(pred,ref,tolerance=.07){
 const a=Array.from(pred).sort((a,b)=>a-b),b=Array.from(ref).sort((a,b)=>a-b);let i=0,j=0,n=0,total=0;
 while(i<a.length&&j<b.length){const d=a[i]-b[j];if(Math.abs(d)<=tolerance){n++;total+=Math.abs(d);i++;j++;}else if(d<0)i++;else j++;}
 return {matched:n,predicted:a.length,reference:b.length,precision:a.length?n/a.length:0,recall:b.length?n/b.length:0,f1:a.length+b.length?2*n/(a.length+b.length):null,meanErrorMs:n?total/n*1000:null,toleranceSeconds:tolerance};
}
function parseReference(text){
 const d=JSON.parse(text);if(!d||!Array.isArray(d.beats)||d.beats.length<2)throw Error('beats配列（秒）が2件以上必要です');
 for(const key of ['beats','downbeats'])if(d[key]!==undefined&&(!Array.isArray(d[key])||d[key].some(t=>!Number.isFinite(t)||t<0)||d[key].some((t,i)=>i&&t<=d[key][i-1])))throw Error(key+'は重複のない昇順の秒数で指定してください');
 return {beats:d.beats,downbeats:d.downbeats??null};
}
const api={score,parseReference};if(typeof module==='object'&&module.exports){module.exports=api;return;}
let source=null,reference=null,referenceName='',records=[],chosen=null;
const $=id=>document.getElementById(id);
function ensureSource(file){if(source!==file){source=file;reference=null;referenceName='';records=[];chosen=null;$('modelReference').value='';render();}}
function add(result){
 const record={...result,createdAt:new Date().toISOString(),id:crypto.randomUUID()};
 delete record.activations; // output grids suffice for comparison; discard frame arrays
 records.push(record);chosen=record.id;render();return record;
}
function addFailure(modelId,error){records.push({id:crypto.randomUUID(),modelId,model:modelId,error:String(error),createdAt:new Date().toISOString()});render();}
function render(){
 const list=$('modelResults');if(!list)return;list.replaceChildren();
 $('modelReferenceName').textContent=reference?`参照：${referenceName}（正解として扱います。時刻原点は音源先頭）`:'参照なし：精度の順位は判定しません。';
 $('modelCompareExport').disabled=!records.length;
 for(const r of records){const card=document.createElement('div');card.className='comparison-result';const title=document.createElement('strong');title.textContent=r.model;card.append(title);
 const info=document.createElement('div');info.className='muted';
 if(r.error){info.textContent='失敗：'+r.error;card.append(info);list.append(card);continue;}
 info.textContent=`拍 ${r.beats.length} / 小節頭 ${r.downbeats.length} / ${r.elapsedSeconds.toFixed(1)}秒（取得・準備込み）`;card.append(info);
 if(reference){const a=score(r.beats,reference.beats),b=reference.downbeats?score(r.downbeats,reference.downbeats):null;const line=document.createElement('div');line.textContent=`参照F1（許容±70ms）：拍 ${a.f1===null?'—':(100*a.f1).toFixed(1)+'%'} / 小節頭 ${b?.f1==null?'—':(100*b.f1).toFixed(1)+'%'}`;card.append(line);}
 const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent=chosen===r.id?'表示中':'この拍を表示・試聴';button.disabled=window.PianoRollModels?.running||window.PianoRollComparisonHost?.running;
 button.onclick=()=>{chosen=r.id;window.PianoRollComparisonHost.select(r);render();};card.append(button);list.append(card);
 }
}
function exportReport(){return {format:'pianoroll-model-comparison-v1',appVersion:'0.6.9',source:source?{name:source.name,size:source.size,lastModified:source.lastModified}:null,reference:reference?{name:referenceName,...reference}:null,notes:['Same File object and same decoded audio per batch. Changing source clears comparison.','F1 uses one-to-one matching within 70 ms; reference annotations must be verified by the user.','Time includes initialization/download, not a controlled speed benchmark.','BeatNet uses an experimental peak decoder, not official PF/DBN.','No meter or MIDI accuracy certification.'],results:records.map(r=>({...r,metrics:reference&&!r.error?{beat:score(r.beats,reference.beats),downbeat:reference.downbeats?score(r.downbeats,reference.downbeats):null}:null}))};}
function download(){const url=URL.createObjectURL(new Blob([JSON.stringify(exportReport(),null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='model-comparison.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
window.PianoRollComparison={...api,ensureSource,add,addFailure,render,exportReport};
function init(){
 const select=$('aiModelKind');select.replaceChildren(...PianoRollModels.models.map(m=>{const o=document.createElement('option');o.value=m.id;o.textContent=m.name+' / '+m.size;return o;}));
 const checks=$('modelCompareChoices');
 for(const m of PianoRollModels.models){const label=document.createElement('label'),c=document.createElement('input');c.type='checkbox';c.value=m.id;c.checked=['light','beatnet-1'].includes(m.id);c.name='comparisonModel';label.append(c,document.createTextNode(m.name));checks.append(label);}
 const update=()=>{const beatnet=select.value.startsWith('beatnet-');$('aiBackend').disabled=beatnet;$('aiModelFile').disabled=beatnet;if(beatnet)$('aiModelFile').value='';$('modelDescription').textContent=beatnet?'BeatNetはCPU/WASMで実行。拍の抽出は実験版peak-v1です。公式PF/DBNとの精度は同一ではありません。':'Beat This!：拍と小節頭を推定。fullがすべての曲で優れるとは限りません。';};
 select.addEventListener('change',update);update();
 $('modelReference').onchange=async()=>{
  const file=$('modelReference').files[0];if(!file)return;
  const audio=$('audioFile').files[0]||window.PianoRollMainData.getActiveFile();
  if(!audio){$('modelReferenceName').textContent='先に解析する音源を選択してください。';return;}
  ensureSource(audio);
  try{const data=parseReference(await file.text());if(source!==audio)return;reference=data;referenceName=file.name;render();}
  catch(e){if(source!==audio)return;reference=null;referenceName='';render();$('modelReferenceName').textContent='参照読込失敗：'+e.message;}
 };
 $('modelCompareExport').onclick=download;
 for(const id of ['audioFile','file'])$(id).addEventListener('change',()=>{source=null;records=[];reference=null;chosen=null;referenceName='';$('modelReference').value='';render();});
 $('modelCompareRun').onclick=()=>window.PianoRollComparisonHost.run(Array.from(document.querySelectorAll('[name=comparisonModel]:checked')).map(x=>x.value));
 render();
}
init();
})(typeof window!=='undefined'?window:globalThis);
