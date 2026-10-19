import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { parseSTL } from '../src/adapters/geometry';
import {
  approveJob, attachToolpath, createJob, createProject, deserializeProject, exportJobPackage,
  invalidateChangedJobs, isApprovalCurrent, isToolpathCurrent, manufacturingManifest, releaseJob, reviewToolpath,
  revokeToolpathMapping, serializeProject, sha256, type Job, type Part, type Project,
} from '../src/domain';

const gcode = 'G21\nG90\nM83\nG0 X50 Y50 Z0.2\n;TYPE:Outer wall\nG1 X60 Y50 E1\nG1 X60 Y60 E1\n';
const checks = { machine: true, material: true, nozzle: true, plate: true, clearBed: true };
async function prepared(approved = true) {
  const part: Part = { id: 'pass-bracket', name: 'Local bracket', geometry: await parseSTL(readFileSync(new URL('../public/fixtures/bracket.stl', import.meta.url)), 'mm'),
    source: { kind: 'local', available: true }, quantity: 1, spareQuantity: 0, category: 'bracket', classification: 'make' };
  const project = createProject(); project.parts = [part]; project.jobs = [createJob([part])]; project.activeJobId = project.jobs[0].id;
  const job = project.jobs[0]; job.items[0].position = [60, 60, 0]; job.printer.tested = true; job.material.tested = true;
  await attachToolpath(project, job, gcode, { name: 'reviewed.gcode', source: 'imported', mappingConfirmed: true, slicer: { id: 'External slicer', version: '1.0.0' } });
  await reviewToolpath(project, job, 'Manufacturing lead');
  if (approved) await approveJob(project, job, 'Manufacturing lead');
  return { project, job };
}
/** Stop a real SHA-256 call deterministically to exercise edits while actions await WebCrypto. */
function pauseDigest(predicate: (text: string) => boolean = () => true) {
  const original = crypto.subtle.digest.bind(crypto.subtle);
  let resume!: () => void, reached!: () => void;
  const gate = new Promise<void>(resolve => { resume = resolve; });
  const started = new Promise<void>(resolve => { reached = resolve; });
  let paused = false;
  vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (algorithm, data) => {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (!paused && predicate(new TextDecoder().decode(bytes))) { paused = true; reached(); await gate; }
    return original(algorithm, data);
  });
  return { started, resume };
}
afterEach(() => vi.restoreAllMocks());

