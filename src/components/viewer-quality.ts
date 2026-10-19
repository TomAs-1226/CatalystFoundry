export type ViewerQuality='auto'|'quality'|'economy';
export function viewerBudget(quality:ViewerQuality,triangles:number,moving=false){
 const heavy=triangles>400_000;
 return {pixels:quality==='economy'?650_000:moving?1_000_000:quality==='quality'?3_000_000:heavy?1_200_000:2_000_000,
  ratio:quality==='economy'||moving?1:quality==='quality'?2:1.5,
  shadows:quality!=='economy'&&!moving&&(!heavy||quality==='quality'),
  edges:quality!=='economy'&&(!moving||!heavy)};
}
