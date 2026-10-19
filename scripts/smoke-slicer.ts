/** Explicit offline smoke; never dispatches, contacts a printer or claims physical validation. */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {unzipSync,strFromU8} from 'fflate';
import {createConfiguredSlicing,slicingProfile,prepareSlicing} from '../server/slicing-http';
import {hashBytes} from '../server/slicing-config';
import {parseSTL} from '../src/adapters/geometry';
import {parseGcode} from '../src/adapters/toolpaths';
import {createProject,createJob,type Part} from '../src/domain/model';
const output=resolve(process.argv[2]??'slicer-smoke-output');await mkdir(output,{recursive:true});
const context=await createConfiguredSlicing(join(output,'state'));
try{
 const capability=await context.service.getCapability();if(!capability.available)throw new Error(capability.reason);
 const geometry=await parseSTL(await readFile(resolve('public/fixtures/bracket.stl')),'mm',{name:'bracket.stl'});
 const part:Part={id:'offline-smoke-fixture',name:'NON-MANUFACTURABLE fixture bracket',geometry,source:{kind:'fixture',available:true,documentId:'offline-smoke',elementId:'fixture',versionId:'immutable-test-v1',configuration:'default'},quantity:2,spareQuantity:1,category:'bracket',classification:'make'};
 const project=createProject('NON-MANUFACTURABLE actual offline slicer smoke');project.parts=[part];project.jobs=[createJob([part])];const job=project.jobs[0];project.activeJobId=job.id;
 job.items[0].position=[80,80,0];job.items[0].orientation=[90,0,0];job.settings={layerHeight:0.2,walls:4,infill:30,supports:false,brimWidth:3,speed:100};
 const profile=await slicingProfile(context,job.settings);Object.assign(job,{printer:profile.printer,material:profile.material,slicer:profile.slicer});
 const prepared=await prepareSlicing(context,project,job.id);const record=JSON.parse(await readFile(join(context.workRoot,'preparations',prepared.preparationId,'preparation.json'),'utf8'));
 const created=await context.service.createJob(record.request,crypto.randomUUID());let result=context.service.getJob(created.id)!;
 for(let n=0;n<2400&&['queued','running'].includes(result.status);n++){await new Promise(r=>setTimeout(r,100));result=context.service.getJob(created.id)!;}
 const jobMetadata=structuredClone(result);if(jobMetadata.result){jobMetadata.result.gcode='See toolpath-NON-MANUFACTURABLE.gcode';if(jobMetadata.result.slicerProject)jobMetadata.result.slicerProject.data='See sliced-NON-MANUFACTURABLE.3mf';}await writeFile(join(output,'slicing-job.json'),JSON.stringify(jobMetadata,null,2));
 if(result.status!=='succeeded'||!result.result?.slicerProject)throw new Error(result.error??`Slicing ended in ${result.status}.`);
 const artifact=Buffer.from(result.result.slicerProject.data,'base64');const archive=unzipSync(artifact);const configPath=Object.keys(archive).find(n=>/project_settings\.config$/.test(n));
 const actualSettings=configPath?JSON.parse(strFromU8(archive[configPath])):undefined;let parsed:ReturnType<typeof parseGcode>|undefined;let parseError:string|undefined;try{parsed=parseGcode(result.result.gcode);}catch(error){parseError=(error as Error).message;}
 const report={executedAt:new Date().toISOString(),adapter:'genuine Bambu Studio CLI subprocess; no injected runner',capability,source:'shipped fixture bracket, not live Onshape',manufacturable:false,printerContacted:false,physicalValidation:false,prepared,instanceCount:3,orientation:job.items[0].orientation,position:job.items[0].position,settings:job.settings,status:result.status,slicerVersion:result.result.slicerVersion,toolpathHash:result.result.toolpathHash,slicerProjectHash:result.result.projectHash,nativeProjectEntries:Object.keys(archive),actualSettings:actualSettings?Object.fromEntries(['layer_height','wall_loops','sparse_infill_density','enable_support','brim_width','outer_wall_speed','curr_bed_type'].map(k=>[k,actualSettings[k]])):null,preview:{layers:parsed?.layers.length,segments:parsed?.segments.length,canApprove:parsed?.canApprove??false,blockingIssues:parsed?.blockingIssues??[parseError],warnings:parsed?.warnings??[],nativeLayerMarkers:(result.result.gcode.match(/^; CHANGE_LAYER/gm)??[]).length},limitations:['Fixtures and untested example machine profiles. DO NOT USE ON A PRINTER.','Actual machine-specific startup/end macros exceed Foundry preview support. Approval remains blocked.','No Onshape account, Bambu login or printer connection was used.']};
 await writeFile(join(output,'actual-slicing-report.json'),JSON.stringify(report,null,2));await writeFile(join(output,'sliced-NON-MANUFACTURABLE.3mf'),artifact);await writeFile(join(output,'toolpath-NON-MANUFACTURABLE.gcode'),result.result.gcode);await writeFile(join(output,'prepared-NON-MANUFACTURABLE.3mf'),await readFile(record.request.preparedInputPath));await writeFile(join(output,'README.txt'),'NON-MANUFACTURABLE ACTUAL OFFLINE SLICER SMOKE\nReal Bambu Studio software output from fixture CAD and untested example profiles. Do not run on a machine. No machine was contacted. Foundry approval remains blocked for unsupported proprietary macros.\n');console.log(JSON.stringify({status:result.status,report:join(output,'actual-slicing-report.json'),toolpathHash:report.toolpathHash,slicerProjectHash:report.slicerProjectHash,layers:parsed?.layers.length,canApprove:parsed?.canApprove??false},null,2));
}finally{await context.service.shutdown();}
