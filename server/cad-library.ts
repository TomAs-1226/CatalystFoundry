import {mkdir,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Express} from 'express';
import {encodeSharedCad,decodeSharedCad} from '../src/domain/shared-cad';
import {SNAPSHOT_TEAM_LIMIT,snapshotHash,type SharedSnapshot,type SnapshotDownload,type SnapshotUpload} from '../src/domain/shared-cad-contract';
import {digest,canonical} from '../sync/types';
import type {Part} from '../src/domain/model';
import type {LiveOnshapeSelection} from '../src/adapters/onshape-http';
import type {RemoteSync} from './sync';

interface Index {snapshots:SharedSnapshot[];cachedIds:string[];pending:string[];lastSync?:string;}
interface State {scope:string;directory:string;index:Index;mode:'offline'|'online'|'syncing';error:string;}
const initial=(scope='',directory=''):State=>({scope,directory,index:{snapshots:[],cachedIds:[],pending:[]},mode:'offline',error:''});
export class CadLibrary {
 private state=initial();private active?:Promise<void>;private writes=Promise.resolve();private timer?:ReturnType<typeof setInterval>;private stopped=false;
 constructor(private root:string,private sync:Pick<RemoteSync,'localCacheScope'|'request'>){}
 private async atomic(state:State,name:string,value:unknown){await mkdir(state.directory,{recursive:true});const target=join(state.directory,name),temp=target+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(value),{mode:0o600});await rename(temp,target);}
 private async identity(){const scope=await this.sync.localCacheScope();if(scope===this.state.scope)return this.state;const state=initial(scope,scope?join(this.root,'team-cad',scope):'');this.state=state;
  if(scope)try{const index=JSON.parse(await readFile(join(state.directory,'index.json'),'utf8')) as Index;if(!Array.isArray(index.snapshots)||!Array.isArray(index.cachedIds)||!Array.isArray(index.pending))throw Error('Invalid local CAD catalog');index.cachedIds.forEach(id=>snapshotHash.parse(id));index.pending.forEach(id=>snapshotHash.parse(id));index.snapshots.forEach(s=>snapshotHash.parse(s.id));state.index=index;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')state.error='Local CAD catalog could not be read. Reconnect to refresh it.';}
  return state;
 }
 private serial<T>(fn:()=>Promise<T>):Promise<T>{const result=this.writes.then(fn);this.writes=result.then(()=>{},()=>{});return result;}
 private async current(state:State){return !this.stopped&&state.scope===await this.sync.localCacheScope();}
 async status(){const state=await this.identity();return{...state.index,mode:state.mode,error:state.error,pendingCount:state.index.pending.length,localAccount:!!state.scope};}
 async start(){await this.identity();void this.kick();this.timer=setInterval(()=>void this.kick(),300000);this.timer.unref();}
 stop(){this.stopped=true;if(this.timer)clearInterval(this.timer);}
 kick(){if(!this.active)this.active=this.refresh().finally(()=>{this.active=undefined;});return this.active;}
 async refresh(){return this.serial(async()=>{const state=await this.identity();if(!state.scope||this.stopped)return;state.mode='syncing';state.error='';try{
   for(const id of [...state.index.pending]){const upload=JSON.parse(await readFile(join(state.directory,'pending-'+id+'.json'),'utf8')) as SnapshotUpload;if(!await this.current(state))return;const saved=await this.sync.request<SharedSnapshot>('/v1/cad/snapshots','POST',upload);if(!await this.current(state))return;await this.cache(state,{...saved,payload:upload.payload});state.index.pending=state.index.pending.filter(value=>value!==id);state.index.snapshots=state.index.snapshots.filter(s=>s.id!==id&&s.id!==saved.id);state.index.snapshots.unshift(saved);await this.atomic(state,'index.json',state.index);await unlink(join(state.directory,'pending-'+id+'.json')).catch(()=>{});}
   if(!await this.current(state))return;const {snapshots}=await this.sync.request<{snapshots:SharedSnapshot[]}>('/v1/cad/snapshots');if(!await this.current(state))return;
   // Show metadata immediately; download and validate geometry one snapshot at a time.
   state.index.snapshots=snapshots;await this.atomic(state,'index.json',state.index);
   for(const item of snapshots){if(state.index.cachedIds.includes(item.id))continue;if(!await this.current(state))return;const record=await this.sync.request<SnapshotDownload>('/v1/cad/snapshots/'+snapshotHash.parse(item.id));if(!await this.current(state))return;if(record.id!==item.id||record.contentHash!==item.contentHash||record.payloadHash!==item.payloadHash)throw Error('Cloud CAD identity changed; refresh the library.');await this.cache(state,record);await this.atomic(state,'index.json',state.index);}
   const active=new Set(state.index.snapshots.map(s=>s.id));for(const id of state.index.cachedIds.filter(id=>!active.has(id)))await unlink(join(state.directory,snapshotHash.parse(id)+'.json')).catch(()=>{});state.index.cachedIds=state.index.cachedIds.filter(id=>active.has(id));state.index.lastSync=new Date().toISOString();state.mode='online';await this.atomic(state,'index.json',state.index);
  }catch(e){state.mode='offline';state.error=(e as Error).message||'Cloud library unavailable. Cached parts remain available.';}});}
 private async cache(state:State,record:SnapshotDownload){await decodeSharedCad(record);await this.atomic(state,record.id+'.json',record);if(!state.index.cachedIds.includes(record.id))state.index.cachedIds.push(record.id);}
 async read(id:string){snapshotHash.parse(id);const state=await this.identity();if(!state.scope||!state.index.snapshots.some(s=>s.id===id))throw Error('Choose a part snapshot from this account’s local library.');try{const record=JSON.parse(await readFile(join(state.directory,id+'.json'),'utf8')) as SnapshotDownload;await decodeSharedCad(record);const metadata=state.index.snapshots.find(s=>s.id===id)!;if(record.id!==id||record.contentHash!==metadata.contentHash||record.payloadHash!==metadata.payloadHash)throw Error('Local CAD identity mismatch');return record;}catch{state.index.cachedIds=state.index.cachedIds.filter(value=>value!==id);}
  return this.serial(async()=>{if(!await this.current(state))throw Error('The library account changed. Open Team parts again.');const record=await this.sync.request<SnapshotDownload>('/v1/cad/snapshots/'+id);if(record.id!==id)throw Error('Cloud CAD identity mismatch');await this.cache(state,record);await this.atomic(state,'index.json',state.index);return record;});
 }
 async saveParts(parts:Part[],selection:LiveOnshapeSelection){return this.serial(async()=>{const state=await this.identity();if(!state.scope)return{state:'unavailable' as const,message:'CAD is local only. Sign in to enable automatic team sharing.'};
  const label=selection.library?.label??`Robot ${selection.documentId.slice(0,8)} · ${selection.versionId.slice(0,8)}`,workOrder=selection.library?.workOrder??`robot-${selection.documentId}`;
  try{const upload=await encodeSharedCad(parts,label,workOrder,true);const id=await digest(canonical([upload.contentHash,upload.payloadHash,upload.metadata]));if(state.index.pending.length>=SNAPSHOT_TEAM_LIMIT&&!state.index.pending.includes(id))throw Error('Twenty uploads are waiting. Reconnect or resolve cloud capacity before pulling more CAD.');const record:SnapshotDownload={...upload,id,compressedBytes:atob(upload.payload).length,actorId:'',actorLogin:'This device · upload pending',createdAt:new Date().toISOString()};await this.atomic(state,'pending-'+id+'.json',upload);await this.cache(state,record);if(!state.index.pending.includes(id))state.index.pending.push(id);if(!state.index.snapshots.some(s=>s.id===id)){const {payload,shareConfirmed,...metadata}=record as SnapshotDownload&{shareConfirmed?:boolean};state.index.snapshots.unshift(metadata);}await this.atomic(state,'index.json',state.index);return{state:'pending' as const,message:'CAD saved locally; automatic cloud upload queued.'};}catch(e){return{state:'unavailable' as const,message:`CAD received, but automatic sharing needs attention: ${(e as Error).message}`};}
 });}
}
export function registerCadLibraryRoutes(app:Express,library:CadLibrary){
 app.get('/api/library',async(_req,res,next)=>{try{res.json(await library.status());}catch(e){next(e);}});
 app.post('/api/library/refresh',async(_req,res,next)=>{try{void library.kick();res.status(202).json(await library.status());}catch(e){next(e);}});
 app.get('/api/library/snapshots',async(_req,res,next)=>{try{res.json(await library.status());}catch(e){next(e);}});
 app.get('/api/library/snapshots/:id',async(req,res,next)=>{try{res.json(await library.read(req.params.id));}catch(e){next(e);}});
}
