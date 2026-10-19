/** Real offline CLI acceptance on public fixtures only. Never contacts a printer. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {unzipSync,strFromU8} from 'fflate';
import {createProject,type Part} from '../../src/domain/model';
import {parseSTL} from '../../src/adapters/geometry';
import {parseGcode} from '../../src/adapters/toolpaths';
import {arrangePlate} from '../../src/domain/auto-prepare';
import {bundledCatalog,bundledConfiguration} from '../../server/bundled-slicer';
import {createConfiguredSlicing,prepareSlicing,slicingProfile} from '../../server/slicing-http';
import {GEOMETRY_PREPARATION_VERSION} from '../../src/domain/preparation-version';
const runtime=resolve('vendor/bambu'),out=resolve(process.argv[2]??'../../evidence/geometry-filament-native');await mkdir(out,{recursive:true});const reports=[];
for(const model of ['Bambu Lab X1','Bambu Lab X2D'])for(const kind of ['holes','normal','tree'] as const){
 const profile=(await bundledCatalog(runtime)).find(p=>p.printer.model===model&&p.material.type==='PLA')!;if(!profile)throw Error('Missing reviewed mapping');
 const directory=join(out,profile.id+'-'+kind);await mkdir(directory,{recursive:true});const config=await bundledConfiguration(runtime,directory,profile.id,true);
 // Keep native filenames below Win32 MAX_PATH; evidence remains separate.
 config.workRoot=resolve('../../native-qa/'+(model.endsWith('X2D')?'x2d':'x1')+'-'+kind);
 const context=await createConfiguredSlicing(directory,{config,bundledDirectory:runtime});
 try{
  const fixture=kind==='holes'?'two-hole-plate':'support-test',color=kind==='holes'?'#287AB5':'#A16B43';
  const part:Part={id:'public-'+fixture,name:'NON-MANUFACTURABLE '+fixture,geometry:await parseSTL(await readFile('public/fixtures/'+fixture+'.stl'),'mm'),source:{kind:'fixture',documentId:'software-fixture',versionId:'mesh-v2',elementId:fixture,configuration:'default'},classification:'make',quantity:1,spareQuantity:kind==='holes'?0:1,category:'custom'};
  const project=createProject('NON-MANUFACTURABLE geometry/filament acceptance'),job=project.jobs[0];project.parts=[part];job.items=[{partId:part.id,quantity:1,spareQuantity:part.spareQuantity,position:[128,128,0],orientation:[0,0,0]}];job.settings.supports=kind!=='holes';job.settings.supportStyle=kind==='tree'?'tree':'normal';if(kind==='holes')job.settings.brimWidth=0;
  Object.assign(job,await slicingProfile(context,job.settings,color));job.items=arrangePlate(project,job);
  const prepared=await prepareSlicing(context,project,job.id),record=JSON.parse(await readFile(join(context.workRoot,'preparations',prepared.preparationId,'preparation.json'),'utf8'));
  const queued=await context.service.createJob(record.request,crypto.randomUUID());let done=context.service.getJob(queued.id)!;const deadline=Date.now()+240_000;
  while(['queued','running'].includes(done.status)&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,300));done=context.service.getJob(done.id)!;}
  if(done.status!=='succeeded'||!done.result)throw Error(done.error??'Native slice did not complete');
  if(done.result.preparationVersion!==GEOMETRY_PREPARATION_VERSION)throw Error('Old geometry preparation result');
  const archive=unzipSync(Buffer.from(done.result.slicerProject!.data,'base64')),metadata=JSON.parse(strFromU8(archive['Metadata/plate_1.json']));
  if(metadata.filament_colors?.[0]?.toUpperCase()!==color)throw Error('Native file did not preserve the selected filament color');
  const parsed=parseGcode(done.result.gcode),supportFeatures=[...new Set([...done.result.gcode.matchAll(/;\s*(?:TYPE|FEATURE):\s*([^\r\n]+)/gi)].map(m=>m[1]).filter(f=>/support/i.test(f)))];
  const holes=[];
  if(kind==='holes'){
   const offset=done.result.nozzleOffset??[0,0];
   for(const dx of [-25,25]){const center=[job.items[0].position[0]+dx-offset[0],job.items[0].position[1]-offset[1]];let minimum=Infinity,crossings=0;
    for(const s of parsed.segments){if(s.printMove===false||!['wall','infill'].includes(s.feature)||Math.min(s.from[2],s.to[2])<.5)continue;const x=s.to[0]-s.from[0],y=s.to[1]-s.from[1],length=x*x+y*y,t=length?Math.max(0,Math.min(1,((center[0]-s.from[0])*x+(center[1]-s.from[1])*y)/length)):0;const distance=Math.hypot(s.from[0]+t*x-center[0],s.from[1]+t*y-center[1])-(s.width??.42)/2;minimum=Math.min(minimum,distance);if(distance<2)crossings++;}
    if(crossings||minimum<2)throw Error('Native output fills a public fixture bore');holes.push({minimumExtrusionEdgeDistanceMm:minimum,extrusionCrossingsOfInner4mm:crossings});
   }
  }else if(!supportFeatures.length)throw Error('Expected native support features');
  const report={model,kind,status:done.status,slicerVersion:done.result.slicerVersion,preparationVersion:done.result.preparationVersion,geometryHash:part.geometry.hash,profileBundleHash:prepared.profileBundleHash,manifestHash:prepared.manifestHash,toolpathHash:done.result.toolpathHash,nativeProjectHash:done.result.projectHash,filamentColor:color,nativeFilamentColor:metadata.filament_colors[0],nozzleOffset:done.result.nozzleOffset,holes,supportFeatures,requiredCopies:1,backupCopies:part.spareQuantity,onshapeRequests:0,printerContacted:false,physicalQualification:false};
  await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2)+'\n');await writeFile(join(directory,'NON-MANUFACTURABLE.3mf'),Buffer.from(done.result.slicerProject!.data,'base64'));reports.push(report);console.log(JSON.stringify({model,kind,status:done.status,holes,nativeFilamentColor:metadata.filament_colors[0]}));
 }finally{await context.service.shutdown();}
}
await writeFile(join(out,'summary.json'),JSON.stringify({passed:true,scope:'Six actual native Windows offline slices on public fixtures: holes and normal/tree required-plus-backup, both X1/X2D. No Onshape or printer contact.',reports},null,2)+'\n');
