import {afterEach,expect,it,vi} from 'vitest';
import {strToU8,zipSync} from 'fflate';
import {SliceSession,type SliceSessionState} from '../src/components/slice-session';
import {createProject,createJob,type Part} from '../src/domain/model';
import {parseSTL} from '../src/adapters/geometry';
import {attachToolpath,approveJob,reviewToolpath,isToolpathCurrent,isApprovalCurrent,fingerprint,sha256} from '../src/domain/invariants';
import {serializeProject,deserializeProject} from '../src/domain/persistence';
import {GEOMETRY_PREPARATION_VERSION} from '../src/domain/preparation-version';
import type {SliceJob} from '../src/adapters/slicing';
const gcode='; EXECUTABLE_BLOCK_START\nG28\n; MACHINE_START_GCODE_END\nG21\nG90\nM83\nG0 X30 Y30 Z.2\n;TYPE:Outer wall\nG1 X40 E1\nG1 Y40 E1\n; MACHINE_END_GCODE_START\nG1 Y265\n; EXECUTABLE_BLOCK_END\n';
const owners:SliceSession[]=[];afterEach(()=>{owners.splice(0).forEach(s=>s.dispose());vi.useRealTimers();});
async function fixture(){
 const project=createProject('NON-MANUFACTURABLE session fixture'),part:Part={id:'session-fixture',name:'SOFTWARE ONLY',geometry:await parseSTL('solid test\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 10 0 0\nvertex 0 10 1\nendloop\nendfacet\nendsolid','mm'),source:{kind:'fixture',documentId:'software',versionId:'test',elementId:'test',configuration:'default'},classification:'make',quantity:1,spareQuantity:0,category:'custom'};
 project.parts=[part];project.jobs=[createJob([part])];project.activeJobId=project.jobs[0].id;const job=project.jobs[0];job.items[0].position=[35,35,0];job.slicer={id:'bambu-studio-cli',version:'2.8.2.61',profileBundleHash:'a'.repeat(64)};
 const bytes=zipSync({'Metadata/plate_1.gcode':strToU8(gcode)}),artifact={name:'NON-MANUFACTURABLE.3mf',encoding:'base64' as const,format:'3mf' as const,data:Buffer.from(bytes).toString('base64'),hash:await sha256(bytes)};
 const slice:SliceJob={id:'software-slice',status:'succeeded',progress:100,manifestHash:await fingerprint(project,job),idempotencyKey:'software',requestHash:'b'.repeat(64),logs:[],createdAt:'2026-10-18T00:00:00Z',updatedAt:'2026-10-18T00:00:00Z',result:{gcode,toolpathHash:await sha256(gcode),slicerVersion:job.slicer.version,preparationVersion:GEOMETRY_PREPARATION_VERSION,slicerProject:artifact,projectHash:artifact.hash,previewSupported:true,demonstration:false}};
 return {project,job,slice};
}
async function environment(){
 const data=await fixture();let current={project:data.project,job:data.job},busy=false,state:SliceSessionState={phase:'idle',message:''};
 const read=vi.fn(async()=>data.slice),list=vi.fn(async()=>[data.slice]);
 const attach=vi.fn(async(slice:SliceJob)=>{const {project,job}=current;await attachToolpath(project,job,slice.result!.gcode,{source:'bambu',name:'SOFTWARE ONLY',preparationVersion:GEOMETRY_PREPARATION_VERSION,mappingConfirmed:true,slicerProject:slice.result!.slicerProject});return true;});
 const preview=vi.fn(),session=new SliceSession({current:()=>current,busy:()=>busy,read,list,attach,preview,changed:s=>{state=s;}});owners.push(session);
 return {...data,session,read,list,attach,preview,state:()=>state,setBusy:(value:boolean)=>{busy=value;},setCurrent:(value:typeof current)=>{current=value;session.context();}};
}
it('recovers exact saved output directly in Review, commits before preview, and preserves fixture approval after reopen',async()=>{
 const e=await environment();await e.session.restore();expect(e.state().phase).toBe('ready');expect(e.attach).toHaveBeenCalledTimes(1);expect(e.preview).toHaveBeenCalledTimes(1);expect(await isToolpathCurrent(e.project,e.job)).toBe(true);
 await reviewToolpath(e.project,e.job,'Software fixture reviewer');await approveJob(e.project,e.job,'Software fixture reviewer');expect(e.job.approval!.demonstrationOnly).toBe(true);const reopened=await deserializeProject(serializeProject(e.project));expect(await isApprovalCurrent(reopened,reopened.jobs[0])).toBe(true);
 await e.session.restore();expect(e.attach).toHaveBeenCalledTimes(1);
});
it('continues queued monitoring when the workspace subscriber leaves for Review',async()=>{
 const e=await environment();vi.useFakeTimers();await e.session.accept({...e.slice,status:'running',result:undefined});
 // Only the workspace subscriber disappears. The App-owned session remains.
 await vi.advanceTimersByTimeAsync(700);await vi.waitFor(()=>expect(e.state().phase).toBe('ready'));expect(e.read).toHaveBeenCalledTimes(1);expect(await isToolpathCurrent(e.project,e.job)).toBe(true);
 await vi.advanceTimersByTimeAsync(5000);expect(e.read).toHaveBeenCalledTimes(1);
});
it('waits for a busy action and resumes attachment; a transient rejected commit can retry',async()=>{
 const e=await environment();e.setBusy(true);await e.session.accept(e.slice);expect(e.state().phase).toBe('waiting');expect(e.attach).not.toHaveBeenCalled();e.setBusy(false);e.attach.mockResolvedValueOnce(false);await e.session.resume();expect(e.state().phase).toBe('waiting');await e.session.resume();expect(e.state().phase).toBe('ready');expect(e.preview).toHaveBeenCalledTimes(1);
});
it('discards late restoration after a new slice is offered and after switching jobs',async()=>{
 const e=await environment();let finish!:(jobs:SliceJob[])=>void;e.list.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const restoring=e.session.restore();await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
 const newer={...e.slice,id:'newer-slice'};await e.session.accept(newer);finish([e.slice]);await restoring;expect(e.state().slice?.id).toBe('newer-slice');
 let readFinish!:(slice:SliceJob)=>void;e.read.mockImplementationOnce(()=>new Promise(resolve=>{readFinish=resolve;}));const next=await fixture();e.list.mockResolvedValueOnce([next.slice]);e.setCurrent({project:next.project,job:next.job});const oldRestore=e.session.restore();await vi.waitFor(()=>expect(readFinish).toBeTypeOf('function'));const third=await fixture();e.setCurrent({project:third.project,job:third.job});readFinish(next.slice);await oldRestore;expect(third.job.toolpath).toBeUndefined();expect(e.state().slice).toBeUndefined();
});
it('does not silently restore a revoked mapping or claim attachment when the commit did nothing',async()=>{
 const e=await environment();await e.session.accept(e.slice);e.job.toolpath!.mappingConfirmed=false;e.job.toolpath!.stale=true;await e.session.retry();expect(e.state().phase).toBe('blocked');expect(e.state().message).toMatch(/withdrawn/);expect(e.attach).toHaveBeenCalledTimes(1);
 const other=await environment();other.attach.mockResolvedValueOnce(true);await other.session.accept(other.slice);expect(other.state().phase).toBe('blocked');expect(other.state().message).toMatch(/not retained/);expect(other.preview).not.toHaveBeenCalled();
});
it('keeps changed inputs and corrupt native artifacts blocked with a useful reason',async()=>{
 const e=await environment();e.job.settings.walls++;await e.session.accept(e.slice);expect(e.attach).not.toHaveBeenCalled();expect(e.job.toolpath).toBeUndefined();
 const other=await environment();other.slice.result!.slicerProject!.data='AA==';await other.session.accept(other.slice);expect(other.state().phase).toBe('blocked');expect(other.state().message.length).toBeGreaterThan(0);expect(other.preview).not.toHaveBeenCalled();
});
it('marks a formerly attached result outdated after an edit, rather than reporting the old ready state',async()=>{
 const e=await environment();await e.session.accept(e.slice);expect(e.state().phase).toBe('ready');e.job.settings.walls++;await e.session.restore();expect(e.state().phase).toBe('outdated');expect(e.state().message).toMatch(/plate changed/i);expect(e.attach).toHaveBeenCalledTimes(1);
});
it('finishes a newer slice offered during a slow attachment without previewing the superseded result',async()=>{
 const e=await environment(),original=e.attach.getMockImplementation()!;let finish!:()=>Promise<void>;e.attach.mockImplementationOnce(slice=>new Promise(resolve=>{finish=async()=>{await original(slice);resolve(true);};}));
 const first=e.session.accept(e.slice);await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
 const newer=structuredClone(e.slice),text='; second SOFTWARE output\n'+gcode,bytes=zipSync({'Metadata/plate_1.gcode':strToU8(text)});newer.id='newer-while-attaching';newer.result!.gcode=text;newer.result!.toolpathHash=await sha256(text);newer.result!.slicerProject!.data=Buffer.from(bytes).toString('base64');newer.result!.slicerProject!.hash=await sha256(bytes);newer.result!.projectHash=newer.result!.slicerProject!.hash;
 await e.session.accept(newer);await finish();await first;await vi.waitFor(()=>expect(e.state().phase).toBe('ready'));expect(e.state().slice!.id).toBe(newer.id);expect(e.job.toolpath!.hash).toBe(newer.result!.toolpathHash);expect(e.preview).toHaveBeenCalledExactlyOnceWith(newer);
});
