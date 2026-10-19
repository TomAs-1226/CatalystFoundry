import {ArrowDownToLine,Hand,Move,Rotate3D,ScanLine,Layers3} from 'lucide-react';
interface Props {tool:'orbit'|'move'|'face';disabled:boolean;busy:boolean;hasItems:boolean;onTool:(tool:Props['tool'])=>void;onArrange:()=>void;onLayFlat:()=>void;onFloor:()=>void;onRotate:(axis:number,delta:number)=>void;}
/** Direct tools stay beside the plate; numerical transforms remain in Part settings. */
export default function PlateTools(props:Props){return <><div className="plate-tools" role="toolbar" aria-orientation="vertical" aria-label="Plate preparation tools">
  <button className={props.tool==='orbit'?'active':''} title="Select / orbit" aria-label="Select / orbit" aria-pressed={props.tool==='orbit'} onClick={()=>props.onTool('orbit')}><Hand size={17}/></button>
  <button disabled={props.disabled} className={props.tool==='move'?'active':''} title="Move selected part" aria-label="Move selected part" aria-pressed={props.tool==='move'} onClick={()=>props.onTool(props.tool==='move'?'orbit':'move')}><Move size={17}/></button>
  <details className="plate-rotation"><summary aria-label="Rotate selected part" title="Rotate selected part"><Rotate3D size={16}/><span>Rotate</span></summary><div>{['X','Y','Z'].map((axis,index)=><div key={axis}><span>{axis}</span><button aria-label={`Rotate ${axis} minus 90 degrees`} disabled={props.disabled} onClick={()=>props.onRotate(index,-90)}>−90°</button><button aria-label={`Rotate ${axis} plus 90 degrees`} disabled={props.disabled} onClick={()=>props.onRotate(index,90)}>+90°</button></div>)}</div></details>
  <button disabled={props.disabled} title="Lay flat" aria-label="Lay flat" onClick={props.onLayFlat}><Layers3 size={17}/></button>
  <button disabled={props.disabled} className={props.tool==='face'?'active':''} title="Place on face" aria-label="Place on face" aria-pressed={props.tool==='face'} onClick={()=>props.onTool(props.tool==='face'?'orbit':'face')}><ScanLine size={17}/></button>
  <button disabled={props.disabled} title="Drop to plate" aria-label="Drop to plate" onClick={props.onFloor}><ArrowDownToLine size={17}/></button>
</div>
<button className="plate-auto-prepare btn" disabled={props.busy||!props.hasItems} title="Lay flat automatic parts and arrange all copies" onClick={props.onArrange}><Layers3 size={15}/>Auto prepare</button>
{props.tool!=='orbit'&&<span className="plate-tool-hint" role="status">{props.tool==='move'?'Drag a part to move it.':'Click the face to put on the bed.'} Click the active tool to finish.</span>}
</>;}

