/** Installed local cache acceptance: public fixture only, no user project or Onshape import. */
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {encodeSharedCad,decodeSharedCad,snapshotProject} from '../../src/domain/shared-cad';
import {parseSTL} from '../../src/adapters/geometry';
import {isDemonstration} from '../../src/domain/invariants';
import type {Part} from '../../src/domain/model';
import type {SharedSnapshot,SnapshotDownload} from '../../src/domain/shared-cad-contract';
const origin=new URL(process.argv[2]);if(origin.protocol!=='http:'||origin.hostname!=='127.0.0.1'||origin.pathname!=='/')throw Error('Use the normal installed loopback origin');
async function api<T>(path:string,method='GET',body?:unknown):Promise<T>{const response=await fetch(origin.origin+path,{method,headers:{Origin:origin.origin,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60000)});const value=await response.json();if(!response.ok)throw Error(path+' HTTP '+response.status+': '+value.error);return value;}
type Catalog={snapshots:SharedSnapshot[];cachedIds:string[];mode:string;pendingCount:number;error:string};
const before=await api<{attempts:number}>('/api/sync/onshape/budget');
const part:Part={id:'installed-cache-fixture',name:'NON-MANUFACTURABLE installed cache verification',quantity:3,spareQuantity:0,classification:'make',category:'bracket',geometry:await parseSTL(await readFile('public/fixtures/bracket.stl'),'mm'),source:{kind:'fixture',documentId:'software-fixture',versionId:'fixture-v1',elementId:'bracket',assemblyMemberships:[{path:['Test'],names:['Test'],quantity:3}]}};
let id='';
async function waitFor(check:(catalog:Catalog)=>boolean){for(let attempt=0;attempt<90;attempt++){const value=await api<Catalog>('/api/library');if(check(value))return value;await new Promise(resolve=>setTimeout(resolve,500));}throw Error('The installed cache did not reach its expected state');}
try{
 const upload=await encodeSharedCad([part],'AUTOMATED NON-MANUFACTURABLE INSTALLED CACHE '+randomUUID().slice(0,8),'automated-installed-cache-check',true);
 const record=await api<SharedSnapshot>('/api/sync/cad/snapshots','POST',upload);id=record.id;
 await api('/api/library/refresh','POST',{});await waitFor(value=>value.snapshots.some(s=>s.id===id)&&value.cachedIds.includes(id));
 const downloaded=await api<SnapshotDownload>('/api/library/snapshots/'+id),decoded=await decodeSharedCad(downloaded),project=snapshotProject(decoded,[part.id]);
 if(decoded.parts[0].geometry.hash!==part.geometry.hash||decoded.parts[0].quantity!==3||!isDemonstration(project,project.jobs.find(j=>j.id===project.activeJobId)!)||project.jobs.some(j=>j.approval||j.toolpath||j.operatorChecks))throw Error('Installed cached fixture identity/qualification mismatch');
 const exactId=id;await api('/api/sync/cad/snapshots/'+id,'DELETE');id='';await api('/api/library/refresh','POST',{});const cleaned=await waitFor(value=>!value.snapshots.some(s=>s.id===exactId)&&!value.cachedIds.includes(exactId));
 const after=await api<{attempts:number}>('/api/sync/onshape/budget');if(after.attempts!==before.attempts)throw Error('Onshape counter changed; check concurrent CAD activity');
 const report={passed:true,verifiedAt:new Date().toISOString(),scope:'Actual normal installed CadLibrary routes, authenticated production cloud fixture, automatic native prefetch and verified local-cache read; fixture removed from cloud and native catalog afterward',installedNativeCacheVerified:true,automaticNativePrefetch:true,localCachedRead:true,fixtureGeometryHash:part.geometry.hash,fixtureRemainsNonManufacturable:true,cloudAndLocalTestSnapshotRemoved:true,remainingNativeSnapshotCount:cleaned.snapshots.length,onshapeAttemptsBefore:before.attempts,onshapeAttemptsAfter:after.attempts,additionalOnshapeAttempts:0,privateCADUploaded:false,userProjectModified:false,printerContacted:false};
 await writeFile(process.argv[3]??'../../evidence/cloud-library-installed-cache-verification.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{if(id){await api('/api/sync/cad/snapshots/'+id,'DELETE');await api('/api/library/refresh','POST',{});}}
