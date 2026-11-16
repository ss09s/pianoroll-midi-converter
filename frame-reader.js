/* Native-resolution shared band: one draw/read, no resampling of selected rows. */
(function(root){'use strict';
function createReader(canvas,width,height,lines){
 if(!lines.length||lines.some(y=>!Number.isInteger(y)||y<0||y>=height))throw Error('Invalid sample rows');
 // Bound the transfer to requested rows; single-line mode is exactly one pixel high.
 const top=Math.min(...lines),bottom=Math.max(...lines),readHeight=bottom-top+1;
 canvas.width=width;canvas.height=readHeight;
 const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw Error('画像処理を初期化できません');
 return{ctx,read(source,display=null,coded=null,metrics={}){
  const t=performance.now();
  if(!display||display.direct)ctx.drawImage(source,0,-top,width,height);
  else{const [a,b,c,d,e,f]=display.transform,sx=width/display.width,sy=height/display.height;ctx.setTransform(sx*a,sy*b,sx*c,sy*d,sx*e,sy*f-top);ctx.drawImage(source,0,0,coded.width,coded.height);ctx.resetTransform();}
  const drawn=performance.now(),pixels=ctx.getImageData(0,0,width,readHeight).data,read=performance.now();
  metrics.drawMs=(metrics.drawMs||0)+drawn-t;metrics.pixelReadMs=(metrics.pixelReadMs||0)+read-drawn;metrics.imageMs=(metrics.imageMs||0)+read-t;
  metrics.frameDraws=(metrics.frameDraws||0)+1;metrics.pixelReads=(metrics.pixelReads||0)+1;metrics.pixelsPerRead=width*readHeight;metrics.fullFramePixels=width*height;metrics.sampleLineCount=lines.length;metrics.imageAcquisition='shared-native-band';
  return lines.map(y=>pixels.subarray((y-top)*width*4,(y-top+1)*width*4));
 }};
}
const api={createReader};if(typeof module==='object'&&module.exports)module.exports=api;else root.PianoRollFrameReader=api;
})(globalThis);
