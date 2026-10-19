import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { parseSTL } from '../src/adapters/geometry';
import { prepare3mf } from '../server/slicing-http';
import {
  approveJob, attachToolpath, createJob, createProject, invalidateChangedJobs,
  isApprovalCurrent, isToolpathCurrent, reviewToolpath, sha256, type Job, type Part, type Project,
} from '../src/domain';

const gcode = 'G21\nG90\nM83\nG0 X50 Y50 Z0.2\n;TYPE:Outer wall\nG1 X60 Y50 E1\nG1 X60 Y60 E1\n';
async function approvedProject() {
  const part: Part = {
    id: 'requirements-part', name: 'Audit fixture bracket',
    geometry: await parseSTL(readFileSync(new URL('../public/fixtures/bracket.stl', import.meta.url)), 'mm'),
    source: { kind: 'fixture', documentId: 'doc', elementId: 'studio', partId: 'part', versionId: 'version',
      configuration: 'size=small', installedTransformUnits: 'm', occurrences: [
        { path: ['module', 'bracket'], transform: [1, 0, 0, 0.1, 0, 1, 0, 0.2, 0, 0, 1, 0, 0, 0, 0, 1] },
      ] },
    quantity: 1, spareQuantity: 0, category: 'bracket', classification: 'make',
  };
  const project = createProject(); project.parts = [part]; project.jobs = [createJob([part])];
  const job = project.jobs[0]; project.activeJobId = job.id; job.items[0].position = [60, 60, 0];
  // An explicitly synthetic archive tests artifact integrity; it is never executed or represented as Bambu output.
  const projectBytes = zipSync({ 'test-only.txt': strToU8('Synthetic audit artifact; not a slicer-generated project.') });
  const slicerProject = { name: 'test-only.3mf', data: btoa(String.fromCharCode(...projectBytes)),
    hash: await sha256(projectBytes), encoding: 'base64' as const, format: '3mf' as const };
  await attachToolpath(project, job, gcode, { name: 'actual-parser-input.gcode', source: 'imported',
    slicer: { id: 'Audit external slicer', version: '1.0.0', profileBundleHash: 'a'.repeat(64) }, slicerProject, mappingConfirmed: true });
  await reviewToolpath(project, job, 'Audit reviewer'); await approveJob(project, job, 'Audit reviewer');
  expect(await isApprovalCurrent(project, job)).toBe(true);
  return project;
}

type InputMutation = [string, (project: Project, job: Job, part: Part) => void];
const additionalInputs: InputMutation[] = [
  ['source document ID', (_p, _j, part) => { part.source.documentId = 'other-document'; }],
  ['source element ID', (_p, _j, part) => { part.source.elementId = 'other-studio'; }],
  ['source part ID', (_p, _j, part) => { part.source.partId = 'other-part'; }],
  ['source microversion ID', (_p, _j, part) => { part.source.microversionId = 'immutable-microversion'; }],
  ['linked document ID', (_p, _j, part) => { part.source.linkedDocumentId = 'linked-document'; }],
  ['origin document ID', (_p, _j, part) => { part.source.originDocumentId = 'assembly-document'; }],
  ['origin immutable version ID', (_p, _j, part) => { part.source.originVersionId = 'assembly-version'; }],
  ['origin assembly element ID', (_p, _j, part) => { part.source.originElementId = 'assembly-element'; }],
  ['origin assembly configuration', (_p, _j, part) => { part.source.originConfiguration = 'robot=practice'; }],
  ['installed transform', (_p, _j, part) => { part.source.occurrences![0].transform[3] = 0.25; }],
  ['assembly occurrence path', (_p, _j, part) => { part.source.occurrences![0].path[0] = 'right-module'; }],
  ['installed transform units', (_p, _j, part) => { part.source.installedTransformUnits = 'mm'; }],
  ['source availability', (_p, _j, part) => { part.source.available = false; }],
  ['make/buy decision', (_p, _j, part) => { part.classification = 'buy'; }],
  ['normalized geometry units', (_p, _j, part) => { (part.geometry as { units: string }).units = 'in'; }],
  ['declared mesh dimensions', (_p, _j, part) => { part.geometry.dimensions[2] += 1; }],
  ['exported geometry hash', (_p, _j, part) => { part.geometry.hash = 'f'.repeat(64); }],
  ['preserved original hash', (_p, _j, part) => { part.geometry.original!.hash = 'e'.repeat(64); }],
  ['geometry warnings', (_p, _j, part) => { part.geometry.warnings = ['New geometry warning requires review.']; }],
  ['printer model name', (_p, job) => { job.printer.model = 'Different physical model'; }],
  ['printer qualification', (_p, job) => { job.printer.tested = !job.printer.tested; }],
  ['material type', (_p, job) => { job.material.type = 'PLA'; }],
  ['material qualification', (_p, job) => { job.material.tested = !job.material.tested; }],
  ['layer height', (_p, job) => { job.settings.layerHeight = 0.12; }],
  ['infill', (_p, job) => { job.settings.infill = 45; }],
  ['supports', (_p, job) => { job.settings.supports = !job.settings.supports; }],
  ['brim width', (_p, job) => { job.settings.brimWidth = 6; }],
  ['speed', (_p, job) => { job.settings.speed = 80; }],
  ['adapter-specific process setting', (_p, job) => { job.settings.sparse_infill_pattern = 'gyroid'; }],
  ['slicer identity', (_p, job) => { job.slicer.id = 'Different slicer'; }],
  ['resolved slicer profile bundle', (_p, job) => { job.slicer.profileBundleHash = 'b'.repeat(64); }],
  ['removed slicer profile bundle', (_p, job) => { delete job.slicer.profileBundleHash; }],
  ['recorded toolpath profile bundle', (_p, job) => { job.toolpath!.slicer.profileBundleHash = 'b'.repeat(64); }],
  ['native slicer-project hash', (_p, job) => { job.toolpath!.slicerProject!.hash = 'c'.repeat(64); }],
  ['native slicer-project bytes', (_p, job) => { job.toolpath!.slicerProject!.data = btoa('Changed archive bytes'); }],
  ['recorded load direction', (_p, job) => { job.useCase.loadDirection = 'User-confirmed axial load; magnitude unknown'; }],
  ['operating conditions', (_p, job) => { job.useCase.operatingConditions = 'User reports elevated temperature'; }],
];

