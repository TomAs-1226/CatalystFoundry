/** Authenticated live Foundry storage only. No Onshape, user project or printer mutation. */
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {encodeSharedCad,decodeSharedCad,snapshotProject} from '../../src/domain/shared-cad';
import {parseSTL} from '../../src/adapters/geometry';
import {isDemonstration} from '../../src/domain/invariants';
import type {Part} from '../../src/domain/model';
import type {SharedSnapshot,SnapshotDownload} from '../../src/domain/shared-cad-contract';
export type SharedCadProbeAPI=<T>(path:string,method?:string,body?:unknown)=>Promise<T>;
export async function verifySharedCadStorage(api:SharedCadProbeAPI,reportPath:string,scope:string,fixturePath=resolve('public/fixtures/bracket.stl')){
const before=await api<{attempts:number}>('/onshape/budget'),initial=await api<{snapshots:SharedSnapshot[]}>('/cad/snapshots');
const geometry=await parseSTL(await readFile(fixturePath),'mm');
const part:Part={id:'automated-shared-fixture',name:'NON-MANUFACTURABLE shared CAD test',quantity:3,spareQuantity:0,classification:'make',category:'bracket',geometry,source:{kind:'fixture',documentId:'software-fixture',elementId:'bracket',versionId:'fixture-v1',configuration:'default',available:true,assemblyMemberships:[{path:['Test subsystem'],names:['Test subsystem'],quantity:3}]}};
let created:SharedSnapshot|undefined,removed=false;
try{
 const upload=await encodeSharedCad([part],'AUTOMATED NON-MANUFACTURABLE CHECK '+randomUUID().slice(0,8),'automated-shared-cad-check',true);
 const saved=await api<SharedSnapshot>('/cad/snapshots','POST',upload);if(initial.snapshots.some(record=>record.id===saved.id))throw Error('Refusing to change an existing shared snapshot.');created=saved;
 const catalog=await api<{snapshots:SharedSnapshot[]}>('/cad/snapshots');if(!catalog.snapshots.some(record=>record.id===saved.id))throw Error('Published fixture not listed.');
 const record=await api<SnapshotDownload>('/cad/snapshots/'+saved.id),decoded=await decodeSharedCad(record),project=snapshotProject(decoded,[part.id]),job=project.jobs.find(job=>job.id===project.activeJobId)!;
 if(decoded.parts[0].geometry.hash!==geometry.hash||decoded.parts[0].quantity!==3||!isDemonstration(project,job)||job.approval||job.toolpath)throw Error('Downloaded fixture identity/quantity/qualification mismatch.');
 await api('/cad/snapshots/'+saved.id,'DELETE');removed=true;
 const afterList=await api<{snapshots:SharedSnapshot[]}>('/cad/snapshots');if(afterList.snapshots.some(record=>record.id===saved.id))throw Error('Fixture removal not confirmed.');
 const after=await api<{attempts:number}>('/onshape/budget');if(after.attempts!==before.attempts)throw Error('Onshape counter changed during Foundry-only verification. Check for concurrent CAD requests.');
 const report={passed:true,verifiedAt:new Date().toISOString(),scope,fixtureGeometryHash:geometry.hash,fixtureDimensions:geometry.dimensions,quantity:3,subsystemsPreserved:true,fixtureRemainsNonManufacturable:true,approvalsShared:false,privateCADUploaded:false,userProjectModified:false,printerContacted:false,onshapeAttemptsBefore:before.attempts,onshapeAttemptsAfter:after.attempts,additionalOnshapeAttempts:after.attempts-before.attempts,testSnapshotRemoved:removed};
 await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{if(created&&!removed)await api('/cad/snapshots/'+created.id,'DELETE');}

}
