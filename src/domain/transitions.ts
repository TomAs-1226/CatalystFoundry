import type { Job, Project } from './model';
import { invalidateJob, manufacturingManifest, stableStringify } from './invariants';
function relevantInputs(project:Project,job:Job):string {
 return stableStringify({manifest:manufacturingManifest(project,job,true),gcode:job.toolpath?.gcode,slicerProjectData:job.toolpath?.slicerProject?.data,stale:job.toolpath?.stale,
  geometry:job.items.map(item=>project.parts.find(part=>part.id===item.partId)?.geometry)});
}
/** Shared source records can affect more than the active job. Revoke every changed manifest. */
export function invalidateChangedJobs(before:Project,after:Project,reason='Shared manufacturing inputs changed.'):string[]{
 const changed:string[]=[];
 for(const job of after.jobs){const previous=before.jobs.find(j=>j.id===job.id);if(!previous)continue;
  if(relevantInputs(before,previous)!==relevantInputs(after,job)){invalidateJob(job,reason);changed.push(job.id)}
 }
 return changed;
}
