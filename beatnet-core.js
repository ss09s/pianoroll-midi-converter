/* BeatNet frontend: 22050 Hz, centered 1411-point Hann, 136 log bands + positive differences.
 * Coefficients/reference data: beatnet-rs 0.1.0 / madmom. See vendor/beatnet/LICENSE.txt.
 * Bluestein FFT and experimental peak decoder implemented for this application.
 */
(function(root){
'use strict';
function fft(re,im,inverse=false){
 const n=re.length;
 for(let i=1,j=0;i<n;i++){let b=n>>1;for(;j&b;b>>=1)j^=b;j^=b;if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]];}}
 for(let len=2;len<=n;len*=2){const a=(inverse?2:-2)*Math.PI/len,wr=Math.cos(a),wi=Math.sin(a);
 for(let start=0;start<n;start+=len){let cr=1,ci=0;for(let j=0;j<len/2;j++){const p=start+j,q=p+len/2,tr=re[q]*cr-im[q]*ci,ti=re[q]*ci+im[q]*cr;re[q]=re[p]-tr;im[q]=im[p]-ti;re[p]+=tr;im[p]+=ti;const nr=cr*wr-ci*wi;ci=cr*wi+ci*wr;cr=nr;}}}
 if(inverse)for(let i=0;i<n;i++){re[i]/=n;im[i]/=n;}
}
class Frontend{
 constructor(window,bank){
  if(window.length!==1411||bank.length!==705*136)throw Error('BeatNet特徴量係数が不正です');
  this.window=window;this.prev=new Float32Array(136);this.frame=0;this.cr=new Float64Array(1411);this.ci=new Float64Array(1411);
  this.br=new Float64Array(4096);this.bi=new Float64Array(4096);this.re=new Float64Array(4096);this.im=new Float64Array(4096);this.mag=new Float32Array(705);
  for(let k=0;k<1411;k++){const a=Math.PI*(k*k%2822)/1411;this.cr[k]=Math.cos(a);this.ci[k]=Math.sin(a);this.br[k]=this.cr[k];this.bi[k]=this.ci[k];if(k){this.br[4096-k]=this.cr[k];this.bi[4096-k]=this.ci[k];}}
  fft(this.br,this.bi);this.filters=Array.from({length:136},(_,b)=>{const f=[];for(let k=0;k<705;k++)if(bank[k*136+b])f.push([k,bank[k*136+b]]);return f;});
 }
 process(readSample,center){
  const {re,im,cr,ci,br,bi}=this;re.fill(0);im.fill(0);
  for(let k=0;k<1411;k++){const x=readSample(center+k-705)*this.window[k];re[k]=x*cr[k];im[k]=-x*ci[k];}
  fft(re,im);for(let k=0;k<4096;k++){const r=re[k]*br[k]-im[k]*bi[k];im[k]=re[k]*bi[k]+im[k]*br[k];re[k]=r;}fft(re,im,true);
  for(let k=0;k<705;k++)this.mag[k]=Math.hypot(Math.fround(re[k]*cr[k]+im[k]*ci[k]),Math.fround(im[k]*cr[k]-re[k]*ci[k]));
  const out=new Float32Array(272);
  for(let b=0;b<136;b++){let sum=0;for(const [k,w] of this.filters[b])sum+=this.mag[k]*w;const v=Math.fround(Math.log10(1+Math.fround(sum)));out[b]=v;out[b+136]=this.frame?Math.max(0,v-this.prev[b]):0;this.prev[b]=v;}
  this.frame++;return out;
 }
}
// Deliberately keep raw activations and identify this decoder in exported results.
// This is NOT the original BeatNet particle filter and does not certify meter.
function decode(activations,duration){
 const candidates=[];
 for(let i=1;i<activations.length/2-1;i++){const p=activations[2*i]+activations[2*i+1],a=activations[2*i-2]+activations[2*i-1],b=activations[2*i+2]+activations[2*i+3];if(p>=.15&&p>a&&p>=b)candidates.push({t:i*.02,p,d:activations[2*i+1]});}
 const kept=[];
 for(const c of candidates){const last=kept.at(-1);if(last&&c.t-last.t<.24){if(c.p>last.p)kept[kept.length-1]=c;}else kept.push(c);}
 const beats=kept.filter(c=>c.t<duration).map(c=>c.t);
 const downbeats=kept.filter(c=>c.t<duration&&c.d>=.15&&c.d>=c.p*.5).map(c=>c.t);
 return {beats,downbeats,decoder:'peak-v1 (experimental; not official PF/DBN)',meterVerified:false};
}
const api={Frontend,decode};if(typeof module==='object'&&module.exports)module.exports=api;else root.PianoRollBeatNetCore=api;
})(typeof self!=='undefined'?self:globalThis);
