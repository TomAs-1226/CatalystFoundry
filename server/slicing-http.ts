import type { Express } from 'express';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import { strToU8, zipSync } from 'fflate';
import { BufferAttribute, BufferGeometry } from 'three';
import { parseSTL } from '../src/adapters/geometry';
import { manufacturingGeometry } from '../src/components/viewer-geometry';
import { deserializeProject } from '../src/domain/persistence';
import { fingerprint, layoutInstances, stableStringify, validateJob } from '../src/domain/invariants';
import type { Job, ProcessSettings, Project } from '../src/domain/model';
import { BambuStudioCliAdapter, SlicingService, UnavailableSlicerAdapter, type SliceRequest, type SlicerAdapter, type CommandRunner } from './slicer';
import { hashBytes, readPinnedProfile, resolvedConfig, validateConfiguredProfiles, type SlicingFileConfig } from './slicing-config';
import { bundledCatalog, bundledConfiguration, relocateBundledConfiguration, verifyRuntime } from './bundled-slicer';
import { canonicalWorkDirectory } from './work-directory';
import {bambuOptions,bambuOptionsVersion} from '../src/domain/bambu-settings';
export interface PreparedSlice { preparationId:string;manifestHash:string;profileBundleHash:string;preparedInputSha256:string;slicer:Job['slicer'];warnings:string[]; }
interface PreparationRecord extends PreparedSlice { request:SliceRequest; }
export interface SlicingContext {service:SlicingService;config?:SlicingFileConfig;configurationError?:string;workRoot:string;runner?:CommandRunner;bundledDirectory?:string;dataDirectory?:string;reconfiguring?:boolean;ready?:Promise<void>;initializing?:boolean;}
/** Trusted host configuration, never a browser-supplied executable/path. No printer connection exists. */
export async function createConfiguredSlicing(dataDirectory:string, options:{configPath?:string;config?:SlicingFileConfig;runner?:CommandRunner;bundledDirectory?:string;deferInitialization?:boolean}={}):Promise<SlicingContext> {
 const context:SlicingContext={service:undefined as unknown as SlicingService,workRoot:join(dataDirectory,'slicer-work'),runner:options.runner,bundledDirectory:options.bundledDirectory,dataDirectory,initializing:true};
 let config=options.config,configurationError:string|undefined,runtimeVerifiedHere=false;
 const ready=(async()=>{
 try {
  const configPath=options.configPath??process.env.CATALYST_SLICER_CONFIG;
  if(!config&&configPath){if(!isAbsolute(configPath))throw new Error('CATALYST_SLICER_CONFIG must be an absolute JSON file path.');config=JSON.parse(await readFile(configPath,'utf8')) as SlicingFileConfig;}
  if(!config&&!configPath&&options.bundledDirectory){let saved:SlicingFileConfig|undefined;try{saved=JSON.parse(await readFile(join(dataDirectory,'bundled-slicer.json'),'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}if(saved){config=await relocateBundledConfiguration(saved,options.bundledDirectory,dataDirectory);runtimeVerifiedHere=true;}}
  // Relocation has just verified every runtime file in this call. No persistent
  // validation cache: external configuration and every slice still verify anew.
  if(config?.runtime&&!runtimeVerifiedHere)await verifyRuntime(config.runtime.directory,config.runtime.sha256);
  if(config){config.bedType=config.printer?.plate;if(!isAbsolute(config.workRoot))throw new Error('Slicer workRoot must be an absolute dedicated directory.');config={...config,workRoot:await canonicalWorkDirectory(config.workRoot)};validateConfiguredProfiles(config,await readPinnedProfile(config.machine,'machine'),await readPinnedProfile(config.filament,'filament'));}
 }catch(error){configurationError=(error as Error).message;config=undefined;}
  context.config=config;context.configurationError=configurationError;context.workRoot=config?.workRoot??join(dataDirectory,'slicer-work');await mkdir(context.workRoot,{recursive:true});
 })().catch(error=>{context.config=undefined;context.configurationError=(error as Error).message;}).finally(()=>{context.initializing=false;});
 context.ready=ready;
 const adapter:SlicerAdapter={
  capability:async()=>{await ready;const selected=context.config;if(selected)return new BambuStudioCliAdapter(selected,options.runner).capability();return context.configurationError?{available:false,adapter:'Bambu Studio CLI',version:null,reason:context.configurationError,limitations:['Correct the local configuration, restart Foundry, then rerun an offline smoke slice.']}:new UnavailableSlicerAdapter().capability();},
  slice:async(request,sliceContext)=>{await ready;const selected=context.config;if(!selected)throw Error(context.configurationError??'Select and review a complete slicer profile first.');if(!request.processSettings)throw Error('A slicing request must include the exact process settings.');const resolved=await resolvedConfig(selected,request.processSettings,request.materialColor??selected.material.color);return new BambuStudioCliAdapter(resolved,options.runner).slice(request,sliceContext);},
 };
 context.service=await SlicingService.open({adapter,statePath:join(dataDirectory,'slicing-jobs.json')});
 if(!options.deferInitialization)await ready;
 return context;
}

export async function slicingProfile(context:SlicingContext,settings:ProcessSettings,materialColor=context.config?.material.color) {
 await context.ready;
 if(!context.config)throw new Error((await context.service.getCapability()).reason);
 const config=await resolvedConfig(context.config,settings,materialColor);const adapter=new BambuStudioCliAdapter(config,context.runner);
 const capability=await adapter.capability();if(!capability.available)throw new Error(capability.reason);
 return {printer:config.printer,material:config.material,slicer:{id:'bambu-studio-cli',version:config.version,profileBundleHash:adapter.profileBundleHash()},profileLabel:config.profileLabel};
}
function xml(value:string){return value.replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]!));}
/** Genuine standard 3MF geometry only. Exact placements/copies are baked; source meshes remain untouched. */
export async function prepare3mf(project:Project,job:Job):Promise<Uint8Array> {
 const instances=layoutInstances(project,job);let triangles=0;const objects:string[]=[];
 for(let index=0;index<instances.length;index++){
  const instance=instances[index];const part=project.parts.find(p=>p.id===instance.partId)!;
  const parsed=await parseSTL(part.geometry.stl,'mm',{expectedDimensions:part.geometry.dimensions});
  triangles+=parsed.vertices!.length/9;if(triangles>250_000)throw new Error('The prepared batch exceeds 250,000 total mesh triangles after copies. Split the job or explicitly export coarser CAD meshes.');
  const source=new BufferGeometry();source.setAttribute('position',new BufferAttribute(new Float64Array(parsed.vertices!),3));
  const mesh=manufacturingGeometry(source,instance.orientation);source.dispose();mesh.translate(...instance.position);
  const vertices=mesh.getAttribute('position');const vv:string[]=[],tt:string[]=[],indices:number[]=[],shared=new Map<string,number>();
  // 3MF connectivity is by vertex index. Three private vertices per STL facet
  // describe disconnected faces, which the native slicer can close differently.
  // Share only exactly equal coordinates: no tolerance, snapping or repair.
  for(let at=0;at<vertices.count;at++){
   const x=vertices.getX(at),y=vertices.getY(at),z=vertices.getZ(at),key=`${x}|${y}|${z}`;
   let id=shared.get(key);if(id===undefined){id=vv.length;shared.set(key,id);vv.push(`<vertex x="${x}" y="${y}" z="${z}"/>`);}indices.push(id);
  }
  for(let at=0;at<indices.length;at+=3)tt.push(`<triangle v1="${indices[at]}" v2="${indices[at+1]}" v3="${indices[at+2]}"/>`);
  objects.push(`<object id="${index+1}" type="model" name="${xml(part.name)} · copy ${instance.index+1}"><mesh><vertices>${vv.join('')}</vertices><triangles>${tt.join('')}</triangles></mesh></object>`);mesh.dispose();
 }
 const model=`<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Application">Catalyst Foundry geometry preparation</metadata><resources>${objects.join('')}</resources><build>${instances.map((_,i)=>`<item objectid="${i+1}"/>`).join('')}</build></model>`;
 return zipSync({'[Content_Types].xml':strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'),'_rels/.rels':strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'),'3D/3dmodel.model':strToU8(model)},{level:6});
}
export async function prepareSlicing(context:SlicingContext,project:Project,jobId:string):Promise<PreparedSlice> {
 const job=project.jobs.find(j=>j.id===jobId);if(!job)throw new Error('Select an existing manufacturing job.');
 await validateJob(project,job);const profile=await slicingProfile(context,job.settings,job.material.color);
 if(stableStringify(profile.printer)!==stableStringify(job.printer)||stableStringify(profile.material)!==stableStringify({...job.material,color:profile.material.color})||stableStringify(profile.slicer)!==stableStringify(job.slicer))throw new Error('The selected printer, material or exact resolved slicer profiles changed. Explicitly use the configured profiles before preparing this job.');
 const manifestHash=await fingerprint(project,job);const preparationId=randomUUID();const directory=join(context.workRoot,'preparations',preparationId);await mkdir(directory,{recursive:true});
 const bytes=await prepare3mf(project,job);if(bytes.length>50*1024*1024)throw new Error('Prepared geometry exceeds the 50 MiB slicing limit.');
 const preparedInputPath=join(directory,'prepared.3mf');await writeFile(preparedInputPath,bytes,{mode:0o600});
 const prepared:PreparedSlice={preparationId,manifestHash,profileBundleHash:profile.slicer.profileBundleHash,preparedInputSha256:hashBytes(bytes),slicer:profile.slicer,warnings:['Offline slicing does not validate physical machine conditions or part strength.','Configured profiles are untested for this team; resulting packages remain demonstrations until physical qualification is implemented.']};
 const record:PreparationRecord={...prepared,request:{manifestHash,profileBundleHash:prepared.profileBundleHash,preparedInputPath,preparedInputSha256:prepared.preparedInputSha256,preparedInMillimeters:true,outputDirectory:join(directory,'output'),processSettings:job.settings,materialColor:job.material.color}};
 await writeFile(join(directory,'preparation.json'),JSON.stringify(record),{mode:0o600});return prepared;
}
export function registerSlicingRoutes(app:Express,context:SlicingContext) {
 app.use('/api/slicing',async(_req,_res,next)=>{try{await context.ready;next();}catch(error){next(error);}});
 app.get('/api/slicing/bundled',async(_req,res,next)=>{try{const profiles=context.bundledDirectory?await bundledCatalog(context.bundledDirectory):[];const selected=profiles.find(profile=>isDeepStrictEqual(profile.printer,context.config?.printer)&&isDeepStrictEqual(profile.material,context.config?.material)&&profile.files.machine.sha256===context.config?.machine.sha256&&profile.files.filament.sha256===context.config?.filament.sha256);res.json({installed:!!context.bundledDirectory,version:context.bundledDirectory?'2.8.2.61':null,selectedProfileId:selected?.id??'',profiles});}catch(e){next(e)}});
 app.post('/api/slicing/bundled/select',async(req,res,next)=>{
  if(context.reconfiguring){res.status(409).json({error:'Profile selection is already in progress.'});return;}
  context.reconfiguring=true;
  try {
   if(!context.bundledDirectory||!context.dataDirectory)throw new Error('This build does not contain a bundled native slicer.');
   if(context.service.listJobs().some(job=>['queued','running'].includes(job.status)))throw new Error('Finish or cancel active slicing before changing profiles.');
   const config=await bundledConfiguration(context.bundledDirectory,context.dataDirectory,req.body?.id,req.body?.reviewed);
   const capability=await new BambuStudioCliAdapter(config,context.runner).capability();
   if(!capability.available)throw new Error(capability.reason);
   await context.service.shutdown();
   const updated=await createConfiguredSlicing(context.dataDirectory,{config,bundledDirectory:context.bundledDirectory,runner:context.runner});
   await writeFile(join(context.dataDirectory,'bundled-slicer.json'),JSON.stringify(config,null,2),{mode:0o600});
   Object.assign(context,updated);
   res.json({selected:true,profileLabel:config.profileLabel,capability});
  }catch(e){next(e)}finally{context.reconfiguring=false;}
 });
 app.get('/api/slicing/setup',async(_req,res,next)=>{try{res.json({capability:await context.service.getCapability(),configured:!!context.config,profileLabel:context.config?.profileLabel,configurationVariable:'CATALYST_SLICER_CONFIG',instructions:context.bundledDirectory?['Bambu Studio is included in this installation. Open Included engine, select the exact printer/material and review its mapping.','Use configured printer & profiles on the current job, then slice locally. No separate Bambu Studio install or Onshape request is needed.']:['Install the pinned Bambu Studio release locally; no Bambu account is needed for offline slicing.','Provide complete resolved machine, filament and process JSON profiles with hashes and explicit printer/nozzle/plate/material metadata.','Set CATALYST_SLICER_CONFIG to the absolute configuration file path and restart Foundry.','Exact setup and qualification instructions are in docs/SLICING.md. Bambu Connect handles native review and final printing in the Windows app.']});}catch(e){next(e)}});
 app.post('/api/slicing/profile',async(req,res,next)=>{try{res.json(await slicingProfile(context,req.body?.settings,req.body?.materialColor));}catch(e){next(e)}});
 app.get('/api/slicing/process-options',async(_req,res,next)=>{try{if(!context.config)throw Error('Choose a bundled printer/material profile first.');const base=await readPinnedProfile(context.config.process,'process');res.json({version:bambuOptionsVersion,base:Object.fromEntries(bambuOptions.filter(f=>base[f.key]!==undefined).map(f=>[f.key,base[f.key]]))});}catch(e){next(e)}});
 app.post('/api/slicing/prepare',async(req,res,next)=>{try{const project=await deserializeProject(JSON.stringify(req.body.project));res.json(await prepareSlicing(context,project,String(req.body.jobId)));}catch(e){next(e)}});
 app.get('/api/slicing/jobs',(req,res)=>{const hash=req.query.manifestHash;if(hash!==undefined&&(typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash))){res.status(400).json({error:'Use a valid manifest fingerprint.'});return;}res.json({jobs:req.query.summary==='true'?context.service.listJobSummaries(hash):context.service.listJobs().filter(job=>!hash||job.manifestHash===hash)});});
 app.get('/api/slicing/jobs/:id',(req,res)=>{const job=context.service.getJob(req.params.id);if(!job){res.status(404).json({error:'Slicing job not found.'});return;}res.json(job);});
 app.post('/api/slicing/jobs',async(req,res,next)=>{try{
  const capability=await context.service.getCapability();if(!capability.available){res.status(503).json({error:capability.reason});return;}
  const {preparationId,manifestHash,idempotencyKey}=(req.body??{}) as Record<string,string>;
  if(!/^[a-f0-9-]{36}$/.test(preparationId??''))throw new Error('Select a valid prepared geometry record; local paths and URLs are not accepted.');
  let record:PreparationRecord;try{record=JSON.parse(await readFile(join(context.workRoot,'preparations',preparationId,'preparation.json'),'utf8'));}catch{res.status(404).json({error:'Prepared geometry is unavailable. Prepare the exact job again.'});return;}
  if(record.preparationId!==preparationId||record.manifestHash!==manifestHash)throw new Error('The requested manifest changed after geometry preparation. Prepare and slice the current job.');
  res.status(202).json(await context.service.createJob(record.request,idempotencyKey));
 }catch(e){next(e)}});
 app.post('/api/slicing/jobs/:id/cancel',async(req,res,next)=>{try{res.json(await context.service.cancelJob(req.params.id));}catch(e){next(e)}});
}
