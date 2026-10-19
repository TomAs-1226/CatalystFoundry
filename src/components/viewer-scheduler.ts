/** Coalesce pointer/control/effect updates; a stationary scene schedules nothing. */
export function frameScheduler(draw:()=>void,request:(callback:FrameRequestCallback)=>number,cancel:(id:number)=>void){
  let pending:number|undefined,disposed=false;
  return {render(){if(disposed||pending!==undefined)return;pending=request(()=>{pending=undefined;if(!disposed)draw();});},dispose(){disposed=true;if(pending!==undefined)cancel(pending);pending=undefined;}};
}

/** Bound fill cost on large/high-DPI windows; drag stays at most native resolution. */
export function viewerPixelRatio(width:number,height:number,deviceRatio:number,moving=false,pixels=moving?1_000_000:2_000_000,maxRatio=moving?1:1.5){
  return Math.min(Math.max(.5,Number.isFinite(deviceRatio)?deviceRatio:1),maxRatio,Math.sqrt(pixels/Math.max(1,width*height)));
}
