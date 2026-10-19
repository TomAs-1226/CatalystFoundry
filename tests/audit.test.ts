import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSTL } from '../src/adapters/geometry';
import {
  approveJob, assignJob, attachToolpath, createJob, createProject, deserializeProject,
  invalidateJob, isApprovalCurrent, operatorTransition, releaseJob, reviewToolpath, serializeProject,
} from '../src/domain';
import type { Job, Part } from '../src/domain';

const gcode = 'G21\nG90\nM83\nG0 X50 Y50 Z0.2\n;TYPE:Outer wall\nG1 X60 Y50 E1\nG1 X60 Y60 E1\n';
async function reviewedProject() {
  const part: Part = {
    id: 'audit-bracket', name: 'Reviewed local bracket',
    geometry: await parseSTL(readFileSync(new URL('../public/fixtures/bracket.stl', import.meta.url)), 'mm'),
    source: { kind: 'local', available: true }, quantity: 1, spareQuantity: 0,
    category: 'bracket', classification: 'make',
  };
  const project = createProject();
  project.parts = [part]; project.jobs = [createJob([part])]; project.activeJobId = project.jobs[0].id;
  const job = project.jobs[0]; job.items[0].position = [60, 60, 0];
  job.printer.tested = true; job.material.tested = true;
  await attachToolpath(project, job, gcode, { name: 'reviewed.gcode', source: 'imported', mappingConfirmed: true, slicer: { id: 'external', version: '1' } });
  await reviewToolpath(project, job, 'Audit operator'); await approveJob(project, job, 'Audit operator');
  return { project, job };
}

describe('manufacturing attestation integrity audit', () => {
  it.each([
    ['mapping confirmation', (j: Job) => { j.toolpath!.mappingConfirmed = false; }],
    ['layer reviewer', (j: Job) => { delete j.toolpath!.reviewedBy; }],
    ['layer review date', (j: Job) => { delete j.toolpath!.reviewedAt; }],
    ['recorded slicer version', (j: Job) => { j.toolpath!.slicer.version = 'different-slicer-version'; }],
    ['demonstration provenance', (j: Job) => { j.toolpath!.source = 'fixture'; }],
    ['demonstration approval flag', (j: Job) => { j.approval!.demonstrationOnly = true; }],
  ])('requires a new review after loss of %s', async (_label, mutate) => {
    const { project, job } = await reviewedProject();
    expect(await isApprovalCurrent(project, job)).toBe(true);
    mutate(job);
    expect(await isApprovalCurrent(project, job)).toBe(false);
    await expect(releaseJob(project, job, {
      actor: 'Audit operator', idempotencyKey: 'invalid-attestation',
      checks: { machine: true, material: true, nozzle: true, plate: true, clearBed: true },
    })).rejects.toThrow(/stale|missing|review|attest/i);
  });

  it('recovers an imported project with a revoked toolpath mapping without an actionable approval', async () => {
    const { project, job } = await reviewedProject();
    job.toolpath!.mappingConfirmed = false;
    const reopened = await deserializeProject(await serializeProject(project));
    expect(reopened.jobs[0].approval).toBeUndefined();
    expect(await isApprovalCurrent(reopened, reopened.jobs[0])).toBe(false);
  });

  it.each([
    ['invalid original bytes', (part: Part) => { part.geometry.original!.data = '!!! invalid base64 !!!'; }],
    ['a different valid original mesh', (part: Part) => {
      part.geometry.original!.data = readFileSync(new URL('../public/fixtures/spacer.stl', import.meta.url)).toString('base64');
    }],
    ['different source vertices within identical overall dimensions', (part: Part) => {
      part.geometry.original!.encoding = 'text';
      part.geometry.original!.data = part.geometry.stl.replace(/vertex ([\d.]+)/, (_match, x: string) => `vertex ${Number(x) + 0.01}`);
    }],
    ['incorrect original units', (part: Part) => { part.geometry.original!.units = 'in'; }],
  ])('rejects an imported project containing %s', async (_label, mutate) => {
    const { project } = await reviewedProject(); mutate(project.parts[0]);
    const error = await deserializeProject(JSON.stringify(project)).then(() => undefined, (e: Error) => e.message);
    expect(error).toMatch(/original|source|preserv|checksum|geometry|STL|parse|dimension/i);
  });

  it.each(['printing', 'completed'] as const)('does not recover an unsupported physical %s claim from a project file', async status => {
    const { project, job } = await reviewedProject(); job.status = status;
    const reopened = await deserializeProject(JSON.stringify(project));
    expect(['printing', 'completed']).not.toContain(reopened.jobs[0].status);
    expect(reopened.jobs[0].reviews.some(e => e.actor === 'Project recovery')).toBe(true);
  });

  it('does not treat a package release as an operator report that printing started', async () => {
    const { project, job } = await reviewedProject();
    await assignJob(project, job, 'Shop operator', 'Audit operator');
    await releaseJob(project, job, {
      actor: 'Audit operator', idempotencyKey: 'reviewed-export',
      checks: { machine: true, material: true, nozzle: true, plate: true, clearBed: true },
    });
    job.status = 'printing';
    const reopened = await deserializeProject(JSON.stringify(project));
    expect(['printing', 'completed']).not.toContain(reopened.jobs[0].status);
  });

  it('preserves a physical state with a complete, named operator transition history', async () => {
    const { project, job } = await reviewedProject();
    await assignJob(project, job, 'Shop operator', 'Audit operator');
    await releaseJob(project, job, {
      actor: 'Audit operator', idempotencyKey: 'reviewed-export',
      checks: { machine: true, material: true, nozzle: true, plate: true, clearBed: true },
    });
    await operatorTransition(project, job, 'printing', 'Shop operator');
    await operatorTransition(project, job, 'completed', 'Shop operator');
    const reopened = await deserializeProject(await serializeProject(project));
    expect(reopened.jobs[0].status).toBe('completed');
  });

  it('does not reuse operator reports from an older manufacturing manifest', async () => {
    const { project, job } = await reviewedProject();
    const checks = { machine: true, material: true, nozzle: true, plate: true, clearBed: true };
    await assignJob(project, job, 'Shop operator', 'Audit operator');
    await releaseJob(project, job, { actor: 'Audit operator', idempotencyKey: 'older-export', checks });
    await operatorTransition(project, job, 'printing', 'Shop operator');
    await operatorTransition(project, job, 'completed', 'Shop operator');
    job.settings.walls += 1; invalidateJob(job, 'New wall-count manufacturing manifest');
    await attachToolpath(project, job, gcode, { name: 'new-reviewed.gcode', source: 'imported', mappingConfirmed: true, slicer: { id: 'external', version: '1' } });
    await reviewToolpath(project, job, 'Audit operator'); await approveJob(project, job, 'Audit operator');
    await assignJob(project, job, 'Shop operator', 'Audit operator');
    await releaseJob(project, job, { actor: 'Audit operator', idempotencyKey: 'newer-export', checks });
    job.status = 'completed';
    const reopened = await deserializeProject(JSON.stringify(project));
    expect(['printing', 'completed']).not.toContain(reopened.jobs[0].status);
  });
});
