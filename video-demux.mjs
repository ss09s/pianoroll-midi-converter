/* Local, bounded MP4 sample extraction. MP4Box.js 2.5.0 / BSD-3-Clause. */
import {createFile,DataStream} from './vendor/mp4box/mp4box.all.mjs';
export async function* videoPackets(file,configure){
 const mp4=createFile(),pending=[];let track,problem,ready=false,configured=false,offset=0,extracted=0,appends=0;
 mp4.onError=e=>{problem=Error('MP4: '+e)};
 mp4.onReady=info=>{
  try{
   if(info.isFragmented||info.videoTracks.length!==1)throw Error('断片化MP4・複数映像トラックは互換方式を使用します');
   track=info.videoTracks[0];const raw=mp4.getTrackById(track.id),entries=raw.mdia.minf.stbl.stsd.entries,entry=entries[0],m=Array.from(raw.tkhd.matrix||[]);
   if(entries.length!==1||!/^avc[13]\.(42|4d|58|64)/i.test(track.codec)||!entry.avcC)throw Error('高速方式は通常のH.264/AVC動画に対応しています');
   if(m.length!==9||m.some((n,i)=>n!==[65536,0,0,0,65536,0,0,0,1073741824][i])||(entry.clap&&(entry.clap.cleanApertureWidthN/entry.clap.cleanApertureWidthD!==track.video.width||entry.clap.cleanApertureHeightN/entry.clap.cleanApertureHeightD!==track.video.height||entry.clap.horizOffN!==0||entry.clap.vertOffN!==0))||(entry.pasp&&entry.pasp.hSpacing!==entry.pasp.vSpacing))throw Error('回転・特殊な表示比率は互換方式を使用します');
   const edits=raw.edts?.elst?.entries||[];
   if(edits.length>1||edits.some(e=>e.media_time<0||e.media_rate_integer!==1||e.media_rate_fraction!==0))throw Error('複雑な編集タイムラインは互換方式を使用します');
   if(!Number.isFinite(track.timescale)||track.timescale<=0||!Number.isSafeInteger(track.nb_samples)||track.nb_samples<1||track.nb_samples>1000000)throw Error('映像の時刻情報が不正です');
   const stream=new DataStream(undefined,0,DataStream.BIG_ENDIAN);entry.avcC.write(stream);
   const description=new Uint8Array(stream.buffer,8),mediaTime=edits[0]?.media_time||0;
   track={...track,mediaTime,config:{codec:track.codec,codedWidth:track.video.width,codedHeight:track.video.height,description,hardwareAcceleration:'no-preference'}};ready=true;
   mp4.setExtractionOptions(track.id,null,{nbSamples:16});mp4.start();
  }catch(e){problem=e;}
 };
 mp4.onSamples=(id,user,samples)=>{if(track&&id===track.id){pending.push(...samples);extracted+=samples.length;}};
 try{
  while(offset<file.size){
   if(++appends>100000)throw Error('MP4読み込み回数が上限を超えました');
   const end=Math.min(file.size,offset+1024*1024),ab=await file.slice(offset,end).arrayBuffer();ab.fileStart=offset;
   const next=mp4.appendBuffer(ab);if(problem)throw problem;
   if(ready&&!configured){await configure(track);configured=true;}
   while(pending.length){const s=pending.shift();yield {sample:s,track};mp4.releaseUsedSamples(track.id,s.number+1);}
   if(ready&&extracted>=track.nb_samples)break;
   // Before moov, appendBuffer can skip the large mdat instead of buffering it.
   const candidate=Number.isSafeInteger(next)&&next>=0&&next!==offset?next:end;offset=candidate;
  }
  mp4.flush();if(problem)throw problem;
  if(ready&&!configured){await configure(track);configured=true;}
  while(pending.length){const s=pending.shift();yield {sample:s,track};mp4.releaseUsedSamples(track.id,s.number+1);}
  if(!configured||extracted!==track.nb_samples)throw Error('映像サンプルを最後まで読み込めませんでした');
 }finally{mp4.stop();pending.length=0;}
}
