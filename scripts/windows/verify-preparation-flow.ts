/** Single-action, actual installed API acceptance. Public fixture only. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createProject,type Part,type Project} from '../../src/domain/model';
import {parseSTL} from '../../src/adapters/geometry';
import {arrangePlate,recommendSupports} from '../../src/domain/auto-prepare';
import {prepareConfirmedSlice} from '../../src/components/slice-preparation';
import type {ConfiguredSlicingProfile,SliceJob} from '../../src/adapters/slicing';
import {preparePlateModel} from '../../src/domain/prepare-plate';
const origin=process.argv[2],out=resolve(process.argv[3]??'../../evidence/preparation-installed-flow');if(!/^http:\/\/127[.]0[.]0[.]1:\d+$/.test(origin))throw Error('Use the installed loopback origin');await mkdir(out,{recursive:true});
const automatic=process.argv.includes('--automatic');
async function api(path:string,body?:unknown){const response=await fetch(origin+path,{headers:{Origin:origin,...(body?{'Content-Type':'application/json'}:{})},...(body?{method:'POST',body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(120000)}).catch(error=>{throw new Error(path+': '+String(error),{cause:error});});const data=await response.json();if(!response.ok)throw Error(path+' HTTP '+response.status+': '+data.error);return data;}
const before=await api('/api/sync/onshape/budget'),bundle=await api('/api/slicing/bundled'),selection=bundle.profiles.find(p=>p.id===bundle.selectedProfileId);if(!selection)throw Error('Last-used bundled profile was not restored');
let project=createProject('NON-MANUFACTURABLE single-action fixture');const targetId=project.activeJobId;
const part:Part={id:'acceptance-fixture',name:'NON-MANUFACTURABLE public support fixture',geometry:await parseSTL(await readFile('public/fixtures/support-test.stl','utf8'),'mm'),source:{kind:'fixture',documentId:'software-fixture',versionId:'support-v1',elementId:'t-roof',configuration:'default'},classification:'make',quantity:1,spareQuantity:1,category:'custom'};
project.parts=[part];project.jobs[0].items=[{partId:part.id,quantity:1,spareQuantity:1,position:[999,999,99],orientation:[0,0,0]}];
const current=()=>({project,job:project.jobs[0]}),stages:string[]=[];
let done=await prepareConfirmedSlice({confirmed:true,selection,targetId,arrange:true,attemptKey:'single-action-'+crypto.randomUUID(),current,checkActive:()=>{},
 apply:(profile:ConfiguredSlicingProfile)=>{project=structuredClone(project);Object.assign(project.jobs[0],{printer:profile.printer,material:profile.material,slicer:profile.slicer});return structuredClone(project);},
 preparePlate:async()=>{project=structuredClone(project);if(automatic){const prepared=await preparePlateModel(project,project.jobs[0],true,true);project.jobs[0].items=prepared.items;project.jobs[0].settings=prepared.settings;}else{project.jobs[0].items=arrangePlate(project,project.jobs[0]);project.jobs[0].settings.supportResolvedStyle=(await recommendSupports(project,project.jobs[0])).style;}return structuredClone(project);},
 resolveProfile:settings=>api('/api/slicing/profile',{settings}),prepare:(p,id)=>api('/api/slicing/prepare',{project:p,jobId:id}),queue:(prep,key)=>api('/api/slicing/jobs',{preparationId:prep.preparationId,manifestHash:prep.manifestHash,idempotencyKey:key}),stage:message=>{stages.push(message);console.log(message);},manifest:()=>{},
});
const deadline=Date.now()+240000;while(['queued','running'].includes(done.status)&&Date.now()<deadline){await new Promise(r=>setTimeout(r,700));done=await api('/api/slicing/jobs/'+done.id) as SliceJob;}
if(done.status!=='succeeded'||!done.result){await writeFile(join(out,'failure.json'),JSON.stringify({status:done.status,error:done.error,logs:done.logs,scope:'Public fixture acceptance failure'},null,2)+'\n');throw Error(done.error??'Single-action slice did not complete');}
const after=await api('/api/sync/onshape/budget');if(before.attempts!==after.attempts)throw Error('Onshape counter changed during isolated fixture acceptance');
const supportFeatures=[...new Set([...done.result.gcode.matchAll(/;\s*(?:TYPE|FEATURE):\s*([^\r\n]+)/gi)].map(match=>match[1]).filter(feature=>/support/i.test(feature)))];if(!automatic&&!supportFeatures.length)throw Error('Actual output contains no supports');if(automatic&&!project.jobs[0].items[0].orientation.some(value=>Math.abs(value)>.001))throw Error('Automatic preparation did not change the standing fixture rotation');
const report={passed:true,at:new Date().toISOString(),scope:'One confirmed transaction through actual normal installed HTTP APIs. Public fixture only; no user project or UI interaction; no printer operations.',automaticOrientation:automatic,stages,status:done.status,lastUsedProfileId:bundle.selectedProfileId,profileLabel:selection.label,items:project.jobs[0].items,supportSettings:{enabled:project.jobs[0].settings.supports,intent:project.jobs[0].settings.supportStyle,resolved:project.jobs[0].settings.supportResolvedStyle},supportFeatures,manifestHash:done.manifestHash,geometryHash:part.geometry.hash,toolpathHash:done.result.toolpathHash,nativeProjectHash:done.result.projectHash,previewSupported:done.result.previewSupported,onshapeRequests:after.attempts-before.attempts};
await writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');await writeFile(join(out,'NON-MANUFACTURABLE.3mf'),Buffer.from(done.result.slicerProject!.data,'base64'));console.log(JSON.stringify(report,null,2));
