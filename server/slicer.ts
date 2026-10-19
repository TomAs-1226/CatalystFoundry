import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { unzipSync, strFromU8 } from 'fflate';
import { parseGcode } from '../src/adapters/toolpaths';
import { assertNativeArtifact } from '../src/adapters/native-artifact';
import { isPathInside, readPinnedProfile, SETTINGS_MAPPING_VERSION } from './slicing-config';
import { verifyRuntime } from './bundled-slicer';
import {GEOMETRY_PREPARATION_VERSION} from '../src/domain/preparation-version';

export const BAMBU_TARGET_VERSION = '2.8.2.61';
export interface SlicerCapability { available: boolean; adapter: string; version: string | null; reason: string; limitations: string[]; profileBundleHash?: string }
export interface SliceRequest {
  manifestHash: string;
  /** Hash of exact executable/version and resolved machine, filament, process profiles in the manufacturing manifest. */
  profileBundleHash: string;
  /** Local prepared geometry: quantity, placement, orientation and mm units already applied. Never an arbitrary remote URL. */
  preparedInputPath: string;
  preparedInputSha256: string;
  preparedInMillimeters: true;
  outputDirectory: string;
  processSettings?: import('../src/domain/model').ProcessSettings;
  materialColor?:string;
}
export interface SliceResult { gcode: string; toolpathHash: string; slicerVersion: string; preparationVersion?:string; nozzleOffset?:[number,number]; projectPath?: string; projectHash?: string; slicerProject?: {name:string;data:string;hash:string;encoding:'base64';format:'3mf'}; previewSupported?:boolean; previewIssues?:string[]; demonstration: false }
export interface SliceContext { signal: AbortSignal; log(message: string): void; progress(value: number): void }
export interface SlicerAdapter { capability(): Promise<SlicerCapability>; slice(request: SliceRequest, context: SliceContext): Promise<SliceResult> }
export type SliceJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
export interface SliceJob {
  id: string; manifestHash: string; idempotencyKey: string; requestHash: string; status: SliceJobStatus;
  progress: number; logs: string[]; createdAt: string; updatedAt: string; error?: string; result?: SliceResult;
}
export type SliceJobSummary=Omit<SliceJob,'result'>&{result?:Omit<SliceResult,'gcode'|'slicerProject'>};
const digest = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
const validHash = (value: string) => /^[a-f0-9]{64}$/.test(value);
export class UnavailableSlicerAdapter implements SlicerAdapter {
  async capability(): Promise<SlicerCapability> { return { available: false, adapter: 'Bambu Studio CLI', version: null, reason: 'No verified Bambu Studio executable or complete tested machine, filament and process profiles are configured. Import G-code for review or use operator-controlled export.', limitations: ['No real slicer is configured for this running service.', 'Exact printer model and nozzle are pending.', 'Bambu Connect dispatch is unavailable; no printer connection is configured.'] }; }
  async slice(): Promise<SliceResult> { throw new Error((await this.capability()).reason); }
}
/** Persisted worker boundary, independent of React and CAD import. Never sends commands to a printer. */
export class SlicingService {
  private jobs = new Map<string, SliceJob>();
  private controllers = new Map<string, AbortController>();
  private writes: Promise<void> = Promise.resolve();
  private running = new Set<Promise<void>>();
  private stopped = false;
  private work:Promise<void>=Promise.resolve();
  private constructor(private adapter: SlicerAdapter, private statePath?: string) {}
  static async open(options: { adapter?: SlicerAdapter; statePath?: string } = {}) {
    const service = new SlicingService(options.adapter ?? new UnavailableSlicerAdapter(), options.statePath);
    if (options.statePath) {
      try {
        const saved = JSON.parse(await readFile(options.statePath, 'utf8')) as { schemaVersion: number; jobs: SliceJob[] };
        if (saved.schemaVersion !== 1 || !Array.isArray(saved.jobs)) throw new Error('Unsupported slicing state schema.');
        for (const job of saved.jobs) {
          if (!job.id || !job.idempotencyKey || !validHash(job.manifestHash)) throw new Error('Invalid persisted slicing job.');
          if (job.status === 'queued' || job.status === 'running') {
            job.status = 'interrupted'; job.error = 'The slicing service stopped before completion. Explicitly create a new attempt.';
            job.logs.push(job.error); job.updatedAt = new Date().toISOString(); delete job.result;
          }
          service.jobs.set(job.id, job);
        }
        await service.persist();
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    return service;
  }
  getCapability() { return this.adapter.capability(); }
  getJob(id: string): SliceJob | undefined { const job = this.jobs.get(id); return job ? structuredClone(job) : undefined; }
  listJobs(): SliceJob[] { return [...this.jobs.values()].map(job => structuredClone(job)); }
  listJobSummaries(manifestHash?:string):SliceJobSummary[]{return [...this.jobs.values()].filter(job=>!manifestHash||job.manifestHash===manifestHash).map(job=>{const {result,...metadata}=job;const summary=result?(({gcode:_gcode,slicerProject:_project,...rest})=>rest)(result):undefined;return structuredClone({...metadata,...(summary?{result:summary}:{})});});}
  async shutdown(): Promise<void> { this.stopped=true;await Promise.all([...this.controllers.keys()].map(id=>this.cancelJob(id)));await Promise.all([...this.running]);await this.writes; }
  async createJob(request: SliceRequest, idempotencyKey: string): Promise<SliceJob> {
    if(this.stopped)throw new Error('Slicing service is shutting down; start a fresh attempt after restart.');
    request=structuredClone(request);
    if (!validHash(request.manifestHash) || !validHash(request.preparedInputSha256) || !validHash(request.profileBundleHash) || request.preparedInMillimeters !== true) throw new Error('A complete manifest hash, prepared geometry hash and explicit mm units are required.');
    if (!idempotencyKey?.trim() || idempotencyKey.length > 160) throw new Error('Provide a bounded idempotency key for this slicing action.');
    const requestHash = digest(JSON.stringify(request));
    const existing = [...this.jobs.values()].find(job => job.idempotencyKey === idempotencyKey);
    if (existing) {
      if (existing.requestHash !== requestHash) throw new Error('This action key already belongs to a different manufacturing request.');
      return structuredClone(existing);
    }
    const capability = await this.adapter.capability();
    if (!capability.available) throw new Error(capability.reason);
    if(this.stopped)throw new Error('Slicing service is shutting down; start a fresh attempt after restart.');
    // Recheck after capability's asynchronous work to serialize duplicate actions.
    const concurrent = [...this.jobs.values()].find(job => job.idempotencyKey === idempotencyKey);
    if (concurrent) {
      if (concurrent.requestHash !== requestHash) throw new Error('This action key already belongs to a different manufacturing request.');
      return structuredClone(concurrent);
    }
    const now = new Date().toISOString();
    const job: SliceJob = { id: randomUUID(), manifestHash: request.manifestHash, idempotencyKey, requestHash, status: 'queued', progress: 0, logs: ['Queued for the configured slicer worker.'], createdAt: now, updatedAt: now };
    this.jobs.set(job.id, job); this.controllers.set(job.id, new AbortController());
    await this.persist();
    const operation=this.work.then(()=>this.run(job.id,request));this.work=operation.catch(()=>{});this.running.add(operation);void operation.then(()=>this.running.delete(operation),()=>this.running.delete(operation));
    return structuredClone(job);
  }
  async cancelJob(id: string): Promise<SliceJob> {
    const job = this.jobs.get(id); if (!job) throw new Error('Slicing job not found.');
    if (['queued', 'running'].includes(job.status)) {
      job.status = 'cancelled'; job.updatedAt = new Date().toISOString(); job.logs.push('Cancelled by the user; no result can be approved.'); delete job.result;
      this.controllers.get(id)?.abort(); await this.persist();
    }
    return structuredClone(job);
  }
  private async run(id: string, request: SliceRequest) {
    const job = this.jobs.get(id)!; const controller = this.controllers.get(id)!;
    if (job.status === 'cancelled') { this.controllers.delete(id); return; }
    job.status = 'running'; job.updatedAt = new Date().toISOString();
    try {
      await this.persist();
      const result = await this.adapter.slice(request, {
        signal: controller.signal,
        log: message => { if (!controller.signal.aborted) { job.logs.push(message.slice(0, 2000)); job.logs = job.logs.slice(-300); } },
        progress: value => { if (!controller.signal.aborted && Number.isFinite(value)) job.progress = Math.min(99, Math.max(0, value)); },
      });
      if (!controller.signal.aborted) {
        if(result.slicerProject){
          if(digest(Buffer.from(result.slicerProject.data,'base64'))!==result.slicerProject.hash||result.projectHash!==result.slicerProject.hash)throw new Error('Native slicer project hash mismatch.');
          assertNativeArtifact(result.gcode,result.slicerProject);
        }
        let preview:ReturnType<typeof parseGcode>|undefined;
        try{preview=parseGcode(result.gcode,{nativeBambu:!!result.slicerProject});}catch(error){if(result.previewSupported!==false)throw error;}
        if (preview?.isDemonstration) throw new Error('Slicer output is marked as demonstration; it cannot be represented as real slicing.');
        if (!preview?.canApprove && result.previewSupported!==false) throw new Error('Slicer output uses unsupported motion; review in the target slicer before release.');
        if (digest(result.gcode) !== result.toolpathHash) throw new Error('Slicer result hash mismatch.');
        job.result = result; job.status = 'succeeded'; job.progress = 100; job.logs.push(result.previewSupported===false?'Slicing finished; this application cannot fully review the machine-specific output. Download the native project for target-slicer review. Approval remains blocked.':'Slicing finished. Exact output awaits human review.');
      }
    } catch (error) {
      if (!controller.signal.aborted) { job.status = 'failed'; job.error = error instanceof Error ? error.message : 'Slicing failed.'; job.logs.push(job.error); delete job.result; }
    } finally { job.updatedAt = new Date().toISOString(); this.controllers.delete(id); await this.persist(); }
  }
  private persist(): Promise<void> {
    if (!this.statePath) return Promise.resolve();
    const path = this.statePath; const snapshot = JSON.stringify({ schemaVersion: 1, jobs: [...this.jobs.values()] });
    this.writes = this.writes.then(async () => { await mkdir(dirname(path), { recursive: true }); const temp = path + '.tmp'; await writeFile(temp, snapshot, 'utf8'); await rename(temp, path); });
    return this.writes;
  }
}
export interface PinnedProfileFile { path: string; sha256: string }
export interface BambuCliConfig {
  executable: string; executableSha256: string; version: typeof BAMBU_TARGET_VERSION;
  machine: PinnedProfileFile; filament: PinnedProfileFile; process: PinnedProfileFile;
  /** Operator-reviewed full configs exported by this exact Bambu release, not inherited fragments. */
  completeProfilesReviewed: true;
  workRoot: string;
  bedType?: string;
  runtime?: { directory:string; sha256:string };
}
export type CommandRunner = (executable: string, args: string[], options: { signal?: AbortSignal; cwd?: string; onLog?: (line: string) => void; timeoutMs?: number; terminationGraceMs?: number }) => Promise<{ code: number; output: string }>;
export const runCommand: CommandRunner = (executable, args, options) => new Promise((resolveResult, reject) => {
  if (options.signal?.aborted) { reject(new Error('Slicing cancelled.')); return; }
  const child = spawn(executable, args, { cwd: options.cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; let settled = false; let timedOut = false;
  let forceKill: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    child.kill('SIGTERM');
    if (!forceKill) forceKill = setTimeout(() => child.kill('SIGKILL'), Math.min(options.terminationGraceMs ?? 2000, 2000));
  };
  const timeout = setTimeout(() => { timedOut = true; stop(); }, Math.min(options.timeoutMs ?? 10 * 60_000, 10 * 60_000));
  const onAbort = () => stop();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const append = (chunk: Buffer) => { const message = chunk.toString(); output = (output + message).slice(-100_000); options.onLog?.(message); };
  child.stdout.on('data', append); child.stderr.on('data', append);
  const cleanup = () => { clearTimeout(timeout); if (forceKill) clearTimeout(forceKill); options.signal?.removeEventListener('abort', onAbort); };
  child.on('error', error => { if (!settled) { settled = true; cleanup(); reject(error); } });
  child.on('close', code => {
    if (settled) return;
    settled = true; cleanup();
    if (timedOut) reject(new Error('Slicer exceeded its runtime limit.'));
    else if (options.signal?.aborted) reject(new Error('Slicing cancelled.'));
    else resolveResult({ code: code ?? -1, output });
  });
});
/** Preparation only: not wired to the public HTTP request surface until a reviewed profile bundle is installed. */
export class BambuStudioCliAdapter implements SlicerAdapter {
  profileBundleHash(): string { return digest(JSON.stringify({ version: this.config.version, preparationVersion:GEOMETRY_PREPARATION_VERSION, settingsMapping:SETTINGS_MAPPING_VERSION, bedType:this.config.bedType, executableSha256: this.config.executableSha256, runtimeSha256:this.config.runtime?.sha256, machineSha256: this.config.machine.sha256, filamentSha256: this.config.filament.sha256, processSha256: this.config.process.sha256 })); }
  constructor(private config: BambuCliConfig, private runner: CommandRunner = runCommand) {}
  private async verifyFiles() {
    const config = this.config;
    if (config.version !== BAMBU_TARGET_VERSION || config.completeProfilesReviewed !== true) throw new Error(`Install and review full profiles for Bambu Studio ${BAMBU_TARGET_VERSION}.`);
    if (!isAbsolute(config.executable) || !validHash(config.executableSha256)) throw new Error('The Bambu executable must have an absolute path and pinned SHA-256.');
    await access(config.executable, constants.X_OK);
    if (digest(await readFile(config.executable)) !== config.executableSha256) throw new Error('Bambu executable hash does not match the pinned release.');
    for (const [kind,file] of Object.entries({machine:config.machine,filament:config.filament,process:config.process})) await readPinnedProfile(file,kind as 'machine'|'filament'|'process');
  }
  async capability(): Promise<SlicerCapability> {
    try {
      await this.verifyFiles();
      const result = await this.runner(this.config.executable, ['--help'], {});
      // Upstream's Windows GUI wrapper reopens stdout/stderr on CONOUT$ rather
      // than inherited pipes (BambuStudio_app_msvc.cpp). Empty pipe output is
      // accepted ONLY for the fully hash-verified official bundled runtime.
      const windowsBundledProbe = process.platform === 'win32' && !!this.config.runtime && result.code === 0 && !result.output.trim();
      if (windowsBundledProbe) await verifyRuntime(this.config.runtime!.directory,this.config.runtime!.sha256);
      if (result.code !== 0 || (!windowsBundledProbe && !['--load-settings', '--load-filaments', '--slice', '--export-3mf'].every(flag => result.output.includes(flag)))) throw new Error('The pinned executable cannot run its documented CLI in this environment.');
      return { available: true, adapter: 'Bambu Studio CLI', version: this.config.version, profileBundleHash: this.profileBundleHash(), reason: 'Pinned executable and reviewed complete profile files are configured.', limitations: ['Physical printer/material qualification remains an operator responsibility.', 'Only supported linear G-code output can be approved in this preview.', 'No direct machine dispatch.'] };
    } catch (error) { return { available: false, adapter: 'Bambu Studio CLI', version: this.config.version, reason: error instanceof Error ? error.message : 'Bambu CLI is unavailable.', limitations: ['No toolpaths have been generated.'] }; }
  }
  async slice(request: SliceRequest, context: SliceContext): Promise<SliceResult> {
    await this.verifyFiles();
    if (request.profileBundleHash !== this.profileBundleHash()) throw new Error('Exact slicer profile bundle does not match the manufacturing manifest.');
    if (this.config.runtime) await verifyRuntime(this.config.runtime.directory,this.config.runtime.sha256);
    const root = await realpath(resolve(this.config.workRoot));
    const withinRoot = (path: string, allowRoot = false) => { const resolved = resolve(path); if (!isPathInside(root,resolved,allowRoot)) throw new Error('Slicer input/output must remain inside the configured work root.'); return resolved; };
    const input = withinRoot(await realpath(withinRoot(request.preparedInputPath)));
    const outputDir = withinRoot(request.outputDirectory);
    // Reject symlink escapes before creating an output directory through an existing ancestor.
    let ancestor = outputDir;
    for (;;) {
      try { withinRoot(await realpath(ancestor), true); break; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; ancestor = dirname(ancestor); }
    }
    if (!/\.(?:stl|3mf)$/i.test(input)) throw new Error('This adapter accepts prepared STL or 3MF geometry only.');
    if (request.preparedInMillimeters !== true || digest(await readFile(input)) !== request.preparedInputSha256) throw new Error('Prepared geometry hash/units mismatch.');
    if ((await stat(input)).size > 50 * 1024 * 1024) throw new Error('Prepared geometry exceeds the 50 MiB slicing limit.');
    await mkdir(outputDir, { recursive: true }); withinRoot(await realpath(outputDir)); const output = join(outputDir, `sliced-${randomUUID()}.3mf`);
    const snapshots=Object.fromEntries(await Promise.all(Object.entries({machine:this.config.machine,process:this.config.process,filament:this.config.filament}).map(async([kind,file])=>{const bytes=await readFile(file.path);if(digest(bytes)!==file.sha256)throw new Error(`The ${kind} profile changed while preparing the slicer. Retry after review.`);const path=join(outputDir,`${kind}-${randomUUID()}.json`);await writeFile(path,bytes,{mode:0o600,flag:'wx'});return[kind,path];})));
    context.progress(5); context.log(`Starting pinned Bambu Studio ${this.config.version}. Foundry's exact orientations and copy placements are baked into the input; native rearrangement is disabled.`);
    const result = await this.runner(this.config.executable, ['--load-settings', `${snapshots.machine};${snapshots.process}`, '--load-filaments', snapshots.filament, '--datadir',join(outputDir,'runtime-data'), ...(this.config.bedType?['--curr-bed-type',this.config.bedType]:[]), '--arrange', '0', '--slice', '0', '--export-3mf', output, input], { signal: context.signal, cwd: root, onLog: context.log });
    if (context.signal.aborted) throw new Error('Slicing cancelled.');
    if (result.code !== 0) throw new Error(/path conflicts|slicing result conflict/i.test(result.output)?'Support or brim paths overlap between copies. Use Auto prepare with supports enabled, increase copy spacing, or split this plate. The conflicting output was rejected.':`Bambu Studio exited with code ${result.code}. Inspect the slicer log and verify complete compatible profiles.`);
    context.progress(90);
    const bytes = await readFile(output); if (bytes.byteLength > 50 * 1024 * 1024) throw new Error('Slicer project exceeds the 50 MiB output limit.');
    let plateCount=0,oversizedPlate=false;
    const archive = unzipSync(bytes, { filter: file => {if(!/(?:^|\/)plate_\d+\.gcode$/i.test(file.name))return false;plateCount++;if(file.originalSize>10*1024*1024){oversizedPlate=true;return false;}return true;} });
    const paths = Object.keys(archive);
    if (plateCount!==1 || oversizedPlate || paths.length !== 1) throw new Error('Expected exactly one bounded G-code plate in the sliced 3MF. Multiple plates require separate manufacturing jobs.');
    const gcode = strFromU8(archive[paths[0]]);let previewSupported=false;let previewIssues:string[]=[];
    try{const preview=parseGcode(gcode,{nativeBambu:true});previewSupported=preview.canApprove;previewIssues=preview.blockingIssues;}catch(error){previewIssues=[(error as Error).message];}
    if (!previewSupported) context.log(`Native target-slicer review required: ${previewIssues.join('; ')}`);
    const machine=await readPinnedProfile(this.config.machine,'machine'),rawOffset=Array.isArray(machine.extruder_offset)?machine.extruder_offset[0]:undefined;
    const offset=typeof rawOffset==='string'?rawOffset.split('x').map(Number):[];
    const nozzleOffset=offset.length===2&&offset.every(n=>Number.isFinite(n)&&Math.abs(n)<=50)?offset as [number,number]:undefined;
    return { gcode, toolpathHash: digest(gcode), slicerVersion: this.config.version, preparationVersion:GEOMETRY_PREPARATION_VERSION, nozzleOffset, projectPath: output, projectHash: digest(bytes), slicerProject:{name:'sliced.3mf',data:Buffer.from(bytes).toString('base64'),hash:digest(bytes),encoding:'base64',format:'3mf'},previewSupported,previewIssues, demonstration: false };
  }
}