describe('approval and mapping regression pass', () => {
  it('revokes mapping explicitly, preserves evidence and history, and makes repeated revocation idempotent', async () => {
    const { project, job } = await prepared(); const artifact = structuredClone(job.toolpath!);
    revokeToolpathMapping(job, 'Manufacturing lead', 'External file was mapped to the wrong filament.');
    expect(job.toolpath).toMatchObject({ id: artifact.id, gcode: artifact.gcode, hash: artifact.hash, mappingConfirmed: false, stale: true });
    expect(job.toolpath?.reviewedAt).toBeUndefined(); expect(job.toolpath?.reviewedBy).toBeUndefined(); expect(job.toolpath?.reviewedManifestHash).toBeUndefined();
    expect(job.approval).toBeUndefined(); expect(job.status).toBe('ready to slice'); expect(job.reviews.some(e => e.action === 'approved')).toBe(true);
    const count = job.reviews.length; revokeToolpathMapping(job, 'Manufacturing lead', 'Duplicate action.'); expect(job.reviews).toHaveLength(count);
    expect(await isToolpathCurrent(project, job)).toBe(false);
    await expect(releaseJob(project, job, { actor: 'Operator', idempotencyKey: 'revoked', checks })).rejects.toThrow(/stale|missing/);
    const reopened = await deserializeProject(serializeProject(project)); expect(reopened.jobs[0].approval).toBeUndefined();
    expect(reopened.jobs[0].toolpath).toMatchObject({ hash: artifact.hash, mappingConfirmed: false, stale: true });
  });

  it('requires a new attachment and actual layer review after a corrected mapping', async () => {
    const { project, job } = await prepared(); const priorApproval = job.approval!.id;
    revokeToolpathMapping(job, 'Lead', 'Incorrect original material mapping.'); job.material.name = 'Reviewed PLA';
    await attachToolpath(project, job, gcode, { name: 'remapped.gcode', source: 'imported', mappingConfirmed: true, slicer: { id: 'Actual slicer', version: '2.0.0' } });
    expect(job.toolpath?.stale).toBeUndefined(); expect(job.toolpath?.reviewedAt).toBeUndefined();
    await expect(approveJob(project, job, 'Lead')).rejects.toThrow(/Review the actual/);
    await reviewToolpath(project, job, 'Lead'); await approveJob(project, job, 'Lead');
    expect(await isApprovalCurrent(project, job)).toBe(true); expect(job.approval!.id).not.toBe(priorApproval);
  });

  it.each([
    ['mapping revocation', (p: Project, j: Job) => { j.toolpath!.mappingConfirmed = false; }],
    ['recorded slicer mapping', (p: Project, j: Job) => { j.toolpath!.slicer.version = '2.0.0'; }],
    ['material colour', (p: Project, j: Job) => { j.material.color = '#ffffff'; }],
    ['material profile identity', (p: Project, j: Job) => { j.material.id = 'different-filament'; }],
    ['confirmed use case', (p: Project, j: Job) => { j.useCase.confirmed = true; j.useCase.constraints = 'Mounting face must remain flat'; }],
    ['build volume', (p: Project, j: Job) => { j.printer.buildVolume[0] = 220; }],
    ['source bytes', (p: Project) => { p.parts[0].geometry.stl += '\n'; }],
    ['toolpath bytes', (p: Project, j: Job) => { j.toolpath!.gcode += '; different imported file\n'; }],
  ])('clears actionable approval immediately after changing %s', async (_label, mutate) => {
    const { project } = await prepared(); const after = structuredClone(project); const job = after.jobs[0]; mutate(after, job);
    expect(invalidateChangedJobs(project, after)).toEqual([job.id]); expect(job.approval).toBeUndefined(); expect(job.toolpath?.stale).toBe(true);
    expect(await isApprovalCurrent(after, job)).toBe(false);
  });

  it('invalidates every job using an original whose explicit units change', async () => {
    const { project, job } = await prepared(); const second = structuredClone(job); second.id = 'second-job'; project.jobs.push(second);
    const after = structuredClone(project); after.parts[0].geometry.original!.units = 'in';
    expect(invalidateChangedJobs(project, after)).toHaveLength(2); expect(after.jobs.every(j => !j.approval && j.toolpath?.stale)).toBe(true);
    await expect(deserializeProject(serializeProject(after))).rejects.toThrow(/original|inch|dimension|checksum/i);
  });

  it('rejects duplicate source occurrence paths introduced by a portable project before approval', async () => {
    const { project } = await prepared(false);
    const transform = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    project.parts[0].source.occurrences = [
      { path: ['module', 'bracket'], transform: [...transform] },
      { path: ['module', 'bracket'], transform: [...transform] },
    ];
    const reopened = await deserializeProject(serializeProject(project));
    await expect(approveJob(reopened, reopened.jobs[0], 'Manufacturing lead')).rejects.toThrow(/duplicate source occurrence paths/i);
    expect(reopened.jobs[0].approval).toBeUndefined(); expect(reopened.jobs[0].releases).toHaveLength(0);
  });

  it('preserves repeated names at distinct nested paths and explicit required/spare quantities', async () => {
    const { project, job } = await prepared(false);
    const transform = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    project.parts[0].source = { kind: 'fixture', documentId: 'robot', elementId: 'assembly', versionId: 'v17', configuration: 'intake=competition', occurrences:
      [['left-module', 'bracket'], ['right-module', 'bracket'], ['left-module', 'nested', 'bracket']].map(path => ({ path, transform: [...transform] })) };
    project.parts[0].quantity = 3; job.items[0].quantity = 3; job.items[0].spareQuantity = 2;
    await attachToolpath(project, job, gcode, { name: 'nested.gcode', source: 'imported', mappingConfirmed: true, slicer: { id: 'External slicer', version: '1.0.0' } });
    await reviewToolpath(project, job, 'Manufacturing lead'); await approveJob(project, job, 'Manufacturing lead');
    expect(await isApprovalCurrent(project, job)).toBe(true);
    const manifest = manufacturingManifest(project, job);
    expect(manifest.parts[0]).toMatchObject({ quantity: 3, spareQuantity: 2, totalQuantity: 5, source: { configuration: 'intake=competition' } });
    expect(manifest.parts[0].source.occurrences).toHaveLength(3); expect(manifest.parts[0].instances).toHaveLength(5);
  });

  it('preserves the last valid job when a new import fails', async () => {
    const { project, job } = await prepared(); const previous = structuredClone(job);
    await expect(attachToolpath(project, job, 'G21\nG2 X10 Y10 I5 E1', { name: 'unsupported.gcode', source: 'imported', mappingConfirmed: true, slicer: { id: 'Different slicer', version: '2' } })).rejects.toThrow();
    expect(job).toEqual(previous); expect(await isApprovalCurrent(project, job)).toBe(true);
  });

  it('allows a reviewer to recover a malformed persisted review date with an explicit new review', async () => {
    const { project, job } = await prepared(false); job.toolpath!.reviewedAt = 'interrupted-review';
    const reopened = await deserializeProject(serializeProject(project)); const recovered = reopened.jobs[0];
    await expect(approveJob(reopened, recovered, 'Manufacturing lead')).rejects.toThrow(/Review the actual/);
    await reviewToolpath(reopened, recovered, 'Manufacturing lead'); await approveJob(reopened, recovered, 'Manufacturing lead');
    expect(Number.isFinite(Date.parse(recovered.toolpath!.reviewedAt!))).toBe(true); expect(await isApprovalCurrent(reopened, recovered)).toBe(true);
  });

  it('does not approve orientation changes made during asynchronous validation', async () => {
    const { project, job } = await prepared(false); const pause = pauseDigest(); const pending = approveJob(project, job, 'Lead');
    await pause.started; job.items[0].orientation[0] = 90; pause.resume();
    await expect(pending).rejects.toThrow(/changed during/); expect(job.approval).toBeUndefined();
    expect(job.reviews.filter(e => e.action === 'approved')).toHaveLength(0);
  });

  it('does not restore a review after mapping is revoked while reviewing', async () => {
    const { project, job } = await prepared(false); delete job.toolpath!.reviewedAt; delete job.toolpath!.reviewedBy; delete job.toolpath!.reviewedManifestHash;
    const pause = pauseDigest(); const pending = reviewToolpath(project, job, 'Lead'); await pause.started;
    revokeToolpathMapping(job, 'Other lead', 'Mapping correction required.'); pause.resume();
    await expect(pending).rejects.toThrow(/changed during/); expect(job.toolpath?.reviewedAt).toBeUndefined(); expect(job.toolpath?.mappingConfirmed).toBe(false);
  });

  it('does not attach a stale pending import or partially change its slicer identity', async () => {
    const { project, job } = await prepared(); const prior = structuredClone(job.toolpath); const slicer = structuredClone(job.slicer);
    const pause = pauseDigest(); const pending = attachToolpath(project, job, gcode, { name: 'pending.gcode', source: 'imported', mappingConfirmed: true, slicer: { id: 'Different slicer', version: '3' } });
    await pause.started; job.settings.walls++; pause.resume(); await expect(pending).rejects.toThrow(/changed during/);
    expect(job.toolpath).toEqual(prior); expect(job.slicer).toEqual(slicer); expect(await isApprovalCurrent(project, job)).toBe(false);
  });

  it('returns false if G-code bytes change during an approval-current query', async () => {
    const { project, job } = await prepared(); const pause = pauseDigest(); const pending = isApprovalCurrent(project, job);
    await pause.started; job.toolpath!.gcode += '; changed during validation\n'; pause.resume(); expect(await pending).toBe(false);
  });

  it('does not release a job whose quantity changes during validation', async () => {
    const { project, job } = await prepared(); const pause = pauseDigest(); const pending = releaseJob(project, job, { actor: 'Operator', idempotencyKey: 'pending-release', checks });
    await pause.started; job.items[0].spareQuantity = 1; pause.resume(); await expect(pending).rejects.toThrow(/changed during/); expect(job.releases).toHaveLength(0);
  });

  it('refuses an export if a mapping changes while package checksums are being computed', async () => {
    const { project, job } = await prepared(); const pause = pauseDigest(text => text.startsWith('{\n  "schemaVersion": 1'));
    const pending = exportJobPackage(project, job, { actor: 'Operator', idempotencyKey: 'interrupted-package', checks });
    await pause.started; revokeToolpathMapping(job, 'Lead', 'Revoked during export.'); pause.resume();
    await expect(pending).rejects.toThrow(/changed during/); expect(job.approval).toBeUndefined();
    expect(job.releases).toHaveLength(0); expect(job.reviews.some(review=>review.action==='package exported')).toBe(false);
  });

  it('coalesces concurrent layer reviews and exports, then reopens the exact packaged project', async () => {
    const { project, job } = await prepared(); const count = job.reviews.filter(e => e.action === 'toolpath reviewed').length;
    await Promise.all([reviewToolpath(project, job, 'Lead'), reviewToolpath(project, job, 'Lead')]);
    expect(job.reviews.filter(e => e.action === 'toolpath reviewed')).toHaveLength(count + 1); expect(job.approval).toBeUndefined(); expect(job.status).toBe('sliced'); await approveJob(project, job, 'Lead');
    const options = { actor: 'Operator', idempotencyKey: 'duplicate-export', checks };
    const [a, b] = await Promise.all([exportJobPackage(project, job, options), exportJobPackage(project, job, options)]);
    expect(a).toEqual(b); expect(job.releases).toHaveLength(1);
    const files = unzipSync(a); const hashes = JSON.parse(strFromU8(files['checksums.sha256.json'])) as Record<string, string>;
    for (const [name, hash] of Object.entries(hashes)) expect(await sha256(files[name])).toBe(hash);
    const reopened = await deserializeProject(strFromU8(files['project.catalyst.json'])); expect(await isApprovalCurrent(reopened, reopened.jobs[0])).toBe(true);
    expect(reopened.jobs[0].releases).toHaveLength(1);
  });
});
