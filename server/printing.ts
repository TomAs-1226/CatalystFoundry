import type { RemoteSync } from "./sync";
import {GEOMETRY_PREPARATION_VERSION} from '../src/domain/preparation-version';
import type { Express } from 'express';
import { mkdir, readFile, writeFile, rename,readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { strFromU8, unzipSync } from 'fflate';
import { z } from 'zod';
import type { Project } from '../src/domain/model';
import { deserializeProject } from '../src/domain/persistence';
import { fingerprint, manufacturingManifest, stableStringify, validateJob } from '../src/domain/invariants';
import { hashBytes } from './slicing-config';
import { slicingProfile, type SlicingContext } from './slicing-http';
export interface ConnectHost {
 capability():Promise<{available:boolean;reason:string}>;
 open(file:string,name:string):Promise<void>;
 install?():Promise<void>;
 launch?():Promise<void>;
 status?():{phase:string;message:string;bytes?:number;total?:number;guide?:string;installerVersion?:string;source?:string};
}
export interface PrintHandoff {
 id:string;jobId:string;sliceId:string;manifestHash:string;artifactHash:string;toolpathHash:string;
 model:string;mode:'lan'|'connect';createdAt:string;status:'opening'|'opened-for-review'|'failed';
 printerStatus:'unknown';error?:string;reservationId?:string;reservationRevision?:number;syncStatus?:'recorded'|'pending';
}
const input=z.object({jobId:z.string().min(1).max(200),sliceId:z.string().min(1).max(200),manifestHash:z.string().regex(/^[a-f0-9]{64}$/),mode:z.enum(['lan','connect']),reviewInConnect:z.literal(true)}).strict();
export class PrintingService {
 private queue:Promise<unknown>=Promise.resolve();
 constructor(private directory:string,private slicing:SlicingContext,private host?:ConnectHost,private sync?:RemoteSync){}
 async recoverReports(){
  if(!this.sync?.configured())return;const root=join(this.directory,'print-handoffs');let names:string[];try{names=await readdir(root);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw e;}
  for(const name of names.filter(n=>/^[a-f0-9]{64}$/.test(n))){try{const receipt=JSON.parse(await readFile(join(root,name,'receipt.json'),'utf8')) as PrintHandoff;if(receipt.id!==name||receipt.status!=='opened-for-review'||receipt.syncStatus!=='pending'||!receipt.reservationId||!receipt.reservationRevision)continue;await this.sync.handedOff(receipt.reservationId,receipt.reservationRevision,receipt.id);}catch{/* Keep the receipt for a later retry; never reopen Connect here. */}}
 }
 capability(){return this.host?.capability()??Promise.resolve({available:false,reason:'Bambu Connect handoff is available in the Windows desktop app after installing Bambu Connect.'});}
 async setup(){return{...await this.capability(),canInstall:!!this.host?.install,canOpen:!!this.host?.launch,installation:this.host?.status?.(),loginStatus:'unknown' as const};}
 async install(){if(!this.host?.install)throw Error('Official Connect setup requires the Windows desktop app.');await this.host.install();return this.setup();}
 async openConnect(){if(!this.host?.launch)throw Error('Connect login/pairing opens from the Windows desktop app.');await this.host.launch();return this.setup();}
 async handoff(project:Project,request:unknown):Promise<PrintHandoff>{
  const snapshot=structuredClone(project),value=input.parse(request);
  const task=this.queue.then(()=>this.perform(snapshot,value));this.queue=task.catch(()=>{});return task;
 }
 private async perform(project:Project,value:z.infer<typeof input>):Promise<PrintHandoff>{
  const job=project.jobs.find(j=>j.id===value.jobId);if(!job)throw new Error('Select an existing print job.');
  await validateJob(project,job);
  if(!/^Bambu Lab (X1|X1 Carbon|X1E|X2D)$/.test(job.printer.model))throw new Error('This handoff currently supports reviewed X1-family and X2D profiles only.');
  if(job.items.some(i=>project.parts.find(p=>p.id===i.partId)?.source.kind==='fixture'))throw new Error('Fixture geometry is non-manufacturable and cannot be handed to a printer.');
  const manifestHash=await fingerprint(project,job);if(manifestHash!==value.manifestHash)throw new Error('Manufacturing inputs changed. Slice the current job again.');
  const slice=this.slicing.service.getJob(value.sliceId);
  if(slice?.status!=='succeeded'||slice.manifestHash!==manifestHash||!slice.result?.slicerProject||slice.result.demonstration!==false)throw new Error('A matching successful local slice with a native 3MF is required.');
  const result=slice.result,artifact=result.slicerProject!;
  if(result.preparationVersion!==GEOMETRY_PREPARATION_VERSION)throw new Error('Reslice this plate with the corrected mesh preparation before sending it.');
  if(/CATALYST_DEMONSTRATION_TOOLPATH/i.test(result.gcode))throw new Error('Demonstration toolpaths cannot be handed to a printer.');
  if(job.toolpath?.hash===result.toolpathHash&&(!job.toolpath.mappingConfirmed||job.toolpath.stale))throw new Error('This toolpath mapping was revoked or invalidated. Review a new slice.');
  const profile=await slicingProfile(this.slicing,job.settings,job.material.color);
  if(stableStringify(profile.printer)!==stableStringify(job.printer)||stableStringify(profile.material)!==stableStringify(job.material)||stableStringify(profile.slicer)!==stableStringify(job.slicer)||result.slicerVersion!==job.slicer.version)throw new Error('The reviewed printer, material or slicer profile changed.');
  if(artifact.data.length>70*1024*1024)throw new Error('Native sliced file exceeds the handoff limit.');
  const bytes=Buffer.from(artifact.data,'base64');
  if(hashBytes(bytes)!==artifact.hash||result.projectHash!==artifact.hash||hashBytes(result.gcode)!==result.toolpathHash)throw new Error('Native toolpath integrity check failed.');
  let plateCount=0,oversizedPlate=false;
  const plates=unzipSync(bytes,{filter:file=>{if(!/(?:^|\/)plate_\d+\.gcode$/i.test(file.name))return false;plateCount++;if(file.originalSize>10*1024*1024){oversizedPlate=true;return false;}return true;}});
  const entries=Object.values(plates);if(plateCount!==1||oversizedPlate||entries.length!==1||strFromU8(entries[0])!==result.gcode)throw new Error('Native file must contain exactly the matching single G-code plate.');
  const id=hashBytes(stableStringify({jobId:job.id,manifestHash,artifactHash:artifact.hash,workOrder:this.sync?.configured()?project.manufacturingOrder:undefined}));
  const directory=join(this.directory,'print-handoffs',id),receiptPath=join(directory,'receipt.json');
  await mkdir(directory,{recursive:true});
  // Durable receipt precedes external side effects. Duplicate clicks/restarts never reopen implicitly.
  try{return JSON.parse(await readFile(receiptPath,'utf8')) as PrintHandoff;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  const capability=await this.capability();if(!capability.available||!this.host)throw new Error(capability.reason);
  const file=join(directory,'job.gcode.3mf');try{await writeFile(file,bytes,{flag:'wx',mode:0o600});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST'||hashBytes(await readFile(file))!==artifact.hash)throw e;}
  await writeFile(join(directory,'manifest.json'),JSON.stringify({manifest:manufacturingManifest(project,job),artifactHash:artifact.hash,toolpathHash:result.toolpathHash,nativeReviewRequired:true,physicalChecksRequired:true},null,2),{mode:0o600});
  const reservation=this.sync?.configured()?await this.sync.reserve(project,job,artifact.hash):undefined;
  if(reservation&&!['reserved','handed-off'].includes(reservation.status))throw new Error('These copies were already reported as making or produced. Review the shared record.');
  const receipt:PrintHandoff={id,jobId:job.id,sliceId:slice.id,manifestHash,artifactHash:artifact.hash,toolpathHash:result.toolpathHash,model:job.printer.model,mode:value.mode,createdAt:new Date().toISOString(),status:'opening',printerStatus:'unknown',...(reservation?{reservationId:reservation.id,reservationRevision:reservation.revision,syncStatus:'pending' as const}:{})};
  const save=async()=>{const temp=join(directory,`${randomUUID()}.tmp`);await writeFile(temp,JSON.stringify(receipt,null,2),{mode:0o600});await rename(temp,receiptPath);};
  await save();
  try{await this.host.open(file,`${job.name.slice(0,190)} · ${job.printer.model}`);receipt.status='opened-for-review';}
  catch(e){receipt.status='failed';receipt.error=(e as Error).message;}
  await save(); // An observed successful open survives a crash before outbox persistence.
  if(receipt.status==='opened-for-review'&&reservation){try{await this.sync!.handedOff(reservation.id,reservation.revision,id);receipt.syncStatus='pending';}catch{receipt.syncStatus='pending';}}
  await save();return receipt;
 }
}
export function registerPrintingRoutes(app:Express,service:PrintingService){
 app.get('/api/printing/setup',async(_req,res,next)=>{try{res.json({...await service.setup(),models:['X1','X1 Carbon','X1E','X2D'],modes:['lan','connect'],printerStatus:'unknown',reasonDetail:'Bambu Connect handles LAN-only or cloud login, printer selection, native preview and final Print. Foundry cannot observe acceptance or start.'});}catch(e){next(e);}});
 app.post('/api/printing/connect/install',async(req,res,next)=>{try{z.object({confirmInstall:z.literal(true)}).strict().parse(req.body);res.json(await service.install());}catch(e){next(e);}});
 app.post('/api/printing/connect/open',async(req,res,next)=>{try{z.object({}).strict().parse(req.body);res.json(await service.openConnect());}catch(e){next(e);}});
 app.post('/api/printing/handoff',async(req,res,next)=>{try{const project=await deserializeProject(JSON.stringify(req.body.project));const {project:_,...request}=req.body;res.json(await service.handoff(project,request));}catch(e){next(e);}});
}
