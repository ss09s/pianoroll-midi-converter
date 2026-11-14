/* Independent horizontal/vertical pinch scale. Small cross-axis jitter is ignored. */
(function(root){'use strict';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function axisScale(before,after){const d=after-before;if(Math.abs(d)<6)return 1;return clamp(before>=40?after/before:Math.exp(d/100),.15,8);}
function pinch(a,b,c,d){return {x:axisScale(Math.abs(a.x-b.x),Math.abs(c.x-d.x)),y:axisScale(Math.abs(a.y-b.y),Math.abs(c.y-d.y))};}
const api={pinch};if(typeof module==='object'&&module.exports)module.exports=api;else root.PianoRollEditorGesture=api;
})(globalThis);