describe('original requirement audit: every additional manifest input is review relevant', () => {
  it.each(additionalInputs)('revokes approval and toolpath currency after changing %s', async (_label, mutate) => {
    const before = await approvedProject(), after = structuredClone(before), job = after.jobs[0];
    mutate(after, job, after.parts[0]);
    expect(invalidateChangedJobs(before, after, 'Requirements audit input change')).toEqual([job.id]);
    expect(job.approval).toBeUndefined(); expect(job.toolpath?.stale).toBe(true);
    expect(job.toolpath?.reviewedAt).toBeUndefined();
    expect(await isToolpathCurrent(after, job)).toBe(false); expect(await isApprovalCurrent(after, job)).toBe(false);
    expect(job.reviews.some(review => review.action === 'approved')).toBe(true);
  });

  it('keeps CAD colour/material hints and unapplied category metadata separate from the selected process', async () => {
    const before = await approvedProject(), after = structuredClone(before), job = after.jobs[0];
    after.parts[0].materialHint = 'CAD: ABS'; after.parts[0].colorHint = '#00ff00';
    after.parts[0].category = 'enclosure'; after.parts[0].notes = 'Additional context; no manufacturing fields changed.';
    expect(invalidateChangedJobs(before, after)).toEqual([]);
    expect(job.material).toEqual(before.jobs[0].material); expect(job.settings).toEqual(before.jobs[0].settings);
    expect(await isApprovalCurrent(after, job)).toBe(true);
  });

  it('writes the three reviewed, rotated placements as actual millimetre vertices in prepared 3MF', async () => {
    const project = await approvedProject(), job = project.jobs[0], source = structuredClone(project.parts[0].geometry);
    expect(source.dimensions).toEqual([72, 48, 8]);
    job.items[0].quantity = 2; job.items[0].spareQuantity = 1;
    job.items[0].orientation = [90, 0, 0]; job.items[0].position = [60, 60, 0];
    const files = unzipSync(await prepare3mf(project, job));
    const xml = strFromU8(files['3D/3dmodel.model']);
    expect(xml).toContain('unit="millimeter"');
    const objects = [...xml.matchAll(/<object\b[^>]*>([\s\S]*?)<\/object>/g)];
    expect(objects).toHaveLength(3);
    // 72 x 48 x 8 rotated +90 around X becomes 72 x 8 x 48.
    // Grid-v1 uses an explicit 8 mm copy gap and two columns for these three copies.
    const expected = [
      { min: [24, 56, 0], max: [96, 64, 48] },
      { min: [104, 56, 0], max: [176, 64, 48] },
      { min: [24, 72, 0], max: [96, 80, 48] },
    ];
    objects.forEach((object, index) => {
      const vertices = [...object[1].matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g)]
        .map(match => match.slice(1).map(Number));
      expect(vertices.length).toBeGreaterThan(0);
      for (let axis = 0; axis < 3; axis++) {
        expect(Math.min(...vertices.map(v => v[axis]))).toBeCloseTo(expected[index].min[axis], 6);
        expect(Math.max(...vertices.map(v => v[axis]))).toBeCloseTo(expected[index].max[axis], 6);
      }
    });
    expect(project.parts[0].geometry).toEqual(source);
  });
});
