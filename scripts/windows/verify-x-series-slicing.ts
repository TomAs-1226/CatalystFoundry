/** Noninteractive native software validation only. No Connect or printer call. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { createProject,createJob,type Part } from '../../src/domain/model';
import { parseSTL } from '../../src/adapters/geometry';
import { bundledCatalog,bundledConfiguration } from '../../server/bundled-slicer';
import { createConfiguredSlicing,prepareSlicing,slicingProfile } from '../../server/slicing-http';
import { hashBytes } from '../../server/slicing-config';
const root=resolve('vendor/bambu'),out=resolve(process.argv[2]??'../../evidence/x-series-slicing');await mkdir(out,{recursive:true});
const entries=(await bundledCatalog(root)).filter(p=>['Bambu Lab X1','Bambu Lab X2D'].includes(p.printer.model));
const reports=[];
for(const entry of entries){
 const directory=join(out,entry.id);await mkdir(directory,{recursive:true});
 const config=await bundledConfiguration(root,directory,entry.id,true);
 config.workRoot=resolve("../../xs",entry.id);
 const context=await createConfiguredSlicing(directory,{config,bundledDirectory:root});
 try{
  const geometry=await parseSTL(await readFile('public/fixtures/bracket.stl'),'mm');
  const part:Part={id:'software-fixture',name:'NON-MANUFACTURABLE software fixture',geometry,source:{kind:'fixture',documentId:'fixture',elementId:'fixture',versionId:'fixture-v1',configuration:'default',available:true},quantity:1,spareQuantity:0,classification:'make',category:'spacer'};
  const project=createProject('NON-MANUFACTURABLE native slicing validation');project.parts=[part];const job=createJob([part]);project.jobs=[job];project.activeJobId=job.id;job.items[0].position=[80,80,0];job.items[0].orientation=[90,0,0];Object.assign(job,await slicingProfile(context,job.settings));
  const prep=await prepareSlicing(context,project,job.id);const record=JSON.parse(await readFile(join(context.workRoot,'preparations',prep.preparationId,'preparation.json'),'utf8'));
  const queued=await context.service.createJob(record.request,`software-${Date.now()}`);
  const deadline=Date.now()+180000;let done=context.service.getJob(queued.id)!;
  while(['queued','running'].includes(done.status)){if(Date.now()>deadline){await context.service.cancelJob(done.id);throw new Error('Native fixture slice timed out.');}await new Promise(r=>setTimeout(r,200));done=context.service.getJob(done.id)!;}
  await writeFile(join(directory,'worker.json'),JSON.stringify(done,null,2));
  if(done.status!=='succeeded'||!done.result?.slicerProject)throw new Error(done.error??'Native slice did not succeed.');
  const bytes=Buffer.from(done.result.slicerProject.data,'base64');await writeFile(join(directory,'NON-MANUFACTURABLE.gcode.3mf'),bytes);
  reports.push({id:entry.id,model:entry.printer.model,material:entry.material.type,status:done.status,slicerVersion:done.result.slicerVersion,profileBundleHash:prep.profileBundleHash,manifestHash:prep.manifestHash,geometryHash:geometry.hash,source:part.source,nativeProjectHash:hashBytes(bytes),toolpathHash:done.result.toolpathHash,previewSupported:done.result.previewSupported,printerContacted:false,physicalQualification:false});
  console.log(`${entry.id}: ${done.status}; native 3MF ${hashBytes(bytes)}`);
 }finally{await context.service.shutdown();}
}
await writeFile(join(out,'summary.json'),JSON.stringify({scope:'Real Windows CLI software fixture slices only. No physical qualification or printer access.',reports},null,2));
