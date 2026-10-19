/** Native software fixture acceptance. No Onshape, user project or printer access. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createProject,type Part} from '../../src/domain/model';
import {parseSTL} from '../../src/adapters/geometry';
import {arrangePlate} from '../../src/domain/auto-prepare';
import {bundledCatalog,bundledConfiguration} from '../../server/bundled-slicer';
import {createConfiguredSlicing,prepareSlicing,slicingProfile} from '../../server/slicing-http';
const runtime=resolve('vendor/bambu'),out=resolve(process.argv[2]??'../../evidence/preparation-native');await mkdir(out,{recursive:true});
const reports=[];
for(const model of ['Bambu Lab X1','Bambu Lab X2D'])for(const supportStyle of ['normal','tree'] as const){
 const profile=(await bundledCatalog(runtime)).find(profile=>profile.printer.model===model&&profile.material.type==='PLA')!;
 if(!profile)throw Error('Missing profile '+model);const directory=join(out,profile.id+'-'+supportStyle);await mkdir(directory,{recursive:true});
 const config=await bundledConfiguration(runtime,directory,profile.id,true);
 // Exercise the very same virtualized Roaming root that rejected real installed jobs.
 config.workRoot=join(process.env.APPDATA!,'Catalyst Foundry/data/slicer-work');
 const context=await createConfiguredSlicing(directory,{config,bundledDirectory:runtime});
 try{
  const part:Part={id:'support-fixture',name:'NON-MANUFACTURABLE support test',geometry:await parseSTL(await readFile('public/fixtures/support-test.stl','utf8'),'mm'),source:{kind:'fixture',documentId:'software-fixture',versionId:'support-v1',elementId:'t-roof',configuration:'default'},classification:'make',quantity:1,spareQuantity:0,category:'custom'};
  const p=createProject('NON-MANUFACTURABLE support acceptance'),j=p.jobs[0];p.parts=[part];j.items=[{partId:part.id,quantity:1,spareQuantity:0,orientation:[0,0,0],position:[999,999,99]}];j.settings.supports=true;j.settings.supportStyle=supportStyle;
  Object.assign(j,await slicingProfile(context,j.settings));j.items=arrangePlate(p,j);
  const prepared=await prepareSlicing(context,p,j.id),record=JSON.parse(await readFile(join(context.workRoot,'preparations',prepared.preparationId,'preparation.json'),'utf8'));
  const queued=await context.service.createJob(record.request,crypto.randomUUID());const deadline=Date.now()+240000;let done=context.service.getJob(queued.id)!;
  while(['queued','running'].includes(done.status)&&Date.now()<deadline){await new Promise(r=>setTimeout(r,300));done=context.service.getJob(done.id)!;}
  if(done.status!=='succeeded'||!done.result){await writeFile(join(directory,'failure.json'),JSON.stringify(done,null,2));throw Error(done.error??'Native slice did not complete');}
  const features=[...new Set([...done.result.gcode.matchAll(/;\s*(?:TYPE|FEATURE):\s*([^\r\n]+)/gi)].map(match=>match[1]))];
  const supportFeatures=features.filter(feature=>/support/i.test(feature));
  const report={model,material:profile.material.type,supportStyle,status:done.status,slicerVersion:done.result.slicerVersion,profileBundleHash:prepared.profileBundleHash,manifestHash:prepared.manifestHash,geometryHash:part.geometry.hash,toolpathHash:done.result.toolpathHash,nativeProjectHash:done.result.projectHash,canonicalWorkRoot:context.workRoot,requestedWorkRoot:config.workRoot,supportFeatures,previewSupported:done.result.previewSupported,printerContacted:false,physicalQualification:false};
  await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2)+'\n');await writeFile(join(directory,'NON-MANUFACTURABLE.3mf'),Buffer.from(done.result.slicerProject!.data,'base64'));reports.push(report);
  console.log(JSON.stringify({model,supportStyle,status:done.status,supportFeatures}));
  if(!supportFeatures.length)throw Error('Native result contains no support features; support generation not demonstrated');
 }finally{await context.service.shutdown();}
}
await writeFile(join(out,'summary.json'),JSON.stringify({passed:true,scope:'Actual pinned Windows CLI on public T-roof fixture, both X1/X2D and normal/tree. No machine contact; physical qualification unknown.',reports},null,2)+'\n');
