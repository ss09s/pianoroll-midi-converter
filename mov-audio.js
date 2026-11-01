/* PianoRoll MIDI Converter 0.5.6 — local ISO-BMFF/MOV AAC demux (no upload).
 * Supports moov/stbl layouts with stsz, stsc, stco/co64 and AAC-LC style mp4a/esds.
 * Cannot decode every QuickTime audio codec or DRM protected media.
 */
(function(global){'use strict';
 const te=new TextDecoder('latin1');
 function u16(d,p){return d.getUint16(p)}
 function u32(d,p){return d.getUint32(p)}
 function big64(d,p){return Number((BigInt(d.getUint32(p))<<32n)|BigInt(d.getUint32(p+4)))}
 function four(b,p){return String.fromCharCode(b[p],b[p+1],b[p+2],b[p+3]);}
 function boxes(bytes,start=0,end=bytes.length){
  const r=[],v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  for(let p=start;p+8<=end;){
   let n=u32(v,p),h=8;
   if(n===1){if(p+16>end)break;n=big64(v,p+8);h=16;}
   if(n===0)n=end-p;
   if(!Number.isSafeInteger(n)||n<h||p+n>end)break;
   r.push({type:four(bytes,p+4),start:p+ h,end:p+n,outer:p,length:n}); p+=n;
  }
  return r;
 }
 function find(list,type){return list.find(b=>b.type===type)}
 async function topBoxes(file,done){
  const found=[];let offset=0;
  while(offset+8<=file.size){
   if(done())throw Error('中止しました');
   const b=new Uint8Array(await file.slice(offset,offset+16).arrayBuffer());
   if(b.length<8)break;
   const d=new DataView(b.buffer);let size=d.getUint32(0),header=8;
   if(size===1){if(b.length<16)break;size=big64(d,8);header=16;}
   if(size===0)size=file.size-offset;
   if(!Number.isSafeInteger(size)||size<header||offset+size>file.size)throw Error('MOVのボックス構造が不正です');
   found.push({type:four(b,4),offset,size,header});
   offset+=size;
  }
  return found;
 }
 function readArray(bytes,box,unit,skip=8){
  const dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const n=u32(dv,box.start+4), arr=[];let p=box.start+skip;
  if(n>2e7||p+n*unit>box.end)throw Error('MOV音声のテーブルが不正です');
  for(let i=0;i<n;i++,p+=unit)arr.push(unit===8?big64(dv,p):u32(dv,p));
  return arr;
 }
 function parseEsds(bytes,lo,hi){
  // Locate DecoderSpecificInfo descriptor (0x05, AudioSpecificConfig) inside esds.
  for(let p=lo;p+3<hi;p++){
   if(bytes[p]!==5)continue;
   let len=0,q=p+1,ok=false;
   for(let i=0;i<4&&q<hi;i++){
    const x=bytes[q++];len=(len<<7)|(x&127);
    if(!(x&128)){ok=true;break;}
   }
   if(ok&&len>=2&&len<=64&&q+len<=hi){
    const asc=bytes.slice(q,q+len), aot=asc[0]>>3;
    const rateIndex=((asc[0]&7)<<1)|(asc[1]>>7), channels=(asc[1]>>3)&15;
    if(aot>=1&&aot<=5&&rateIndex<13&&channels>=1&&channels<=7)return {asc,aot,rateIndex,channels};
   }
  }
  return null;
 }
 function findEsds(bytes,start,end,depth=0){
  if(depth>5)return null;
  const list=boxes(bytes,start,end);
  for(const b of list){
   if(b.type==='esds'){
    const ret=parseEsds(bytes,b.start+4,b.end);if(ret)return ret;
   }
   if(b.type==='wave'||b.type==='sinf'){
    const r=findEsds(bytes,b.start,b.end,depth+1);if(r)return r;
   }
  }
  return null;
 }
 function parseTrack(bytes,trak){
  const dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const mdia=find(boxes(bytes,trak.start,trak.end),'mdia');if(!mdia)return null;
  const mlist=boxes(bytes,mdia.start,mdia.end), hdlr=find(mlist,'hdlr');
  if(!hdlr||four(bytes,hdlr.start+8)!=='soun')return null;
  const mdhd=find(mlist,'mdhd');if(!mdhd)return null;
  const version=bytes[mdhd.start];
  const timescale=u32(dv,mdhd.start+(version?20:12));
  const minf=find(mlist,'minf'),stbl=minf&&find(boxes(bytes,minf.start,minf.end),'stbl');
  if(!stbl||!timescale)return null;
  const b=boxes(bytes,stbl.start,stbl.end),stsd=find(b,'stsd'),stsz=find(b,'stsz'),stsc=find(b,'stsc'),stco=find(b,'stco')||find(b,'co64'),stts=find(b,'stts');
  if(!stsd||!stsz||!stsc||!stco)return null;
  const entry=boxes(bytes,stsd.start+8,stsd.end)[0];
  if(!entry||entry.type!=='mp4a')return {unsupported:'音声コーデック '+(entry?.type||'unknown')+' に非対応（AAC/mp4aのみ対応）'};
  // ISO mp4a sample entry is 8-byte box header, 28-byte fields, then nested esds.
  // QuickTime v1/v2 sample descriptions can contain longer entries and wave/esds boxes.
  let config=null;
  for(const off of [28,44,64,72]){
   if(entry.start+off<entry.end)config=findEsds(bytes,entry.start+off,entry.end);
   if(config)break;
  }
  if(!config) return {unsupported:'AACデコーダー設定（esds）がありません'};
  const count=u32(dv,stsz.start+8),same=u32(dv,stsz.start+4);
  if(count===0||count>2e7)throw Error('MOVの音声サンプル数が不正です');
  let sizes;
  if(same)sizes=Array(count).fill(same);
  else {
   if(stsz.start+12+count*4>stsz.end)throw Error('stszが不正です');
   sizes=new Array(count);for(let i=0;i<count;i++)sizes[i]=u32(dv,stsz.start+12+4*i);
  }
  const chunks=readArray(bytes,stco,stco.type==='co64'?8:4);
  const nsc=u32(dv,stsc.start+4), table=[];
  if(nsc>1e6||stsc.start+8+nsc*12>stsc.end)throw Error('stscが不正です');
  for(let i=0;i<nsc;i++){
   let p=stsc.start+8+i*12;table.push({chunk:u32(dv,p),per:u32(dv,p+4)});
  }
  if(!table.length||table[0].chunk!==1)throw Error('チャンク配置を読めません');
  const samples=[];let ix=0,ti=0;
  for(let i=0;i<chunks.length&&ix<count;i++){
   while(ti+1<table.length&&table[ti+1].chunk<=i+1)ti++;
   let at=chunks[i],per=table[ti].per;
   for(let j=0;j<per&&ix<count;j++){
    const sz=sizes[ix++];samples.push({offset:at,size:sz});at+=sz;
   }
  }
  if(samples.length!==count)throw Error('音声チャンクが欠けています');
  const durEntries=u32(dv,stts?.start+4||0),durations=[];
  if(stts){
   for(let i=0;i<durEntries;i++){
    const p=stts.start+8+8*i;if(p+8>stts.end)break;
    durations.push([u32(dv,p),u32(dv,p+4)]);
   }
  }
  return {samples,config,timescale,durations};
 }
 async function getTrack(file,done,status){
  const top=await topBoxes(file,done),moov=top.find(x=>x.type==='moov');
  if(!moov)throw Error('MOV/MP4にmoovメタデータがありません（未対応の断片化形式の可能性）');
  if(moov.size>70e6)throw Error('MOVのメタデータが大きすぎます');
  status('MOVの音声トラック情報を読み込み中…');
  const bytes=new Uint8Array(await file.slice(moov.offset,moov.offset+moov.size).arrayBuffer());
  const root=boxes(bytes),m=find(root,'moov'),tracks=boxes(bytes,m.start,m.end).filter(x=>x.type==='trak');
  let unsupported=[];
  for(const t of tracks){
   const x=parseTrack(bytes,t);if(x?.samples)return x;
   if(x?.unsupported)unsupported.push(x.unsupported);
  }
  throw Error(unsupported[0]||'音声トラックが見つかりません');
 }
 async function samplePackets(file,track,done,status){
  const {samples}=track;
  const packets=new Array(samples.length);let idx=0;
  // Read bounded portions of the original file to avoid copying entire MOV videos into JS memory.
  while(idx<samples.length){
   if(done())throw Error('中止しました');
   let begin=samples[idx].offset,end=begin,last=idx;
   while(last<samples.length){
    const s=samples[last];
    if(s.offset<begin||s.offset+ s.size>file.size)throw Error('音声サンプル位置が不正です');
    if(s.offset+ s.size-begin>3e6&&last>idx)break;
    end=Math.max(end,s.offset+s.size);last++;
    if(end-begin>=3e6)break;
   }
   const bytes=new Uint8Array(await file.slice(begin,end).arrayBuffer());
   for(let j=idx;j<last;j++){
    const s=samples[j];packets[j]=bytes.slice(s.offset-begin,s.offset-begin+s.size);
   }
   idx=last;
   if(idx%1000===0||idx===samples.length){status(`MOVからAACを抽出中… ${Math.round(idx/samples.length*100)}%`);await new Promise(r=>setTimeout(r,0));}
  }
  return packets;
 }
 function adtsPacket(packet,config){
  if(packet.length+7>8191)throw Error('AACフレームがADTSのサイズ上限を超えました');
  const size=packet.length+7,h=new Uint8Array(size);
  const profile=config.aot-1;
  if(profile<0||profile>3)throw Error('このAACプロファイルはADTSに変換できません');
  h[0]=255;h[1]=241;h[2]=(profile<<6)|(config.rateIndex<<2)|(config.channels>>2);
  h[3]=((config.channels&3)<<6)|(size>>11);
  h[4]=(size>>3)&255;h[5]=((size&7)<<5)|31;h[6]=252;
  h.set(packet,7);return h;
 }
 async function tryADTS(context,packets,config,status){
  status('抽出したAACを波形へデコード中…');
  let size=0;for(const p of packets)size+=p.length+7;
  if(size>150e6)throw Error('AAC音声が150MBを超えました');
  const stream=new Uint8Array(size);let off=0;
  for(const p of packets){const v=adtsPacket(p,config);stream.set(v,off);off+=v.length;}
  return context.decodeAudioData(stream.buffer);
 }
 async function tryWebCodecs(context,packets,track,done,status){
  if(!global.AudioDecoder||!global.EncodedAudioChunk)throw Error('WebCodecs AudioDecoder非対応');
  const config={codec:`mp4a.40.${track.config.aot}`,description:track.config.asc,sampleRate:[96000,88200,64000,48000,44100,32000,24000,22050,16000,12000,11025,8000,7350][track.config.rateIndex],numberOfChannels:track.config.channels};
  if(!config.sampleRate)throw Error('AACのサンプルレートを読み取れません');
  if(global.AudioDecoder.isConfigSupported){const support=await global.AudioDecoder.isConfigSupported(config);if(!support.supported)throw Error('WebCodecsがAACコーデックに非対応');}
  let error=null,total=0;const pieces=[];
  const decoder=new AudioDecoder({output:frame=>{
   try{
    const out=new Float32Array(frame.numberOfFrames);const scratch=new Float32Array(frame.numberOfFrames);
    for(let c=0;c<frame.numberOfChannels;c++){
     frame.copyTo(scratch,{planeIndex:c,format:'f32-planar'});
     for(let j=0;j<out.length;j++)out[j]+=scratch[j]/frame.numberOfChannels;
    }
    pieces.push(out);total+=out.length;
   }catch(e){error=e;}finally{frame.close();}
  },error:e=>{error=e}});
  try{
   decoder.configure(config);
   let timestamp=0,ei=0,left=track.durations[0]?.[0]||0,dur=track.durations[0]?.[1]||1024;
   for(let i=0;i<packets.length;i++){
    if(done())throw Error('中止しました');if(error)throw error;
    if(left===0&&track.durations[ei+1]){ei++;left=track.durations[ei][0];dur=track.durations[ei][1];}
    const data=packets[i];decoder.decode(new EncodedAudioChunk({type:'key',timestamp:Math.round(timestamp*1e6/track.timescale),duration:Math.round(dur*1e6/track.timescale),data}));
    timestamp+=dur;left--;
    if(i%100===0){status(`AAC音声をデコード中… ${Math.round(i/packets.length*100)}%`);await new Promise(r=>setTimeout(r,0));}
    if(decoder.decodeQueueSize>80)await new Promise(r=>setTimeout(r,25));
   }
   await decoder.flush();if(error)throw error;
   if(total<1000)throw Error('波形データが得られません');
   const buffer=context.createBuffer(1,total,config.sampleRate),out=buffer.getChannelData(0);
   let at=0;for(const p of pieces){out.set(p,at);at+=p.length;}
   return buffer;
  }finally{decoder.close();}
 }
 async function decode(file,context,{cancelled=()=>false,status=()=>{}}={}){
  const track=await getTrack(file,cancelled,status);
  const packets=await samplePackets(file,track,cancelled,status);
  if(cancelled())throw Error('中止しました');
  let failure='';
  // Safari commonly decodes AAC/ADTS; WebCodecs is a second, independent decoder path.
  try{return await tryADTS(context,packets,track.config,status);}catch(e){failure='ADTS: '+e.message;}
  if(cancelled())throw Error('中止しました');
  try{return await tryWebCodecs(context,packets,track,cancelled,status);}catch(e){failure+=' / WebCodecs: '+e.message;}
  throw Error('AACは抽出できましたがデコードに失敗しました。'+failure);
 }
 global.MovAudioExtractor={decode,_test:{boxes,parseTrack,findEsds,adtsPacket,getTrack,samplePackets}};
})(window);
