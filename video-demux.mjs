/* Local, bounded MP4 sample extraction. MP4Box.js 2.5.0 / BSD-3-Clause. */
import {createFile} from './vendor/mp4box/mp4box.all.mjs';
// ISO track matrix: [a,b,u,c,d,v,x,y,w]. Normalize quarter-turn translations.
export function displayGeometry(matrix,width,height){
 const m=Array.from(matrix||[]);
 if(m.length!==9||m[2]!==0||m[5]!==0||m[8]!==1073741824||!m.every(Number.isFinite))throw Error('透視変換を含む表示行列は互換方式を使用します');
 const linear=[m[0],m[1],m[3],m[4]].map(n=>n/65536),turns=[[1,0,0,1],[0,1,-1,0],[-1,0,0,-1],[0,-1,1,0]],turn=turns.findIndex(t=>t.every((n,i)=>n===linear[i]));
 if(turn<0)throw Error('拡縮・反転・傾きを含む表示行列は互換方式を使用します');
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw Error('映像サイズが不正です');
 const [a,b,c,d]=linear,corners=[[0,0],[width,0],[0,height],[width,height]].map(([x,y])=>[a*x+c*y,b*x+d*y]),minX=Math.min(...corners.map(p=>p[0])),minY=Math.min(...corners.map(p=>p[1]));
 return {rotation:turn*90,width:turn%2?height:width,height:turn%2?width:height,transform:[a,b,c,d,-minX,-minY]};
}
export async function* videoPackets(file,configure,inspect=()=>{}){
 const mp4=createFile(),pending=[];let track,problem,ready=false,configured=false,offset=0,extracted=0,appends=0;
 mp4.onError=e=>{problem=Error('MP4: '+e)};
 mp4.onReady=info=>{
  try{
   if(info.isFragmented||info.videoTracks.length!==1)throw Error('断片化MP4・複数映像トラックは互換方式を使用します');
   track=info.videoTracks[0];const raw=mp4.getTrackById(track.id),entries=raw.mdia.minf.stbl.stsd.entries,entry=entries[0],m=Array.from(raw.tkhd.matrix||[]);
   inspect({codec:track.codec,sampleEntry:entry?.type,width:track.video?.width,height:track.video?.height,matrix:m,pixelAspectRatio:entry?.pasp?{horizontal:entry.pasp.hSpacing,vertical:entry.pasp.vSpacing}:null,cleanAperture:entry?.clap?{widthN:entry.clap.cleanApertureWidthN,widthD:entry.clap.cleanApertureWidthD,heightN:entry.clap.cleanApertureHeightN,heightD:entry.clap.cleanApertureHeightD,horizontalOffset:entry.clap.horizOffN,verticalOffset:entry.clap.vertOffN}:null,containerColor:entry?.colr?{type:entry.colr.colour_type,primaries:entry.colr.colour_primaries,transfer:entry.colr.transfer_characteristics,matrix:entry.colr.matrix_coefficients}:null});
   const box=/^avc[13]\./i.test(track.codec)?entry?.avcC:/^(hvc1|hev1)\./i.test(track.codec)?entry?.hvcC:null;
   if(entries.length!==1||!box)throw Error('高速方式に非対応の映像形式です（'+track.codec+'）。H.264・H.265/HEVCに対応しています');
   const display=displayGeometry(m,track.video.width,track.video.height);
   if(entry.clap&&(entry.clap.cleanApertureWidthN/entry.clap.cleanApertureWidthD!==track.video.width||entry.clap.cleanApertureHeightN/entry.clap.cleanApertureHeightD!==track.video.height||entry.clap.horizOffN!==0||entry.clap.vertOffN!==0))throw Error('映像の切り抜き指定には未対応のため互換方式を使用します');
   if(entry.pasp&&entry.pasp.hSpacing!==entry.pasp.vSpacing)throw Error('正方形ではない画素の表示比率には未対応のため互換方式を使用します');
   const edits=raw.edts?.elst?.entries||[];
   if(edits.length>1||edits.some(e=>e.media_time<0||e.media_rate_integer!==1||e.media_rate_fraction!==0))throw Error('複雑な編集タイムラインは互換方式を使用します');
   if(!Number.isFinite(track.timescale)||track.timescale<=0||!Number.isSafeInteger(track.nb_samples)||track.nb_samples<1||track.nb_samples>1000000)throw Error('映像の時刻情報が不正です');
   const configurationRange={start:box.start+box.hdr_size,end:box.start+box.size},mediaTime=edits[0]?.media_time||0;
   if(!Number.isSafeInteger(configurationRange.start)||!Number.isSafeInteger(configurationRange.end)||configurationRange.start<0||configurationRange.end>file.size||configurationRange.end<=configurationRange.start||configurationRange.end-configurationRange.start>1024*1024)throw Error('映像デコード設定が不正です');
   track={...track,mediaTime,configurationRange,display,config:{codec:track.codec,codedWidth:track.video.width,codedHeight:track.video.height,hardwareAcceleration:'no-preference'}};ready=true;
   mp4.setExtractionOptions(track.id,null,{nbSamples:16});mp4.start();
  }catch(e){problem=e;}
 };
 const configureTrack=async()=>{const {start,end}=track.configurationRange;const bytes=await file.slice(start,end).arrayBuffer();if(bytes.byteLength!==end-start)throw Error('映像デコード設定を読み込めません');track.config.description=new Uint8Array(bytes);await configure(track);configured=true;};
 mp4.onSamples=(id,user,samples)=>{if(track&&id===track.id){pending.push(...samples);extracted+=samples.length;}};
 try{
  while(offset<file.size){
   if(++appends>100000)throw Error('MP4読み込み回数が上限を超えました');
   const end=Math.min(file.size,offset+1024*1024),ab=await file.slice(offset,end).arrayBuffer();ab.fileStart=offset;
   const next=mp4.appendBuffer(ab);if(problem)throw problem;
   if(ready&&!configured)await configureTrack();
   while(pending.length){const s=pending.shift();yield {sample:s,track};mp4.releaseUsedSamples(track.id,s.number+1);}
   if(ready&&extracted>=track.nb_samples)break;
   // Before moov, appendBuffer can skip the large mdat instead of buffering it.
   const candidate=Number.isSafeInteger(next)&&next>=0&&next!==offset?next:end;offset=candidate;
  }
  mp4.flush();if(problem)throw problem;
  if(ready&&!configured)await configureTrack();
  while(pending.length){const s=pending.shift();yield {sample:s,track};mp4.releaseUsedSamples(track.id,s.number+1);}
  if(!configured||extracted!==track.nb_samples)throw Error('映像サンプルを最後まで読み込めませんでした');
 }finally{mp4.stop();pending.length=0;}
}
