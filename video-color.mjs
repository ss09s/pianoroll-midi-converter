/* Preserve known native color metadata; leave absent fields to the bitstream decoder. */
export function decoderColorSpace(native){
 const source=native||{};
 const allowed={primaries:['bt709','bt470bg','smpte170m','bt2020','smpte432'],transfer:['bt709','smpte170m','iec61966-2-1','linear','pq','hlg'],matrix:['rgb','bt709','bt470bg','smpte170m','bt2020-ncl']},color={};
 for(const key of Object.keys(allowed))if(source[key]!=null){if(!allowed[key].includes(source[key]))throw Error('未検証の色設定（'+key+': '+source[key]+'）のため互換方式を使用します');color[key]=source[key];}
 if(typeof source.fullRange==='boolean')color.fullRange=source.fullRange;
 return Object.keys(color).length?color:undefined;
}
