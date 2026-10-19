import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { syntheticMachine, syntheticFilament, syntheticProcess } from './fixtures/slicing-profile-fixtures';
import { BAMBU_TARGET_VERSION, BambuStudioCliAdapter, runCommand, SlicingService, type BambuCliConfig, type CommandRunner, type SliceContext, type SliceRequest, type SliceResult, type SlicerAdapter } from '../server/slicer';
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const gcode = 'G21\nG90\nM83\nG0 Z0.2\n;TYPE:Outer wall\nG1 X10 E1\n';
const request: SliceRequest = { manifestHash: 'a'.repeat(64), profileBundleHash: 'b'.repeat(64), preparedInputPath: '/tmp/prepared.stl', preparedInputSha256: 'c'.repeat(64), preparedInMillimeters: true, outputDirectory: '/tmp/sliced' };
const dirs: string[] = [];
const temp = async () => { const dir = await mkdtemp(join(tmpdir(), 'catalyst-slicer-test-')); dirs.push(dir); return dir; };
afterEach(async () => { await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const result = (): SliceResult => ({ gcode, toolpathHash: hash(gcode), slicerVersion: 'INJECTED TEST ADAPTER, not Bambu execution', demonstration: false });
function fakeAdapter(work: (context: SliceContext) => Promise<SliceResult> = async () => result()): SlicerAdapter {
  return { capability: async () => ({ available: true, adapter: 'Injected test worker', version: 'test-only', reason: 'Unit test', limitations: [] }), slice: async (_request, context) => work(context) };
}
async function finished(service: SlicingService, id: string) {
  for (let attempt = 0; attempt < 100; attempt++) { const job = service.getJob(id)!; if (!['running', 'queued'].includes(job.status)) return job; await new Promise(resolve => setTimeout(resolve, 3)); }
  throw new Error('Test worker did not finish.');
}
describe('separate slicing worker', () => {
  it('reports unavailable rather than synthesizing slicing results', async () => {
    const service = await SlicingService.open(); expect((await service.getCapability()).available).toBe(false);
    await expect(service.createJob(request, 'first-attempt')).rejects.toThrow(/No verified Bambu/); expect(service.listJobs()).toHaveLength(0);
  });
  it('binds output to exact request and prevents duplicate concurrent action keys', async () => {
    let calls = 0;
    const service = await SlicingService.open({ adapter: fakeAdapter(async context => { calls++; context.progress(30); context.log('Injected test progress.'); return result(); }) });
    const [first, second] = await Promise.all([service.createJob(request, 'same-action'), service.createJob(request, 'same-action')]);
    expect(first.id).toBe(second.id); expect((await finished(service, first.id)).status).toBe('succeeded'); expect(calls).toBe(1);
    expect(service.getJob(first.id)?.result?.toolpathHash).toBe(hash(gcode));
    await expect(service.createJob({ ...request, manifestHash: 'd'.repeat(64) }, 'same-action')).rejects.toThrow(/different/);
  });
  it('validates immutable input fields', async () => {
    const service = await SlicingService.open({ adapter: fakeAdapter() });
    await expect(service.createJob({ ...request, manifestHash: 'missing' }, 'bad')).rejects.toThrow(/hash/);
    await expect(service.createJob(request, '')).rejects.toThrow(/idempotency/);
    await expect(service.createJob({ ...request, preparedInMillimeters: false as never }, 'bad')).rejects.toThrow(/mm/);
  });
  it('accepts native print layers through the worker only with their exact native archive',async()=>{
    const native='; EXECUTABLE_BLOCK_START\nG28\nG380 S2 Z-5\n; MACHINE_START_GCODE_END\n'+gcode+'; MACHINE_END_GCODE_START\nM1006 S1\n; EXECUTABLE_BLOCK_END\n';
    const bytes=zipSync({'Metadata/plate_1.gcode':strToU8(native)}),slicerProject={name:'SOFTWARE-ONLY.3mf',hash:hash(bytes),data:Buffer.from(bytes).toString('base64'),format:'3mf' as const,encoding:'base64' as const};
    for(const [name,artifact,succeeds] of [['exact',slicerProject,true],['loose',undefined,false],['different',{...slicerProject,data:Buffer.from(zipSync({'Metadata/plate_1.gcode':strToU8(gcode)})).toString('base64')},false]] as const){
      const service=await SlicingService.open({adapter:fakeAdapter(async()=>({...result(),gcode:native,toolpathHash:hash(native),slicerProject:artifact,projectHash:artifact?.hash,previewSupported:true}))});
      try{const job=await service.createJob(request,name);expect((await finished(service,job.id)).status).toBe(succeeds?'succeeded':'failed');}finally{await service.shutdown();}
    }
  });
  it('cancels active work idempotently and never exposes a late result', async () => {
    let finish!: (value: SliceResult) => void;
    const service = await SlicingService.open({ adapter: fakeAdapter(() => new Promise(resolve => { finish = resolve; })) });
    const job = await service.createJob(request, 'cancel');
    await service.cancelJob(job.id); await service.cancelJob(job.id); finish(result());
    await new Promise(resolve => setTimeout(resolve, 10)); expect(service.getJob(job.id)?.status).toBe('cancelled'); expect(service.getJob(job.id)?.result).toBeUndefined();
  });
  it('preserves actionable failures and rejects unsupported or mismatched output', async () => {
    for (const [name, adapter, expected] of [
      ['failure', fakeAdapter(async () => { throw new Error('Profile nozzle mismatch.'); }), /nozzle mismatch/],
      ['bad-hash', fakeAdapter(async () => ({ ...result(), toolpathHash: 'f'.repeat(64) })), /hash mismatch/],
      ['unsupported-spline', fakeAdapter(async () => ({ ...result(), gcode: gcode + 'G5 X20 I5 E1\n' })), /unsupported motion/],
    ] as const) {
      const service = await SlicingService.open({ adapter }); const job = await service.createJob(request, name); const final = await finished(service, job.id);
      expect(final.status).toBe('failed'); expect(final.error).toMatch(expected); expect(final.result).toBeUndefined();
    }
  });
  it('serializes queued work and cancels owned active/queued jobs before shutdown',async()=>{
    let starts=0;const service=await SlicingService.open({adapter:fakeAdapter(context=>new Promise((_resolve,reject)=>{starts++;context.signal.addEventListener('abort',()=>reject(new Error('cancelled test subprocess')),{once:true});}))});
    const first=await service.createJob(request,'shutdown-first');const second=await service.createJob({...request,manifestHash:'d'.repeat(64)},'shutdown-second');
    expect(service.getJob(first.id)?.status).toBe('running');expect(service.getJob(second.id)?.status).toBe('queued');expect(starts).toBe(1);await service.shutdown();
    expect(service.getJob(first.id)?.status).toBe('cancelled');expect(service.getJob(second.id)?.status).toBe('cancelled');expect(starts).toBe(1);await expect(service.createJob(request,'after-shutdown')).rejects.toThrow(/shutting down/);
  });
  it('rejects an in-flight capability check that finishes after shutdown',async()=>{let release!:()=>void;const adapter=fakeAdapter();adapter.capability=()=>new Promise(resolve=>{release=()=>resolve({available:true,adapter:'TEST',version:'test',reason:'synthetic',limitations:[]});});const service=await SlicingService.open({adapter});const creating=service.createJob(request,'shutdown-during-probe');const asserted=expect(creating).rejects.toThrow(/shutting down/);await service.shutdown();release();await asserted;expect(service.listJobs()).toHaveLength(0);});
  it('saves/reopens finished jobs without rerunning duplicate actions', async () => {
    const path = join(await temp(), 'state.json');
    const service = await SlicingService.open({ adapter: fakeAdapter(), statePath: path });
    const job = await service.createJob(request, 'persist'); await finished(service, job.id);
    // A clean lifecycle boundary drains the final atomic write before a new process reopens it.
    await service.shutdown();
    const reopened = await SlicingService.open({ adapter: fakeAdapter(), statePath: path });
    expect(reopened.getJob(job.id)?.status).toBe('succeeded'); expect((await reopened.createJob(request, 'persist')).id).toBe(job.id);
  });
  it('marks queued/running persisted work interrupted on startup', async () => {
    const path = join(await temp(), 'state.json'); const now = new Date().toISOString();
    await writeFile(path, JSON.stringify({ schemaVersion: 1, jobs: [{ id: 'interrupted', manifestHash: request.manifestHash, idempotencyKey: 'old', requestHash: 'd'.repeat(64), status: 'running', progress: 35, logs: [], createdAt: now, updatedAt: now }] }));
    const service = await SlicingService.open({ statePath: path });
    expect(service.getJob('interrupted')).toMatchObject({ status: 'interrupted', error: expect.stringMatching(/stopped/) });
    expect(JSON.parse(await readFile(path, 'utf8')).jobs[0].status).toBe('interrupted');
  });
});
describe('version-pinned Bambu CLI boundary (injected runner, no real Bambu execution)', () => {
  async function setup(runner: CommandRunner) {
    const dir = await temp(); const executable = join(dir, 'bambu-test'); await writeFile(executable, 'injected executable placeholder'); await chmod(executable, 0o700);
    const profile = async (name: string) => { const path = join(dir, name + '.json'); const text = JSON.stringify(name==='machine'?syntheticMachine:name==='filament'?syntheticFilament:syntheticProcess); await writeFile(path, text); return { path, sha256: hash(text) }; };
    const config: BambuCliConfig = { executable, executableSha256: hash('injected executable placeholder'), version: BAMBU_TARGET_VERSION, machine: await profile('machine'), filament: await profile('filament'), process: await profile('process'), completeProfilesReviewed: true as const, workRoot: dir };
    const adapter = new BambuStudioCliAdapter(config, runner); const input = join(dir, 'prepared.stl'); await writeFile(input, 'prepared geometry test bytes');
    return { dir, config, adapter, input, sliceRequest: { ...request, profileBundleHash: adapter.profileBundleHash(), preparedInputPath: input, preparedInputSha256: hash('prepared geometry test bytes'), outputDirectory: join(dir, 'out') } };
  }
  const help = '--load-settings --load-filaments --slice --export-3mf';
  it('builds documented arguments without shell, orienting, arranging or updating profiles', async () => {
    let recorded: string[] = [];
    const { adapter, sliceRequest } = await setup(async (_exe, args) => {
      if (args[0] === '--help') return { code: 0, output: help };
      recorded = args; const output = args[args.indexOf('--export-3mf') + 1]; await writeFile(output, zipSync({ 'Metadata/plate_1.gcode': strToU8(gcode) })); return { code: 0, output: 'Injected test result.' };
    });
    expect((await adapter.capability()).available).toBe(true);
    const output = await adapter.slice(sliceRequest, { signal: new AbortController().signal, log: () => {}, progress: () => {} });
    expect(output.gcode).toBe(gcode); expect(output.toolpathHash).toBe(hash(gcode)); expect(recorded).toContain('--load-filaments');
    expect(recorded.slice(recorded.indexOf('--arrange'), recorded.indexOf('--arrange') + 2)).toEqual(['--arrange', '0']);
    expect(recorded).not.toContain('--orient'); expect(recorded).not.toContain('--uptodate'); expect(recorded).not.toContain('--scale');
  });
  it('detects changed executable, profiles, incompatible runtime and profile binding', async () => {
    const { adapter, config, sliceRequest } = await setup(async () => ({ code: 0, output: help }));
    await expect(adapter.slice({ ...sliceRequest, profileBundleHash: 'f'.repeat(64) }, { signal: new AbortController().signal, log: () => {}, progress: () => {} })).rejects.toThrow(/profile bundle/);
    await writeFile(config.machine.path, '{}'); expect((await adapter.capability()).reason).toMatch(/changed after review/);
    await writeFile(config.executable, 'changed'); expect((await adapter.capability()).reason).toMatch(/executable hash/);
    const other = await setup(async () => ({ code: 1, output: 'display unavailable' })); expect((await other.adapter.capability()).available).toBe(false);
  });
  it('rejects arbitrary local paths and mutated prepared geometry', async () => {
    const { adapter, sliceRequest, input } = await setup(async () => ({ code: 0, output: help }));
    const context = { signal: new AbortController().signal, log: () => {}, progress: () => {} };
    await expect(adapter.slice({ ...sliceRequest, preparedInputPath: '/etc/passwd' }, context)).rejects.toThrow(/work root/);
    await writeFile(input, 'mutated'); await expect(adapter.slice(sliceRequest, context)).rejects.toThrow(/hash\/units mismatch/);
  });
});

describe('local process runner (Node test processes, not Bambu)', () => {
  it('captures bounded logs and nonzero exit statuses without a shell', async () => {
    const logs: string[] = [];
    const response = await runCommand(process.execPath, ['-e', "process.stdout.write('x'.repeat(110000));process.exitCode=3"], { onLog: line => logs.push(line) });
    expect(response.code).toBe(3); expect(response.output).toHaveLength(100_000); expect(logs.join('')).toHaveLength(110_000);
  });
  it('rejects pre-cancelled and actively cancelled processes', async () => {
    const cancelled = new AbortController(); cancelled.abort();
    await expect(runCommand(process.execPath, ['-e', 'process.exit(0)'], { signal: cancelled.signal })).rejects.toThrow(/cancelled/);
    const active = new AbortController();
    const response = runCommand(process.execPath, ['-e', "console.log('ready');setInterval(()=>{},1000)"], { signal: active.signal, terminationGraceMs: 30, onLog: () => active.abort() });
    await expect(response).rejects.toThrow(/cancelled/);
  });
  it('terminates a process which ignores SIGTERM when its time limit expires', async () => {
    await expect(runCommand(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], { timeoutMs: 100, terminationGraceMs: 30 })).rejects.toThrow(/runtime limit/);
  });
});
