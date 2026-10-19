import { readFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { prepareConfirmedSlice } from '../src/components/slice-preparation';
import { createProject, type Part, type Project } from '../src/domain/model';
import { parseSTL } from '../src/adapters/geometry';
import { fingerprint, sha256 } from '../src/domain/invariants';
import { arrangePlate, recommendSupports } from '../src/domain/auto-prepare';
import type { ConfiguredSlicingProfile, PreparedSlice, SliceJob } from '../src/adapters/slicing';

async function harness() {
 let project=createProject();const id=project.activeJobId;
 const part:Part={id:'public',name:'Public support fixture',geometry:await parseSTL(await readFile('public/fixtures/support-test.stl','utf8'),'mm'),source:{kind:'fixture',documentId:'test',elementId:'test',versionId:'v1',configuration:'default'},quantity:1,spareQuantity:0,classification:'make',category:'custom'};
 project.parts=[part];project.jobs[0].items=[{partId:part.id,quantity:1,spareQuantity:0,orientation:[0,0,0],position:[999,999,99]}];
 const current=()=>({project,job:project.jobs[0]}),selection={id:'last-used',label:'Fixture printer',printer:project.jobs[0].printer,material:project.jobs[0].material};
 const apply=vi.fn((profile:ConfiguredSlicingProfile)=>{project=structuredClone(project);Object.assign(project.jobs[0],{printer:profile.printer,material:profile.material,slicer:profile.slicer});return structuredClone(project);});
 const preparePlate=vi.fn(async()=>{project=structuredClone(project);project.jobs[0].items=arrangePlate(project,project.jobs[0]);project.jobs[0].settings.supportResolvedStyle=(await recommendSupports(project,project.jobs[0])).style;return structuredClone(project);});
 const resolveProfile=vi.fn(async(settings)=>({...selection,profileLabel:selection.label,slicer:{id:'bambu-studio-cli',version:'2.8.2.61',profileBundleHash:await sha256(JSON.stringify(settings))}}));
 const prepare=vi.fn(async(p:Project,jid:string):Promise<PreparedSlice>=>({preparationId:crypto.randomUUID(),manifestHash:await fingerprint(p,p.jobs.find(j=>j.id===jid)!),profileBundleHash:p.jobs[0].slicer.profileBundleHash!,preparedInputSha256:'a'.repeat(64),slicer:p.jobs[0].slicer,warnings:[]}));
 const queue=vi.fn(async(prep,key)=>({id:crypto.randomUUID(),manifestHash:prep.manifestHash,status:'queued',idempotencyKey:key} as SliceJob));
 return {current,options:{confirmed:true,selection,targetId:id,arrange:true,attemptKey:'one-explicit-attempt',current,checkActive:()=>{},apply,preparePlate,resolveProfile,prepare,queue,stage:vi.fn(),manifest:vi.fn()}};
}
it('one confirmation applies the remembered profile, arranges, resolves supports/settings and queues without waiting for another render or click',async()=>{
 const {options,current}=await harness();const result=await prepareConfirmedSlice(options);
 expect(options.preparePlate).toHaveBeenCalledTimes(1);expect(options.queue).toHaveBeenCalledTimes(1);
 expect(current().job.items[0].position[2]).toBe(0);expect(current().job.settings.supportResolvedStyle).toBe('normal');
 expect(result.manifestHash).toBe(await fingerprint(current().project,current().job));
 expect(options.queue.mock.calls[0][1]).toBe('one-explicit-attempt');expect(current().job.approval).toBeUndefined();
});
it('never prepares or queues before the user confirms the last-used mapping',async()=>{
 const {options}=await harness();options.confirmed=false;
 await expect(prepareConfirmedSlice(options)).rejects.toThrow(/Confirm printer/);expect(options.apply).not.toHaveBeenCalled();expect(options.queue).not.toHaveBeenCalled();
});
it('does not queue if inputs change while the process profile is resolving',async()=>{
 const {options,current}=await harness(),original=options.resolveProfile;
 options.resolveProfile=vi.fn(async settings=>{const profile=await original(settings);current().job.items[0].orientation=[90,0,0];return profile;});
 await expect(prepareConfirmedSlice(options)).rejects.toThrow(/plate changed/);expect(options.prepare).not.toHaveBeenCalled();expect(options.queue).not.toHaveBeenCalled();
});
it('does not queue a different active job or mismatching prepared manifest',async()=>{
 const {options}=await harness();const original=options.prepare;
 options.prepare=vi.fn(async(p,id)=>({...await original(p,id),manifestHash:'f'.repeat(64)}));
 await expect(prepareConfirmedSlice(options)).rejects.toThrow(/plate changed/);expect(options.queue).not.toHaveBeenCalled();
 const other=await harness();other.options.targetId='a-different-job';await expect(prepareConfirmedSlice(other.options)).rejects.toThrow(/active plate/);expect(other.options.queue).not.toHaveBeenCalled();
});
it('requires another explicit review if the service changes the printer or filament during preparation',async()=>{
 for(const change of ['printer','material'] as const){
  const {options}=await harness(),original=options.resolveProfile;
  options.resolveProfile=vi.fn(async settings=>{const profile=await original(settings);return change==='printer'?{...profile,printer:{...profile.printer,nozzleDiameter:.6}}:{...profile,material:{...profile.material,type:'Different filament'}};});
  await expect(prepareConfirmedSlice(options)).rejects.toThrow(/Printer & material/);expect(options.prepare).not.toHaveBeenCalled();expect(options.queue).not.toHaveBeenCalled();
 }
});
