import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { parseSTL } from '../src/adapters/geometry';
import type { Part, Project } from '../src/domain/model';
import { createJob, createProject } from '../src/domain/model';
import { approvalFingerprint, approveJob, assignJob, attachToolpath, exportJobPackage, fingerprint, fitWarnings,
  invalidateJob, isApprovalCurrent, isDemonstration, isToolpathCurrent, layoutInstances, manufacturingManifest,
  operatorTransition, releaseJob, reviewToolpath, rotatedDimensions, settingOverrides, sha256, stableStringify,
  toMillimetres, validateDimensions, validateJob } from '../src/domain/invariants';
import { deserializeProject, serializeProject } from '../src/domain/persistence';
const vertices=[[0,0,0],[10,0,0],[10,10,0],[0,10,0],[0,0,10],[10,0,10],[10,10,10],[0,10,10]];
const triangles=[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
const cubeSTL='solid cube\n'+triangles.map(t=>'facet normal 0 0 0\nouter loop\n'+t.map(v=>'vertex '+vertices[v].join(' ')).join('\n')+'\nendloop\nendfacet').join('\n')+'\nendsolid cube';
const gcode='G21\nG90\nM82\nG92 E0\nG0 X35 Y45 Z0.2\n;TYPE:Outer wall\nG1 X45 Y45 E1 F1200\nG1 X45 Y55 E2\nG1 X35 Y55 E3\nG1 X35 Y45 E4\nG0 Z0.4\n;TYPE:Internal infill\nG1 X45 Y55 E5\n';
async function setup(local=false):Promise<Project>{
  const p:Part={id:'part-1',name:'Arm bracket',geometry:await parseSTL(cubeSTL,'mm',{name:'original-cube.stl'}),
    source:local?{kind:'local',revision:'local import'}:{kind:'fixture',documentId:'robot',elementId:'assembly',versionId:'v17',configuration:'size=10',occurrences:[{path:['arm','left'],transform:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}]},
    quantity:2,spareQuantity:1,category:'bracket',classification:'make'};
  const project=createProject('Drive train');project.parts=[p];project.jobs=[createJob([p],'Bracket batch')];project.activeJobId=project.jobs[0].id;
  if(local){project.jobs[0].printer.tested=true;project.jobs[0].material.tested=true;}
  return project;
}
async function sliced(project:Project){const job=project.jobs[0];await attachToolpath(project,job,gcode,{name:'bracket.gcode',source:'imported',slicer:{id:'test-slicer',version:'1.2.3'},mappingConfirmed:true});return job;}
async function approved(project:Project){const job=await sliced(project);await reviewToolpath(project,job,'Morgan');await approveJob(project,job,'Morgan');return job;}
const checks={machine:true,material:true,nozzle:true,plate:true,clearBed:true};

describe('explicit geometry and quantities',()=>{
  it('converts inches once and detects inch/mm dimension errors',()=>{
    expect(toMillimetres(1,'in')).toBe(25.4);expect(toMillimetres(25.4,'mm')).toBe(25.4);
    expect(()=>validateDimensions([25.4,50.8,25.4],[1,2,1])).toThrow(/inch\/mm/);
    expect(()=>toMillimetres(1,'cm' as 'mm')).toThrow(/Explicit/);
    expect(()=>validateDimensions([0,1,1])).toThrow(/Invalid/);
  });
  it('retains repeated occurrence quantities and adds spares without changing source instances',async()=>{
    const p=await setup(),job=p.jobs[0];const m=manufacturingManifest(p,job);
    expect(m.parts[0]).toMatchObject({quantity:2,spareQuantity:1,totalQuantity:3,source:{configuration:'size=10',versionId:'v17'}});
    const instances=layoutInstances(p,job);expect(instances).toHaveLength(3);expect(instances.map(v=>v.position)).toEqual([[35,45,0],[53,45,0],[35,63,0]]);
    expect(p.parts[0].source.occurrences).toHaveLength(1);expect(fitWarnings(p,job)).toEqual([]);
  });
  it('rejects unavailable linked parts, ambiguous classifications, fractions and forged geometry',async()=>{
    const p=await setup(),job=p.jobs[0];p.parts[0].source.available=false;
    await expect(validateJob(p,job)).rejects.toThrow(/unavailable/);p.parts[0].source.available=true;p.parts[0].classification='review';
    await expect(validateJob(p,job)).rejects.toThrow(/classify/);p.parts[0].classification='make';job.items[0].spareQuantity=-1;
    await expect(validateJob(p,job)).rejects.toThrow(/Quantities/);job.items[0].spareQuantity=0;p.parts[0].geometry.stl+='modified';
    await expect(validateJob(p,job)).rejects.toThrow(/hash/);
  });
  it('shares XYZ rotation and quantity layout with fit validation',async()=>{
    expect(rotatedDimensions([10,20,30],[0,90,0])[0]).toBeCloseTo(30);
    const p=await setup(),job=p.jobs[0];job.items[0].position=[254,45,0];expect(fitWarnings(p,job)[0]).toMatch(/outside/);
    await expect(sliced(p)).rejects.toThrow(/outside/);
  });
});

describe('review and complete manifest binding',()=>{
  it('requires exact imported-file attestation and actual layer review',async()=>{
    const p=await setup(),job=p.jobs[0];
    await expect(attachToolpath(p,job,gcode,{name:'x',source:'imported',mappingConfirmed:false})).rejects.toThrow(/Confirm/);
    await sliced(p);await expect(approveJob(p,job,'Morgan')).rejects.toThrow(/Review the actual/);
    await reviewToolpath(p,job,'Morgan');await approveJob(p,job,'Morgan');expect(job.status).toBe('approved');
    expect(job.approval?.manifestHash).toBe(await approvalFingerprint(p,job));
    expect(job.approval?.toolpathHash).toBe(await sha256(gcode));expect(isDemonstration(p,job)).toBe(true);
  });
  it('rejects unsupported or out-of-bounds toolpaths even if caller supplies false safe bounds',async()=>{
    const p=await setup(),job=p.jobs[0];
    await expect(attachToolpath(p,job,gcode+'G2 X10 Y10 I5 E6\n',{name:'arc',source:'imported',mappingConfirmed:true})).rejects.toThrow(/Unsupported command G2/);
    await expect(attachToolpath(p,job,gcode.replace('X45','X500'),{name:'bad',source:'imported',mappingConfirmed:true,bounds:{min:[0,0,0],max:[1,1,1]}})).rejects.toThrow(/exceed/);
    await expect(attachToolpath(p,job,gcode.replace('G21\n',''),{name:'units',source:'imported',mappingConfirmed:true})).rejects.toThrow(/unit declaration/);
  });
  it.each([
    ['source version',(p:Project)=>{p.parts[0].source.versionId='v18';}],
    ['configuration',(p:Project)=>{p.parts[0].source.configuration='size=20';}],
    ['quantity',(p:Project)=>{p.jobs[0].items[0].quantity=3;}],
    ['spares',(p:Project)=>{p.jobs[0].items[0].spareQuantity=2;}],
    ['orientation',(p:Project)=>{p.jobs[0].items[0].orientation[0]=90;}],
    ['placement',(p:Project)=>{p.jobs[0].items[0].position[0]=55;}],
    ['printer',(p:Project)=>{p.jobs[0].printer.id='other';}],
    ['nozzle',(p:Project)=>{p.jobs[0].printer.nozzleDiameter=0.6;}],
    ['plate',(p:Project)=>{p.jobs[0].printer.plate='other';}],
    ['material',(p:Project)=>{p.jobs[0].material.name='PLA';}],
    ['settings',(p:Project)=>{p.jobs[0].settings.walls=5;}],
    ['slicer version',(p:Project)=>{p.jobs[0].slicer.version='1.2.4';}],
    ['toolpath bytes',(p:Project)=>{p.jobs[0].toolpath!.gcode+=';changed';}],
    ['geometry bytes',(p:Project)=>{p.parts[0].geometry.stl+=';changed';}],
  ])('invalidates approval after changing %s',async(_label,mutate)=>{
    const p=await setup(),job=await approved(p);mutate(p);expect(await isApprovalCurrent(p,job)).toBe(false);
    await expect(releaseJob(p,job,{idempotencyKey:'one',actor:'Morgan',checks})).rejects.toThrow(/stale or missing/);
  });
  it('preserves overrides and review history while marking a result stale',async()=>{
    const p=await setup(),job=await approved(p);job.settings.walls=6;invalidateJob(job,'Changed wall count','Morgan');
    expect(settingOverrides(job)).toEqual({walls:{base:4,value:6}});expect(job.toolpath?.stale).toBe(true);expect(job.approval).toBeUndefined();
    expect(job.status).toBe('ready to slice');expect(job.reviews.some(r=>r.action==='approved')).toBe(true);
    await expect(reviewToolpath(p,job,'Morgan')).rejects.toThrow(/stale/);
  });
  it('coalesces duplicate concurrent approvals and releases',async()=>{
    const p=await setup(),job=await sliced(p);await reviewToolpath(p,job,'Morgan');
    await Promise.all([approveJob(p,job,'Morgan'),approveJob(p,job,'Morgan')]);expect(job.reviews.filter(r=>r.action==='approved')).toHaveLength(1);
    const [a,b]=await Promise.all([releaseJob(p,job,{actor:'Morgan',idempotencyKey:'same'}),releaseJob(p,job,{actor:'Morgan',idempotencyKey:'same'})]);
    expect(a.id).toBe(b.id);expect(job.releases).toHaveLength(1);expect(job.status).toBe('approved');
  });
  it('keeps assignment distinct from physical printing and requires explicit operator checks',async()=>{
    const p=await setup(true),job=await approved(p);expect(job.approval!.demonstrationOnly).toBe(false);
    await assignJob(p,job,'Printer operator','Morgan');expect(job.status).toBe('assigned');
    await expect(releaseJob(p,job,{idempotencyKey:'unchecked',actor:'Morgan',checks:{} as typeof checks})).rejects.toThrow(/operator must confirm/);
    await releaseJob(p,job,{idempotencyKey:'verified',actor:'Morgan',checks});
    expect(job.status).toBe('assigned');await operatorTransition(p,job,'printing','Morgan');expect(job.status).toBe('printing');
    await operatorTransition(p,job,'completed','Morgan');expect(job.status).toBe('completed');
    await expect(assignJob(p,job,'Different station','Morgan')).rejects.toThrow(/cannot be reset/);
  });
  it('does not allow demonstration jobs to claim physical activity',async()=>{
    const p=await setup(),job=await approved(p);await assignJob(p,job,'Morgan');await releaseJob(p,job,{actor:'Morgan',idempotencyKey:'demo'});
    await expect(operatorTransition(p,job,'printing','Morgan')).rejects.toThrow(/Demonstration/);
  });
});

describe('versioned persistence and packages',()=>{
  it('round trips reviewed projects and exact original imports',async()=>{
    const p=await setup(),job=await approved(p);await releaseJob(p,job,{actor:'Morgan',idempotencyKey:'first'});
    const reopened=await deserializeProject(serializeProject(p));expect(reopened).toEqual(p);expect(await isApprovalCurrent(reopened,reopened.jobs[0])).toBe(true);
    expect(reopened.parts[0].geometry.original!.data).toBe(p.parts[0].geometry.original!.data);
  });
  it('recovers a stale result after save interruption without retaining approval',async()=>{
    const p=await setup();await approved(p);p.jobs[0].settings.infill=45;
    const reopened=await deserializeProject(serializeProject(p));expect(reopened.jobs[0].approval).toBeUndefined();expect(reopened.jobs[0].toolpath!.stale).toBe(true);
    expect(reopened.jobs[0].reviews.at(-1)?.actor).toBe('Project recovery');expect(await isToolpathCurrent(reopened,reopened.jobs[0])).toBe(false);
  });
  it('rejects corrupted imports and mismatched dimensional metadata',async()=>{
    const p=await setup();p.parts[0].geometry.hash='0'.repeat(64);await expect(deserializeProject(serializeProject(p))).rejects.toThrow(/checksum/);
    const q=await setup();q.parts[0].geometry.dimensions=[254,254,254];await expect(deserializeProject(serializeProject(q))).rejects.toThrow(/inch\/mm/);
    await expect(deserializeProject('{broken')).rejects.toThrow(/not valid JSON/);
    await expect(deserializeProject('{"schemaVersion":9}')).rejects.toThrow(/Invalid Catalyst/);
  });
  it('invalidates forged demonstration flags and missing physical approval records',async()=>{
    const p=await setup();await approved(p);p.jobs[0].approval!.demonstrationOnly=false;
    const reopened=await deserializeProject(serializeProject(p));expect(reopened.jobs[0].approval).toBeUndefined();
    const q=await setup();q.jobs[0].status='assigned';const r=await deserializeProject(serializeProject(q));expect(r.jobs[0].status).toBe('ready to slice');
  });
  it('exports original geometry, exact toolpath, versioned manifest, complete hashes and replayable project',async()=>{
    const p=await setup(),job=await approved(p);const bytes=await exportJobPackage(p,job,{actor:'Morgan',idempotencyKey:'package-v1'});
    const repeated=await exportJobPackage(p,job,{actor:'Morgan',idempotencyKey:'package-v1'});expect(repeated).toEqual(bytes);expect(job.releases).toHaveLength(1);
    const files=unzipSync(bytes);
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['manifest.json','project.catalyst.json','settings.json','toolpaths/job.gcode','geometry/part-1.stl','originals/part-1.stl','README.txt','checksums.sha256.json']));
    const checksums=JSON.parse(strFromU8(files['checksums.sha256.json'])) as Record<string,string>;
    for(const [name,hash]of Object.entries(checksums))expect(await sha256(files[name])).toBe(hash);
    expect(strFromU8(files['toolpaths/job.gcode'])).toBe(gcode);expect(strFromU8(files['originals/part-1.stl'])).toBe(cubeSTL);
    const manifest=JSON.parse(strFromU8(files['manifest.json']));expect(manifest).toMatchObject({schemaVersion:1,units:'mm',demonstrationOnly:true,dispatchPerformed:false,toolpathHash:await sha256(gcode)});
    expect(manifest.parts[0].totalQuantity).toBe(3);expect(strFromU8(files['README.txt'])).toMatch(/DO NOT RUN ON A MACHINE/);
    const reopened=await deserializeProject(strFromU8(files['project.catalyst.json']));expect(await fingerprint(reopened,reopened.jobs[0])).toBe(await fingerprint(p,job));
  });
  it('canonicalizes object key order while binding relevant content',async()=>{
    expect(await sha256(stableStringify({a:1,b:2}))).toBe(await sha256(stableStringify({b:2,a:1})));
    expect(()=>stableStringify({v:Infinity})).toThrow(/Non-finite/);
  });
});
