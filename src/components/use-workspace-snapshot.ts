import {useEffect,useState} from 'react';
import type {Project} from '../domain/model';
export interface WorkspaceSnapshot {json:string;approvalCurrent:boolean;toolpathCurrent:boolean;elapsedMs:number;}
export function workspaceSnapshot(project:Project,signal?:AbortSignal):Promise<WorkspaceSnapshot>{
 return new Promise((resolve,reject)=>{
  let worker:Worker;
  const stop=()=>{worker?.terminate();signal?.removeEventListener('abort',abort);};
  const abort=()=>{stop();reject(new DOMException('Superseded workspace snapshot','AbortError'));};
  if(signal?.aborted){abort();return;}
  try{
   worker=new Worker(new URL('./workspace-snapshot.worker.ts',import.meta.url),{type:'module'});
   signal?.addEventListener('abort',abort,{once:true});
   worker.onmessage=event=>{stop();event.data.error?reject(Error(event.data.error)):resolve(event.data);};
   worker.onerror=()=>{stop();reject(Error('Workspace checks could not finish. Save a portable project and reopen Foundry.'));};
   worker.postMessage({key:1,project});
  }catch(error){stop();reject(error);}
 });
}
export function useWorkspaceSnapshot(project:Project,enabled:boolean){
 const [result,setResult]=useState<{project:Project;value?:WorkspaceSnapshot;error?:string}>();
 useEffect(()=>{
  if(!enabled)return;
  const controller=new AbortController();
  const timer=setTimeout(()=>void workspaceSnapshot(project,controller.signal).then(value=>setResult({project,value})).catch(error=>{if(!controller.signal.aborted)setResult({project,error:error.message});}),100);
  return()=>{clearTimeout(timer);controller.abort();};
 },[project,enabled]);
 const current=result?.project===project?result:undefined;
 return {snapshot:current?.value,error:current?.error,checking:enabled&&!current};
}
