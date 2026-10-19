import {isApprovalCurrent,isToolpathCurrent} from '../domain/invariants';
import {serializeProject} from '../domain/persistence';
import type {Project} from '../domain/model';

// Currency checks parse exact native archives and geometry. Keep this work off
// the renderer; action-time domain checks remain authoritative and unchanged.
self.onmessage=async(event:MessageEvent<{key:number;project:Project}>)=>{
 const {key,project}=event.data,started=performance.now();
 try{
  const job=project.jobs.find(job=>job.id===project.activeJobId);
  if(!job)throw Error('Active plate is missing.');
  const json=serializeProject(project,false);
  const approvalCurrent=!!job.approval&&await isApprovalCurrent(project,job);
  const toolpathCurrent=approvalCurrent||!!job.toolpath&&await isToolpathCurrent(project,job);
  self.postMessage({key,json,approvalCurrent,toolpathCurrent,elapsedMs:performance.now()-started});
 }catch(error){self.postMessage({key,error:(error as Error).message});}
};
