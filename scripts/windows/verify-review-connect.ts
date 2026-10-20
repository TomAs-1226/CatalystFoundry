/** Real offline CLI acceptance on public fixtures only. Never contacts a printer. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {unzipSync,strFromU8} from 'fflate';
import {createProject,type Part} from '../../src/domain/model';
import {parseSTL} from '../../src/adapters/geometry';
import {parseGcode} from '../../src/adapters/toolpaths';
import {preparePlateModel} from '../../src/domain/prepare-plate';
import {attachToolpath,reviewToolpath,approveJob,isToolpathCurrent,isApprovalCurrent} from '../../src/domain/invariants';
import {serializeProject,deserializeProject} from '../../src/domain/persistence';
import {bundledCatalog,bundledConfiguration} from '../../server/bundled-slicer';
import {createConfiguredSlicing,prepareSlicing,slicingProfile} from '../../server/slicing-http';
import {GEOMETRY_PREPARATION_VERSION} from '../../src/domain/preparation-version';
import {SliceSession,type SliceSessionState} from '../../src/components/slice-session';
const runtime=resolve(process.env.FOUNDRY_QA_RUNTIME??'vendor/bambu'),out=resolve(process.argv[2]??'../../evidence/review-connect-native');await mkdir(out,{recursive:true});const reports=[];
for(const model of ['Bambu Lab X1','Bambu Lab X2D'])for(const kind of ['holes','normal','tree'] as const){
 const profile=(await bundledCatalog(runtime)).find(p=>p.printer.model===model&&p.material.type==='PLA')!;if(!profile)throw Error('Missing reviewed mapping');
 const directory=join(out,profile.id+'-'+kind);await mkdir(directory,{recursive:true});const config=await bundledConfiguration(runtime,directory,profile.id,true);
 // Keep native filenames below Win32 MAX_PATH; evidence remains separate.
 config.workRoot=resolve(process.env.FOUNDRY_QA_WORK??'../../native-qa','rv-'+(model.endsWith('X2D')?'x2d':'x1')+'-'+kind);
 const context=await createConfiguredSlicing(directory,{config,bundledDirectory:runtime});
 try{
  const fixture=kind==='holes'?'two-hole-plate':'support-test',color=kind==='holes'?'#287AB5':'#A16B43';
  const part:Part={id:'public-'+fixture,name:'NON-MANUFACTURABLE '+fixture,geometry:await parseSTL(await readFile('public/fixtures/'+fixture+'.stl'),'mm'),source:{kind:'fixture',documentId:'software-fixture',versionId:'mesh-v2',elementId:fixture,configuration:'default'},classification:'make',quantity:1,spareQuantity:kind==='holes'?0:1,category:'custom'};
  const project=createProject('NON-MANUFACTURABLE geometry/filament acceptance'),job=project.jobs[0];project.parts=[part];job.items=[{partId:part.id,quantity:1,spareQuantity:part.spareQuantity,position:[128,128,0],orientation:[0,0,0]}];job.settings.supports=kind!=='holes';job.settings.supportStyle=kind==='tree'?'tree':'normal';if(kind==='holes')job.settings.brimWidth=0;
  job.settings={...job.settings,walls:5,'bambu.top_shell_layers':5,'bambu.bottom_shell_layers':5,'bambu.brim_type':'outer_only','bambu.outer_wall_speed':65,'bambu.top_surface_speed':45,'bambu.support_interface_top_layers':3,'bambu.support_top_z_distance':.25};
  Object.assign(job,await slicingProfile(context,job.settings,color));const plate=await preparePlateModel(project,job,true,false);job.items=plate.items;job.settings=plate.settings;Object.assign(job,await slicingProfile(context,job.settings,color));
  const prepared=await prepareSlicing(context,project,job.id),record=JSON.parse(await readFile(join(context.workRoot,'preparations',prepared.preparationId,'preparation.json'),'utf8'));
  const queued=await context.service.createJob(record.request,crypto.randomUUID());let done=context.service.getJob(queued.id)!;const deadline=Date.now()+240_000;
  let state:SliceSessionState={phase:'idle',message:''},previews=0;
  const owner=new SliceSession({current:()=>({project,job}),busy:()=>false,read:async id=>context.service.getJob(id)!,list:async hash=>context.service.listJobSummaries(hash),attach:async result=>{await attachToolpath(project,job,result.result!.gcode,{name:'NON-MANUFACTURABLE native test.gcode',source:'bambu',preparationVersion:result.result!.preparationVersion,nozzleOffset:result.result!.nozzleOffset,mappingConfirmed:true,slicerProject:result.result!.slicerProject});return true;},preview:()=>{previews++;},changed:next=>{state=next;}});
  await owner.accept(queued);
  // There is deliberately no mounted workspace/SlicingPanel. The root owner must finish.
  try{
  while(['queued','running'].includes(done.status)&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,300));done=context.service.getJob(done.id)!;}
  if(done.status!=='succeeded'||!done.result)throw Error((done.error??'Native slice did not complete')+'\n'+done.logs.slice(-20).join('\n'));
  if(done.result.preparationVersion!==GEOMETRY_PREPARATION_VERSION)throw Error('Old geometry preparation result');
  const archive=unzipSync(Buffer.from(done.result.slicerProject!.data,'base64')),metadata=JSON.parse(strFromU8(archive['Metadata/plate_1.json']));
  if(metadata.filament_colors?.[0]?.toUpperCase()!==color)throw Error('Native file did not preserve the selected filament color');
  const parsed=parseGcode(done.result.gcode,{nativeBambu:true}),supportFeatures=[...new Set([...done.result.gcode.matchAll(/;\s*(?:TYPE|FEATURE):\s*([^\r\n]+)/gi)].map(m=>m[1]).filter(f=>/support/i.test(f)))];
  if(!parsed.canApprove||done.result.previewSupported!==true)throw Error('Native layer preview blocked: '+parsed.blockingIssues.join('; '));
  const nativeSettings=JSON.parse(strFromU8(archive['Metadata/project_settings.config']));
  for(const [key,value] of Object.entries({wall_loops:'5',top_shell_layers:'5',bottom_shell_layers:'5',brim_type:'outer_only',sparse_infill_pattern:job.settings.infillResolvedPattern}))if(String(nativeSettings[key])!==value)throw Error('Native process setting mismatch: '+key);
  const holes=[];
  if(kind==='holes'){
   const offset=done.result.nozzleOffset??[0,0];
   for(const dx of [-25,25]){const center=[job.items[0].position[0]+dx-offset[0],job.items[0].position[1]-offset[1]];let minimum=Infinity,crossings=0;
    for(const s of parsed.segments){if(s.printMove===false||!['wall','infill'].includes(s.feature)||Math.min(s.from[2],s.to[2])<.5)continue;const x=s.to[0]-s.from[0],y=s.to[1]-s.from[1],length=x*x+y*y,t=length?Math.max(0,Math.min(1,((center[0]-s.from[0])*x+(center[1]-s.from[1])*y)/length)):0;const distance=Math.hypot(s.from[0]+t*x-center[0],s.from[1]+t*y-center[1])-(s.width??.42)/2;minimum=Math.min(minimum,distance);if(distance<2)crossings++;}
    if(crossings||minimum<2)throw Error('Native output fills a public fixture bore');holes.push({minimumExtrusionEdgeDistanceMm:minimum,extrusionCrossingsOfInner4mm:crossings});
   }
  }else if(!supportFeatures.length)throw Error('Expected native support features');
  const attachDeadline=Date.now()+20_000;while(!['ready','blocked','error'].includes(state.phase)&&Date.now()<attachDeadline)await new Promise(resolve=>setTimeout(resolve,100));
  if(state.phase!=='ready'||previews!==1||!await isToolpathCurrent(project,job))throw Error('App-owned native attachment failed: '+state.message);
  await reviewToolpath(project,job,'Software fixture reviewer');await approveJob(project,job,'Software fixture reviewer');
  if(job.approval?.demonstrationOnly!==true)throw Error('Fixture incorrectly became manufacturable');const reopened=await deserializeProject(serializeProject(project));if(!await isToolpathCurrent(reopened,reopened.jobs[0])||!await isApprovalCurrent(reopened,reopened.jobs[0]))throw Error('Exact native review did not survive reopen');
  const changed=structuredClone(project);changed.jobs[0].settings['bambu.top_shell_layers']=6;if(await isApprovalCurrent(changed,changed.jobs[0]))throw Error('Advanced setting failed to invalidate approval');
  const report={model,kind,status:done.status,slicerVersion:done.result.slicerVersion,preparationVersion:done.result.preparationVersion,geometryHash:part.geometry.hash,profileBundleHash:prepared.profileBundleHash,manifestHash:prepared.manifestHash,toolpathHash:done.result.toolpathHash,nativeProjectHash:done.result.projectHash,filamentColor:color,nativeFilamentColor:metadata.filament_colors[0],nozzleOffset:done.result.nozzleOffset,holes,supportFeatures,requiredCopies:1,backupCopies:part.spareQuantity,onshapeRequests:0,printerContacted:false,physicalQualification:false,previewSupported:parsed.canApprove,nativeMachineReviewRequired:parsed.nativeMachineReviewRequired,approvalDemonstrationOnly:job.approval.demonstrationOnly,saveReopenCurrent:true,advancedEditInvalidates:true,settings:job.settings,nativeSettings:Object.fromEntries(['wall_loops','top_shell_layers','bottom_shell_layers','brim_type','sparse_infill_pattern','outer_wall_speed','top_surface_speed','support_interface_top_layers','support_top_z_distance'].map(key=>[key,nativeSettings[key]]))};
  Object.assign(report,{rootSessionAttached:true,workspacePanelMounted:false,previewAfterCommit:true});
  await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2)+'\n');await writeFile(join(directory,'NON-MANUFACTURABLE.3mf'),Buffer.from(done.result.slicerProject!.data,'base64'));await writeFile(join(directory,'NON-MANUFACTURABLE.project.json'),serializeProject(project));reports.push(report);console.log(JSON.stringify({model,kind,status:done.status,rootSessionAttached:true,workspacePanelMounted:false,previewSupported:parsed.canApprove,approvalDemonstrationOnly:job.approval.demonstrationOnly}));
  }finally{owner.dispose();}
 }finally{await context.service.shutdown();}
}
await writeFile(join(out,'summary.json'),JSON.stringify({passed:true,platform:process.platform,architecture:process.arch,scope:'Six fresh native offline public-fixture slices: X1/X2D holes and normal/tree required-plus-backup, advanced settings, root-owned polling/attachment with no workspace panel, exact fixture review/approval, save/reopen and invalidation. This is a headless controller test, not actual UI navigation. No operator qualification, Onshape or printer contact.',reports},null,2)+'\n');
