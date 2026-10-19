import type {Job,Project} from '../domain/model';
import type {SliceJob} from '../adapters/slicing';
import {fingerprint,isToolpathCurrent} from '../domain/invariants';
export class SliceAttachmentBusyError extends Error {constructor(){super('The slice was not attached while another action was finishing. Attachment will retry automatically.');}}
/** Attach before navigation. A failed action is visible and may be retried explicitly. */
export async function deliverSlice(slice:SliceJob,options:{current:()=>{project:Project;job:Job};attach:(slice:SliceJob)=>Promise<void|boolean>;preview:(slice:SliceJob)=>void}){
  const {project,job}=options.current();
  if(!slice.result||await fingerprint(project,job)!==slice.manifestHash)throw Error('The plate changed. Slice this plate again.');
  if(slice.result.previewSupported===false){options.preview(slice);throw Error('Native layer preview is incomplete. Review the listed command issue in Bambu Connect; Foundry approval stays blocked.');}
  if(job.toolpath?.hash===slice.result.toolpathHash){if(!job.toolpath.mappingConfirmed||job.toolpath.stale)throw Error('This toolpath mapping was withdrawn. Slice a new result or explicitly rebind it before approval.');}
  else if(await options.attach(slice)===false)throw new SliceAttachmentBusyError();
  const latest=options.current();if(latest.project.id!==project.id||latest.job.id!==job.id||await fingerprint(latest.project,latest.job)!==slice.manifestHash)throw Error('The active plate changed during attachment.');
  if(latest.job.toolpath?.hash!==slice.result.toolpathHash||!await isToolpathCurrent(latest.project,latest.job))throw Error('The exact native toolpath was not retained in this plate. Retry attachment before approval.');
  options.preview(slice);
}
