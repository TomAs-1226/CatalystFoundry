/** Public non-manufacturable fixture, actual authenticated cloud storage; no Onshape geometry requests. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {CadLibrary} from '../../server/cad-library';
import {parseSTL} from '../../src/adapters/geometry';
import {decodeSharedCad,snapshotProject} from '../../src/domain/shared-cad';
import {isDemonstration} from '../../src/domain/invariants';
import type {Part} from '../../src/domain/model';
const origin=new URL(process.argv[2]);if(origin.protocol!=='http:'||origin.hostname!=='127.0.0.1'||origin.pathname!=='/')throw Error('Use the normal installed loopback origin.');
const reportPath=resolve(process.argv[3]??'../../evidence/cloud-library-live-verification.json'),directory=resolve('../../evidence/cloud-library-live-cache-'+randomUUID().slice(0,8));await mkdir(directory,{recursive:true});
async function local<T>(path:string,method='GET',body?:unknown):Promise<T>{const response=await fetch(origin.origin+path,{method,headers:{Origin:origin.origin,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60000)});const value=await response.json();if(!response.ok)throw Error(value.error??'Local verification request failed');return value;}
let online=true,bridgeRequests=0;const sync={localCacheScope:async()=>'0'.repeat(64),request:async<T>(path:string,method='GET',body?:unknown):Promise<T>=>{if(!online)throw Error('Injected offline transport for this isolated verifier only');if(!path.startsWith('/v1/cad/snapshots'))throw Error('Provider request forbidden');bridgeRequests++;return local<T>('/api/sync'+path.slice(3),method,body);}};
const before=await local<{attempts:number}>('/api/sync/onshape/budget');
const part:Part={id:'automated-cloud-fixture',name:'NON-MANUFACTURABLE automatic cloud fixture',quantity:3,spareQuantity:0,classification:'make',category:'bracket',geometry:await parseSTL(await readFile('public/fixtures/bracket.stl'),'mm'),source:{kind:'fixture',documentId:'software-fixture',versionId:'fixture-v1',elementId:'bracket',assemblyMemberships:[{path:['Test'],names:['Test'],quantity:3}]}};
const library=new CadLibrary(join(directory,'first-device'),sync),second=new CadLibrary(join(directory,'second-device'),sync);let id='';
const label='AUTOMATED NON-MANUFACTURABLE AUTO-CLOUD '+randomUUID().slice(0,8);
try{
 const saved=await library.saveParts([part],{documentId:'a'.repeat(24),versionId:'b'.repeat(24),elementId:'c'.repeat(24),elementType:'assembly',configuration:'default',library:{label,workOrder:'automated-cloud-library-check'}});if(saved.state!=='pending')throw Error(saved.message);
 await library.refresh();const uploaded=await library.status();if(uploaded.pendingCount||uploaded.mode!=='online'||uploaded.snapshots.length<1)throw Error('Automatic cloud upload did not finish');const record=uploaded.snapshots.find(s=>s.metadata.workOrder==='automated-cloud-library-check'&&s.metadata.label===label)!;id=record?.id;if(!id)throw Error('New automated snapshot not found');
 await second.refresh();if(!(await second.status()).cachedIds.includes(id))throw Error('Automatic second-device prefetch failed');
 online=false;const calls=bridgeRequests,reopened=new CadLibrary(join(directory,'second-device'),sync);const decoded=await decodeSharedCad(await reopened.read(id));const project=snapshotProject(decoded,[part.id]);if(decoded.parts[0].geometry.hash!==part.geometry.hash||!isDemonstration(project,project.jobs.find(j=>j.id===project.activeJobId)!)||project.jobs.some(j=>j.approval||j.toolpath||j.operatorChecks))throw Error('Offline fixture identity or qualification failed');if(calls!==bridgeRequests)throw Error('Offline read unexpectedly requested cloud data');reopened.stop();online=true;
 await local('/api/sync/cad/snapshots/'+id,'DELETE');const listing=await local<{snapshots:{id:string}[]}>('/api/sync/cad/snapshots');if(listing.snapshots.some(s=>s.id===id))throw Error('Fixture cleanup failed');id='';
 const after=await local<{attempts:number}>('/api/sync/onshape/budget');if(after.attempts!==before.attempts)throw Error('Onshape attempts changed; check concurrent CAD activity');
 const report={passed:true,verifiedAt:new Date().toISOString(),scope:'Current CadLibrary source with actual authenticated production CAD storage through the normal desktop proxy; two isolated local cache directories; injected offline transport on verifier only',automaticUpload:true,automaticPrefetch:true,restartOfflineRead:true,offlineCloudRequests:0,onshapeAttemptsBefore:before.attempts,onshapeAttemptsAfter:after.attempts,additionalOnshapeAttempts:0,fixtureGeometryHash:part.geometry.hash,fixtureRemainsNonManufacturable:true,userProjectModified:false,privateCADUploaded:false,printerContacted:false,testSnapshotRemoved:true};await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{library.stop();second.stop();if(id)await local('/api/sync/cad/snapshots/'+id,'DELETE');}

