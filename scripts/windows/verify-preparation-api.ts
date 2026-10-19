import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createProject} from '../../src/domain/model';
import {parseSTL} from '../../src/adapters/geometry';
import {fingerprint} from '../../src/domain/invariants';
const origin=process.argv[2],out=process.argv[3];if(!/^http:\/\/127[.]0[.]0[.]1:\d+$/.test(origin)||!out)throw Error('Provide local origin and fresh report directory');await mkdir(out,{recursive:true});
async function api(path:string,body?:unknown){const r=await fetch(origin+path,{headers:{Origin:origin,...(body?{'Content-Type':'application/json'}:{})},...(body?{method:'POST',body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(120000)});const data=await r.json();if(!r.ok)throw Error(path+' HTTP '+r.status+': '+data.error);return data;}
const project=createProject('NON-MANUFACTURABLE slicing API diagnostic'),job=project.jobs[0];
project.parts.push({id:'diagnostic-fixture',name:'Public bracket fixture',geometry:await parseSTL(await readFile('public/fixtures/bracket.stl'),'mm'),source:{kind:'fixture',documentId:'software-fixture',elementId:'bracket',versionId:'fixture-v1',configuration:'default'},classification:'make',quantity:1,spareQuantity:0,category:'bracket'});
job.items=[{partId:project.parts[0].id,quantity:1,spareQuantity:0,position:[128,128,0],orientation:[0,0,0]}];
const profile=await api('/api/slicing/profile',{settings:job.settings});Object.assign(job,{printer:profile.printer,material:profile.material,slicer:profile.slicer});
const prepared=await api('/api/slicing/prepare',{project,jobId:job.id});if(prepared.manifestHash!==await fingerprint(project,job))throw Error('Manifest changed across HTTP preparation');
let slice=await api('/api/slicing/jobs',{preparationId:prepared.preparationId,manifestHash:prepared.manifestHash,idempotencyKey:'diagnostic-'+crypto.randomUUID()});
const deadline=Date.now()+180000;while(['queued','running'].includes(slice.status)&&Date.now()<deadline){await new Promise(r=>setTimeout(r,700));slice=await api('/api/slicing/jobs/'+slice.id);}
const report={at:new Date().toISOString(),scope:'Public fixture through actual installed prepare/queue/status APIs; no user project, Onshape calls or printer operations',id:slice.id,status:slice.status,error:slice.error,logs:slice.logs,manifestHash:slice.manifestHash,toolpathHash:slice.result?.toolpathHash,previewSupported:slice.result?.previewSupported,previewIssues:slice.result?.previewIssues,profileLabel:profile.profileLabel};
await writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:slice.status,error:slice.error,profileLabel:profile.profileLabel,toolpathHash:slice.result?.toolpathHash}));if(slice.status!=='succeeded')process.exitCode=1;
