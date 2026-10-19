import type {ToolpathPoint} from './toolpaths';
/** XY centre-format G2/G3. Chord error <= .02 mm; never executes commands.
 * G17 / I,J / G90.1,G91.1 semantics: https://linuxcnc.org/docs/html/gcode/g-code.html#gcode:g2-g3 */
export function arcPoints(from:ToolpathPoint,to:ToolpathPoint,center:[number,number],clockwise:boolean):ToolpathPoint[]{
  const radius=Math.hypot(from[0]-center[0],from[1]-center[1]),endRadius=Math.hypot(to[0]-center[0],to[1]-center[1]);
  if(![...from,...to,...center].every(Number.isFinite)||radius<.00001||Math.abs(radius-endRadius)>Math.max(.05,radius*.002))throw new Error('Arc centre does not match its endpoints.');
  const start=Math.atan2(from[1]-center[1],from[0]-center[0]),end=Math.atan2(to[1]-center[1],to[0]-center[0]);
  let sweep=end-start;
  if(clockwise){while(sweep>=-1e-9)sweep-=2*Math.PI;}else{while(sweep<=1e-9)sweep+=2*Math.PI;}
  const step=Math.min(Math.PI/18,2*Math.acos(Math.max(-1,1-.02/radius)));
  const count=Math.ceil(Math.abs(sweep)/step);if(count>10000)throw new Error('Arc exceeds the bounded preview limit.');
  return Array.from({length:count},(_,i)=>{const t=(i+1)/count,a=start+sweep*t;return i===count-1?[...to]:[center[0]+radius*Math.cos(a),center[1]+radius*Math.sin(a),from[2]+(to[2]-from[2])*t];});
}
