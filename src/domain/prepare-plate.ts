import type {Job,Project} from './model';
import {orientPlate} from './plate-orientation';
import {arrangePlate,recommendSupports} from './auto-prepare';
export async function preparePlateModel(project:Project,job:Job,arrange:boolean,orient:boolean){
  const prepared=structuredClone(job);
  if(arrange){if(orient)prepared.items=await orientPlate(project,prepared);prepared.items=arrangePlate(project,prepared);}
  let reason='';
  if(prepared.settings.supports&&prepared.settings.supportStyle==='auto'&&prepared.settings['bambu.support_type']===undefined){
    const recommendation=await recommendSupports(project,prepared);prepared.settings.supportResolvedStyle=recommendation.style;reason=`Automatic: ${recommendation.style}. ${recommendation.reason}`;
  }
  if((prepared.settings.infillMode??'auto')==='auto'&&prepared.settings['bambu.sparse_infill_pattern']===undefined){
    const bulky=prepared.items.some(item=>{const part=project.parts.find(part=>part.id===item.partId);return part&&part.geometry.dimensions.reduce((a,b)=>a*b,1)>=8000;});
    prepared.settings.infillMode='auto';prepared.settings.infillResolvedPattern=prepared.settings.infill===100?'zig-zag':bulky&&prepared.settings.infill<40?'adaptivecubic':'gyroid';
    reason+=`${reason?' ':''}Smart infill: ${prepared.settings.infillResolvedPattern==='adaptivecubic'?'Adaptive Cubic':prepared.settings.infillResolvedPattern==='zig-zag'?'Rectilinear':'Gyroid'} at your ${prepared.settings.infill}% density. Density and wall count are retained; no load capacity is inferred.`;
  }
  return{items:prepared.items,settings:prepared.settings,reason};
}
