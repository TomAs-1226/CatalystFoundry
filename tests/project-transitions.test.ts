import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {parseSTL} from '../src/adapters/geometry';
import {createProject,createJob,attachToolpath,reviewToolpath,approveJob,invalidateChangedJobs,isApprovalCurrent,releaseJob,type Part} from '../src/domain';
async function approvedBatches(){
 const part:Part={id:'shared-part',name:'Shared bracket',geometry:await parseSTL(readFileSync(new URL('../public/fixtures/bracket.stl',import.meta.url)),'mm'),source:{kind:'local',available:true},category:'bracket',classification:'make',quantity:1,spareQuantity:0};
 const p=createProject();p.parts=[part];p.jobs=[createJob([part],'Batch A'),createJob([part],'Batch B')];p.activeJobId=p.jobs[0].id;
 for(const j of p.jobs){j.items[0].position=[80,80,0];await attachToolpath(p,j,'G21\nG90\nM83\nG0 X50 Y50 Z0.2\nG1 X60 Y50 E1\n',{name:'mapped.gcode',source:'imported',mappingConfirmed:true,slicer:{id:'Reviewed external slicer',version:'1.2.3'}});await reviewToolpath(p,j,'Manufacturing lead');await approveJob(p,j,'Manufacturing lead')}
 return p;
}
describe('shared project manufacturing transitions',()=>{
 it('revokes both approvals when a shared make part becomes purchased',async()=>{const before=await approvedBatches();const after=structuredClone(before);after.parts[0].classification='buy';expect(invalidateChangedJobs(before,after,'Shared part reclassified.')).toHaveLength(2);for(const j of after.jobs){expect(j.approval).toBeUndefined();expect(j.toolpath?.stale).toBe(true);expect(j.status).toBe('ready to slice');await expect(releaseJob(after,j,{actor:'Operator',idempotencyKey:'changed-source'})).rejects.toThrow(/stale|missing/)}expect(before.jobs.every(j=>!!j.approval)).toBe(true)});
 it('preserves the other approved batch when one job changes walls',async()=>{const before=await approvedBatches();const after=structuredClone(before);after.jobs[0].settings.walls++;expect(invalidateChangedJobs(before,after)).toEqual([after.jobs[0].id]);expect(await isApprovalCurrent(after,after.jobs[1])).toBe(true);expect(after.jobs[0].approval).toBeUndefined()});
 it('preserves approvals after navigation or category advice changes with no manufacturing changes',async()=>{const before=await approvedBatches();const after=structuredClone(before);after.activeJobId=after.jobs[1].id;after.parts[0].category='custom';expect(invalidateChangedJobs(before,after)).toEqual([]);for(const j of after.jobs)expect(await isApprovalCurrent(after,j)).toBe(true)});
});
