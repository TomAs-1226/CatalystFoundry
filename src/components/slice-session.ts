import type {Job,Project} from '../domain/model';
import type {SliceJob,SliceJobSummary} from '../adapters/slicing';
import {fingerprint} from '../domain/invariants';
import {GEOMETRY_PREPARATION_VERSION} from '../domain/preparation-version';
import {deliverSlice,SliceAttachmentBusyError} from './slice-delivery';
import {monitorSlice,sliceActive} from './slice-monitor';

export interface SliceSessionState {slice?:SliceJob;phase:'idle'|'restoring'|'slicing'|'waiting'|'attaching'|'ready'|'blocked'|'outdated'|'error';message:string;}
interface Options {
 current:()=>{project:Project;job:Job};busy:()=>boolean;
 read:(id:string,signal:AbortSignal)=>Promise<SliceJob>;
 list:(hash:string,signal:AbortSignal)=>Promise<SliceJobSummary[]>;
 attach:(slice:SliceJob)=>Promise<void|boolean>;preview:(slice:SliceJob)=>void;
 changed:(state:SliceSessionState)=>void;
}
/** App-owned lifetime. Page/viewer unmounting never cancels delivery to the job. */
export class SliceSession {
 private state:SliceSessionState={phase:'idle',message:''};private key='';private epoch=0;private reads=0;private offers=0;private disposed=false;
 private stop?:()=>void;private restoreAbort?:AbortController;private delivering=false;private attempted?:string;
 constructor(private options:Options){}
 private currentKey(){const {project,job}=this.options.current();return `${project.id}:${job.id}`;}
 private publish(patch:Partial<SliceSessionState>){if(this.disposed)return;this.state={...this.state,...patch};this.options.changed(this.state);}
 context(){const key=this.currentKey();if(this.key===key)return;this.key=key;this.epoch++;this.reads++;this.offers++;this.stop?.();this.restoreAbort?.abort();this.attempted=undefined;this.delivering=false;this.state={phase:'idle',message:''};this.options.changed(this.state);}
 async restore(){
  this.context();const epoch=this.epoch,read=++this.reads,controller=new AbortController();this.restoreAbort?.abort();this.restoreAbort=controller;
  try{
   const {project,job}=this.options.current(),hash=await fingerprint(project,job);if(this.stale(epoch)||read!==this.reads)return;
   if(this.state.slice?.manifestHash===hash){await this.resume();return;}
   if(this.state.slice){this.attempted=undefined;this.publish({phase:'outdated',message:'This plate changed. Slice its current settings again.'});}
   if(!this.state.slice)this.publish({phase:'restoring',message:'Finding this plate’s saved slice…'});
   const jobs=await this.options.list(hash,controller.signal);
   if(this.stale(epoch)||read!==this.reads)return;
   const candidate=jobs.filter(j=>j.manifestHash===hash&&(!j.result||j.result.preparationVersion===GEOMETRY_PREPARATION_VERSION)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];
   if(!candidate){if(!this.state.slice)this.publish({phase:'idle',message:''});return;}
   const complete=await this.options.read(candidate.id,controller.signal);
   if(this.stale(epoch)||read!==this.reads)return;
   await this.accept(complete);
  }catch(error){if(!controller.signal.aborted&&!this.stale(epoch)&&read===this.reads)this.publish({phase:'error',message:`Could not recover the saved slice: ${(error as Error).message}. Retry recovery.`});}
 }
 async accept(slice:SliceJob){
  this.context();const epoch=this.epoch,offer=++this.offers,{project,job}=this.options.current();
  if(slice.manifestHash!==await fingerprint(project,job)||this.stale(epoch)||offer!==this.offers)return;
  this.reads++;this.restoreAbort?.abort();this.stop?.();this.attempted=undefined;
  this.publish({slice,phase:sliceActive(slice)?'slicing':slice.status==='succeeded'?'waiting':'error',message:sliceActive(slice)?'Slicing continues while you review the setup.':slice.error??''});
  if(sliceActive(slice))this.stop=monitorSlice(slice.id,{read:this.options.read,onDisconnected:()=>this.publish({message:'Reconnecting to local slicing… The job can continue in the background.'}),onStatus:next=>{if(this.stale(epoch))return;this.publish({slice:next,phase:sliceActive(next)?'slicing':next.status==='succeeded'?'waiting':'error',message:next.error??(sliceActive(next)?'Slicing continues in the background.':'')});if(next.status==='succeeded')void this.resume();}});
  else await this.resume();
 }
 private stale(epoch:number){return this.disposed||epoch!==this.epoch||this.key!==this.currentKey();}
 async resume(force=false){
  this.context();const slice=this.state.slice;if(!slice||slice.status!=='succeeded'||!slice.result||this.delivering||(!force&&this.attempted===slice.id))return;
  if(this.options.busy()){this.publish({phase:'waiting',message:'Finishing the current action before attaching layers…'});return;}
  const epoch=this.epoch;this.delivering=true;this.attempted=slice.id;this.publish({phase:'attaching',message:'Attaching and checking the exact native toolpath…'});
  try{
   const before=this.options.current();if(await fingerprint(before.project,before.job)!==slice.manifestHash){this.publish({phase:'outdated',message:'This plate changed. Slice its current settings again.'});return;}
   if(this.stale(epoch))return;
   await deliverSlice(slice,{current:this.options.current,attach:this.options.attach,preview:result=>{if(!this.stale(epoch)&&this.state.slice?.id===slice.id)this.options.preview(result);}});
   if(!this.stale(epoch)&&this.state.slice?.id===slice.id)this.publish({phase:'ready',message:'Exact native layers attached. Review them before approving.'});
  }catch(error){if(!this.stale(epoch)&&this.state.slice?.id===slice.id){
   if(error instanceof SliceAttachmentBusyError){this.attempted=undefined;this.publish({phase:'waiting',message:error.message});}
   else this.publish({phase:'blocked',message:(error as Error).message});
  }}finally{if(!this.stale(epoch)){this.delivering=false;if(this.state.slice?.id!==slice.id)void this.resume();}}
 }
 async retry(){if(this.state.slice?.status==='succeeded')await this.resume(true);else await this.restore();}
 dispose(){this.disposed=true;this.epoch++;this.stop?.();this.restoreAbort?.abort();}
}
