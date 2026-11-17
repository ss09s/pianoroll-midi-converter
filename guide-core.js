/* Keyboard boundary refinement, independent of note colour. */
(function(root){'use strict';
// Preserve the physical key pattern when translating its integer index origin.
function normalizePattern(anchor,step,phase){
 if(!Number.isFinite(anchor)||!Number.isFinite(step)||step<=0||!Number.isFinite(phase))throw Error('鍵盤の位置・幅が不正です');
 const shift=Math.floor(anchor/step);return{anchor:anchor-shift*step,phase:((phase-shift)%7+7)%7};
}
// Measure the visible keyboard, excluding bottom padding. Size is learned
// from many keys; pressed/occluded keys may abstain instead of setting a ratio.
function measureKeyboard(data,width,height,{top,anchor,step,phase,shifts}){
 const clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),median=a=>a.slice().sort((a,b)=>a-b)[Math.floor(a.length/2)],sharp=[0,1,3,4,5];
 const lum=(x,y)=>{x=clamp(Math.round(x),0,width-1);y=clamp(Math.round(y),0,height-1);const i=(y*width+x)*4;return .2126*data[i]+.7152*data[i+1]+.0722*data[i+2];};
 const whites=[];for(let j=Math.floor(-anchor/step);j<=Math.ceil((width-anchor)/step);j++){const x=anchor+(j+.5)*step;if(x>step&&x<width-step)whites.push(x);}if(whites.length<9)return null;
 let bottom=-1,gap=0;for(let y=Math.round(top+8);y<height;y++){const values=whites.map(x=>lum(x,y));if(values.filter(v=>v>115).length>=values.length*.65&&median(values)>140){bottom=y+1;gap=0;}else if(bottom>top+20&&++gap>=3)break;}if(bottom<top+20)return null;
 const blackEnds=[];for(let j=Math.floor(-anchor/step);j<=Math.ceil((width-anchor)/step);j++){const key=((phase+j)%7+7)%7,k=sharp.indexOf(key);if(k<0)continue;const x=anchor+(j+1+(shifts[k]||0))*step;if(x<step||x>width-step)continue;let last=-1,hits=0;
  for(let y=Math.round(top+4);y<top+(bottom-top)*.87;y++){const contrast=(lum(x-step*.48,y)+lum(x+step*.48,y))*.5-lum(x,y);if(contrast>60){last=y+1;hits++;}}
  if(last>top+(bottom-top)*.22&&hits>=(last-top-4)*.7)blackEnds.push(last);
 }if(blackEnds.length<6)return null;const blackBottom=median(blackEnds);
 // Fit white-key dividing lines in the unobstructed lower key bodies.
 const sampleYs=[.23,.42,.61].map(f=>blackBottom+(bottom-blackBottom)*f),boundaries=[];
 for(let j=Math.floor(-anchor/step);j<=Math.ceil((width-anchor)/step);j++){const expected=anchor+j*step;if(expected<step||expected>width-step)continue;let best=null;
  for(let x=Math.round(expected-step*.16);x<=expected+step*.16;x++){const mid=sampleYs.reduce((a,y)=>a+lum(x,y),0)/sampleYs.length,outer=sampleYs.reduce((a,y)=>a+(lum(x-step*.27,y)+lum(x+step*.27,y))*.5,0)/sampleYs.length,contrast=outer-mid;if(contrast>25&&(!best||contrast>best.contrast))best={j,x,contrast};}if(best)boundaries.push(best);
 }
 let latticeRows=0;if(boundaries.length>=9&&boundaries.at(-1).x-boundaries[0].x>=width*.65){const fit=ps=>{const mj=ps.reduce((a,p)=>a+p.j,0)/ps.length,mx=ps.reduce((a,p)=>a+p.x,0)/ps.length,den=ps.reduce((a,p)=>a+(p.j-mj)**2,0),s=ps.reduce((a,p)=>a+(p.j-mj)*(p.x-mx),0)/den;return{step:s,anchor:mx-s*mj};};let f=fit(boundaries);const good=boundaries.filter(p=>Math.abs(p.x-(f.anchor+p.j*f.step))<=1.5);if(good.length>=boundaries.length*.8){f=fit(good);if(Math.abs(f.step-step)<step*.03&&Math.abs(f.anchor-anchor)<step*.2){anchor=f.anchor;step=f.step;latticeRows=good.length;}}}
 const widths=[],offsets=sharp.map(()=>[]),heights=blackBottom-top;
 for(let j=Math.floor(-anchor/step);j<=Math.ceil((width-anchor)/step);j++){const key=((phase+j)%7+7)%7,k=sharp.indexOf(key);if(k<0)continue;const center=anchor+(j+1+(shifts[k]||0))*step;if(center<step||center>width-step)continue;
  for(const f of [.18,.35,.52]){const y=top+heights*f,level=lum(center,y),outer=(lum(center-step*.48,y)+lum(center+step*.48,y))*.5;if(outer-level<70)continue;const threshold=(outer+level)*.5;let a=Math.round(center),b=a;while(a>center-step*.47&&lum(a-1,y)<threshold)a--;while(b<center+step*.47&&lum(b+1,y)<threshold)b++;if(a<=center-step*.47||b>=center+step*.47)continue;
   const la=lum(a-1,y),lb=lum(a,y),ra=lum(b,y),rb=lum(b+1,y),left=a-1+(la-threshold)/Math.max(1,la-lb),right=b+(threshold-ra)/Math.max(1,rb-ra),w=right-left;if(w>=step*.28&&w<=step*.9){widths.push(w);offsets[k].push(((left+right)/2-anchor-(j+1)*step)/step);}
  }
 }if(widths.length<12)return null;
 const normalized=normalizePattern(anchor,step,phase),result={...normalized,step,bottom,blackBottom,keyboardHeight:(bottom-top)/height*100,blackWidthPct:clamp(median(widths)/step*100,30,90),blackHeightPct:clamp((blackBottom-top)/(bottom-top)*100,25,85),shifts:offsets.map((a,i)=>a.length>=3?clamp(median(a),-.23,.23):shifts[i]),support:{whiteBoundaries:latticeRows,blackWidths:widths.length,blackHeights:blackEnds.length}};
 return result;
}
function refineTop(data,width,height,coarse,anchor,step){
 const lum=(x,y)=>{const i=(y*width+Math.round(x))*4;return .2126*data[i]+.7152*data[i+1]+.0722*data[i+2]};
 const edges=[];let count=0;const radius=Math.max(8,Math.round(height*.025));
 for(let j=Math.floor(-anchor/step);j<Math.ceil((width-anchor)/step);j++){
  const x=anchor+(j+.5)*step;if(x<2||x>=width-2)continue;count++;
  let best=null;
  for(let y=Math.max(3,Math.round(coarse)-radius);y<=Math.min(height-5,Math.round(coarse)+radius);y++){
   const before=(lum(x,y-2)+lum(x,y-1))/2,after=(lum(x,y)+lum(x,y+1))/2,jump=after-before;
   if(after>115&&jump>35&&(!best||jump>best.jump))best={y,jump};
  }
  if(best)edges.push(best.y);
 }
 if(edges.length<Math.max(8,count*.4))return null;
 edges.sort((a,b)=>a-b);const median=edges[Math.floor(edges.length/2)],agree=edges.filter(y=>Math.abs(y-median)<=2);
 if(agree.length<edges.length*.65)return null;
 return {y:median,agreement:agree.length,samples:count};
}
function safeHitLine(data,width,height,top,anchor,step){
 top=Math.max(3,Math.min(height-1,Math.round(top)));const values=[],rises=[];
 const lum=(x,y)=>{const i=(y*width+Math.round(x))*4;return .2126*data[i]+.7152*data[i+1]+.0722*data[i+2]};
 for(let j=Math.floor(-anchor/step);j<Math.ceil((width-anchor)/step);j++){const x=anchor+(j+.5)*step;if(x<1||x>=width-1)continue;values.push(lum(x,top-1));rises.push(lum(x,top-1)-lum(x,top-3));}
 values.sort((a,b)=>a-b);rises.sort((a,b)=>a-b);const mid=Math.floor(values.length/2);
 // A resampled keyboard edge can bleed into the pixel just above it.
 return Math.max(0,top-(values[mid]>45&&rises[mid]>20?2:1));
}
const api={refineTop,safeHitLine,normalizePattern,measureKeyboard};if(typeof module==='object'&&module.exports)module.exports=api;else root.PianoRollGuideCore=api;
})(globalThis);
