/* Local, bounded MP4 sample extraction. MP4Box.js 2.5.0 / BSD-3-Clause. */
import {createFile} from './vendor/mp4box/mp4box.all.mjs';
// ISO track matrix: [a,b,u,c,d,v,x,y,w]. Normalize quarter-turn translations.
export function displayGeometry(matrix,width,height,pixelAspectRatio=1){
 const m=Array.from(matrix||[]);
 if(m.length!==9||m[2]!==0||m[5]!==0||m[8]!==1073741824||!m.every(Number.isFinite))throw Error('透視変換を含む表示行列は互換方式を使用します');
 const rawLinear=[m[0],m[1],m[3],m[4]].map(n=>n/65536),mirrored=rawLinear[0]*rawLinear[3]-rawLinear[1]*rawLinear[2]<0,linear=rawLinear.map((n,i)=>mirrored&&(i===0||i===1)?-n:n),turns=[[1,0,0,1],[0,1,-1,0],[-1,0,0,-1],[0,-1,1,0]],turn=turns.findIndex(t=>t.every((n,i)=>n===linear[i]));
 if(turn<0)throw Error('拡縮・斜め回転を含む特殊な表示行列は互換方式を使用します');
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0||!Number.isFinite(pixelAspectRatio)||pixelAspectRatio<=0||pixelAspectRatio>100)throw Error('映像サイズが不正です');
 const [a,b,c,d]=rawLinear.map((n,i)=>i<2?n*pixelAspectRatio:n),corners=[[0,0],[width,0],[0,height],[width,height]].map(([x,y])=>[a*x+c*y,b*x+d*y]),minX=Math.min(...corners.map(p=>p[0])),minY=Math.min(...corners.map(p=>p[1]));
 return {rotation:turn*90,mirrored,direct:turn===0&&!mirrored,pixelAspectRatio,width:turn%2?height:width*pixelAspectRatio,height:turn%2?width*pixelAspectRatio:height,transform:[a,b,c,d,-minX,-minY]};
}
function av1Prefix(bytes){
 let at=0,delimiterEnd=0;while(at<bytes.length){const first=at,header=bytes[at++],type=(header>>3)&15;if(header&0x81||!(header&2))throw Error('AV1のOBU形式が不正です');if(header&4)at++;let length=0,mult=1,done=false;for(let i=0;i<8&&at<bytes.length;i++){const b=bytes[at++];length+=(b&127)*mult;if(!(b&128)){done=true;break;}mult*=128;}if(!done||!Number.isSafeInteger(length)||at+length>bytes.length)throw Error('AV1のOBUサイズが不正です');at+=length;if(first===0&&type===2)delimiterEnd=at;if(type===1)return{sequence:true,delimiterEnd};if(type===3||type===6)break;}
 return{sequence:false,delimiterEnd};
}
export function decoderChunkInit(sample,track){
 let data=sample.data;if(/^av01\./i.test(track.codec)&&sample.is_sync){const bytes=data instanceof Uint8Array?data:new Uint8Array(data),prefix=av1Prefix(bytes);if(!prefix.sequence){const config=track.av1ConfigOBUs;if(!config?.length||!av1Prefix(config).sequence)throw Error('AV1キーフレームのシーケンスヘッダーがありません');const joined=new Uint8Array(bytes.length+config.length);joined.set(bytes.subarray(0,prefix.delimiterEnd));joined.set(config,prefix.delimiterEnd);joined.set(bytes.subarray(prefix.delimiterEnd),prefix.delimiterEnd+config.length);data=joined;}}
 return{type:sample.is_sync?'key':'delta',timestamp:Math.round((sample.cts-track.mediaTime)*1e6/track.timescale),duration:Math.round(sample.duration*1e6/track.timescale),data};
}
export async function* videoPackets(file,configure,inspect=()=>{}){
 const head=new Uint8Array(await file.slice(0,12).arrayBuffer());
 if(head.length<8)throw Error('動画ファイルが短すぎます');
 if(head[0]===0x1a&&head[1]===0x45&&head[2]===0xdf&&head[3]===0xa3)throw Error('WebM・Matroskaの高速読み取りは未対応のため互換方式を使用します');
 const type=String.fromCharCode(...head.slice(4,8));
 if(!['ftyp','moov','mdat','free','wide','skip','uuid'].includes(type))throw Error('MP4・MOV以外の高速読み取りには未対応のため互換方式を使用します');
 const mp4=createFile(),pending=[];let track,problem,ready=false,configured=false,offset=0,extracted=0,appends=0,fragmented=false;
 mp4.onError=e=>{problem=Error('MP4: '+e)};
 mp4.onReady=info=>{
  try{
   fragmented=!!info.isFragmented;
   if(info.videoTracks.length!==1)throw Error('複数の映像トラックには未対応のため互換方式を使用します');
   track=info.videoTracks[0];const raw=mp4.getTrackById(track.id),entries=raw.mdia.minf.stbl.stsd.entries,entry=entries[0],m=Array.from(raw.tkhd.matrix||[]);
   inspect({fragmented,codec:track.codec,sampleEntry:entry?.type,width:track.video?.width,height:track.video?.height,matrix:m,pixelAspectRatio:entry?.pasp?{horizontal:entry.pasp.hSpacing,vertical:entry.pasp.vSpacing}:null,cleanAperture:entry?.clap?{widthN:entry.clap.cleanApertureWidthN,widthD:entry.clap.cleanApertureWidthD,heightN:entry.clap.cleanApertureHeightN,heightD:entry.clap.cleanApertureHeightD,horizontalOffset:entry.clap.horizOffN,verticalOffset:entry.clap.vertOffN}:null,containerColor:entry?.colr?{type:entry.colr.colour_type,primaries:entry.colr.colour_primaries,transfer:entry.colr.transfer_characteristics,matrix:entry.colr.matrix_coefficients}:null});
   const box=/^avc[13]\./i.test(track.codec)?entry?.avcC:/^(hvc1|hev1)\./i.test(track.codec)?entry?.hvcC:/^av01\./i.test(track.codec)?entry?.av1C:null;
   if(entries.length!==1||!box)throw Error('高速方式に非対応の映像形式です（'+track.codec+'）。H.264・H.265/HEVC・AV1に対応しています');
   const pasp=entry.pasp;
   if(pasp&&(!Number.isSafeInteger(pasp.hSpacing)||!Number.isSafeInteger(pasp.vSpacing)||pasp.hSpacing<=0||pasp.vSpacing<=0))throw Error('画素の縦横比が不正です');
   const display=displayGeometry(m,track.video.width,track.video.height,pasp?pasp.hSpacing/pasp.vSpacing:1);
   if(entry.clap&&(entry.clap.cleanApertureWidthN/entry.clap.cleanApertureWidthD!==track.video.width||entry.clap.cleanApertureHeightN/entry.clap.cleanApertureHeightD!==track.video.height||entry.clap.horizOffN!==0||entry.clap.vertOffN!==0))throw Error('映像の切り抜き指定には未対応のため互換方式を使用します');
   const edits=raw.edts?.elst?.entries||[];
   if(edits.length>1||edits.some(e=>e.media_time<0||e.media_rate_integer!==1||e.media_rate_fraction!==0))throw Error('複雑な編集タイムラインは互換方式を使用します');
   if(!Number.isFinite(track.timescale)||track.timescale<=0||!Number.isSafeInteger(track.nb_samples)||track.nb_samples<(fragmented?0:1)||track.nb_samples>1000000)throw Error('映像の時刻情報が不正です');
   const configurationRange={start:box.start+box.hdr_size,end:box.start+box.size},mediaTime=edits[0]?.media_time||0;
   if(!Number.isSafeInteger(configurationRange.start)||!Number.isSafeInteger(configurationRange.end)||configurationRange.start<0||configurationRange.end>file.size||configurationRange.end<=configurationRange.start||configurationRange.end-configurationRange.start>1024*1024)throw Error('映像デコード設定が不正です');
   track={...track,fragmented,mediaTime,configurationRange,display,...(/^av01\./i.test(track.codec)?{av1ConfigOBUs:box.configOBUs?.slice()||new Uint8Array()}:{}),config:{codec:track.codec,codedWidth:track.video.width,codedHeight:track.video.height,hardwareAcceleration:'no-preference'}};ready=true;
   mp4.setExtractionOptions(track.id,null,{nbSamples:16});mp4.start();
  }catch(e){problem=e;}
 };
 const configureTrack=async()=>{if(/^av01\./i.test(track.codec)){await configure(track);configured=true;return;}const {start,end}=track.configurationRange;const bytes=await file.slice(start,end).arrayBuffer();if(bytes.byteLength!==end-start)throw Error('映像デコード設定を読み込めません');track.config.description=new Uint8Array(bytes);await configure(track);configured=true;};
 mp4.onSamples=(id,user,samples)=>{if(track&&id===track.id){if(extracted+samples.length>1000000){problem=Error('映像サンプル数が上限を超えました');return;}pending.push(...samples);extracted+=samples.length;}};
 try{
  while(offset<file.size){
   if(++appends>100000)throw Error('MP4読み込み回数が上限を超えました');
   const end=Math.min(file.size,offset+1024*1024),ab=await file.slice(offset,end).arrayBuffer();ab.fileStart=offset;
   const next=mp4.appendBuffer(ab,end===file.size);if(problem)throw problem;
   if(ready&&!configured)await configureTrack();
   while(pending.length){const s=pending.shift();yield {sample:s,track};mp4.releaseUsedSamples(track.id,s.number+1);}
   if(ready&&!fragmented&&extracted>=track.nb_samples)break;
   // Before moov, appendBuffer can skip the large mdat instead of buffering it.
   const candidate=!fragmented&&Number.isSafeInteger(next)&&next>=0&&next!==offset?next:end;offset=candidate;
  }
  mp4.flush();if(problem)throw problem;
  if(ready&&!configured)await configureTrack();
  while(pending.length){const s=pending.shift();yield {sample:s,track};mp4.releaseUsedSamples(track.id,s.number+1);}
  if(fragmented&&track)track.nb_samples=mp4.getTrackById(track.id).samples.length;
  if(!configured||extracted<1||extracted!==track.nb_samples)throw Error('映像サンプルを最後まで読み込めませんでした');
 }finally{mp4.stop();pending.length=0;}
}
