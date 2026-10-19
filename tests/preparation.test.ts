import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createLocalPart, fixtureCatalog, fixtureDefaultSelection, importFixtureParts } from '../src/adapters/onshape';
import { createJob, createProject, type Part, type Project, type Vec3 } from '../src/domain/model';
import { fitWarnings, layoutItem } from '../src/domain/invariants';
import { orientationSuggestions, preflightIssues, proposePlacement, quantityReconciliation, recommendedProfile } from '../src/domain/preparation';

const fetcher = (async (input: string | URL | Request) => new Response(readFileSync(new URL(`../public${input.toString()}`, import.meta.url)))) as typeof fetch;
async function setup(partIds = ['bracket']): Promise<Project> {
  const parts = await importFixtureParts({ ...fixtureDefaultSelection, partIds }, { fetcher, delayMs: 0 });
  const project = createProject('Preparation tests');
  project.parts = parts; project.jobs = [createJob(parts)]; project.activeJobId = project.jobs[0].id;
  return project;
}
function fakeToolpath(project: Project): void {
  const job = project.jobs[0];
  job.toolpath = { id: 'toolpath', name: 'demo.gcode', gcode: 'G21\nG90\nM82\nG0 X0 Y0 Z.2\nG1 X1 Y1 E1\n', hash: 'f'.repeat(64), manifestHash: 'a'.repeat(64), source: 'fixture',
    slicer: { ...job.slicer }, mappingConfirmed: true, createdAt: '2026-10-17T00:00:00Z', warnings: [] };
}
function applyProposal(project: Project, partId: string): void {
  const job = project.jobs[0], proposal = proposePlacement(project, job, partId), item = job.items.find(i => i.partId === partId)!;
  expect(proposal.available).toBe(true); item.position = proposal.position!; item.orientation = proposal.orientation!;
}

describe('explainable orientation candidates', () => {
  it('rotates measured fixture source bounds conservatively and preserves independent installed transforms', async () => {
    const project = await setup(), job = project.jobs[0], part = project.parts[0], before = structuredClone(project);
    const candidates = orientationSuggestions(project, job, part.id);
    expect(candidates).toHaveLength(3);
    expect(candidates.find(c => c.id === 'current')!.dimensions).toEqual([72, 48, 8]);
    expect(candidates.find(c => c.id === 'turn-x')!.dimensions[2]).toBeCloseTo(48, 6);
    expect(candidates.find(c => c.id === 'turn-y')!.dimensions[0]).toBeCloseTo(8, 6);
    expect(candidates.every(c => c.fits)).toBe(true);
    expect(candidates[0].dimensions[2]).toBe(8);
    expect(candidates[0].contextConfirmed).toBe(false);
    expect(candidates[0].missingContext).toHaveLength(5);
    expect(candidates[0].assumptions.join(' ')).toMatch(/not simulation or a strength assessment/);
    expect(candidates[0].explanations[0]).toMatch(/^Conservative rotated source bounds:/);
    expect(candidates[0].assumptions.join(' ')).toMatch(/not mesh contact analysis/);
    expect(candidates[0].tradeoffs.join(' ')).toMatch(/no weak sections or safety factors/);
    expect(project).toEqual(before);
  });
  it('retains a manual orientation candidate and states incomplete context even with a forged confirmation', async () => {
    const project = await setup(), job = project.jobs[0], item = job.items[0];
    item.orientation = [24, 36, 57]; job.useCase.confirmed = true;
    const candidates = orientationSuggestions(project, job, item.partId);
    expect(candidates).toHaveLength(4);
    expect(candidates.find(c => c.id === 'current')!.orientation).toEqual([24, 36, 57]);
    expect(candidates.every(c => c.contextConfirmed)).toBe(false);
    expect(candidates[0].missingContext).toHaveLength(4);
  });
  it('uses team-confirmed context without inferring forces or numerical strength', async () => {
    const project = await setup(), job = project.jobs[0];
    job.useCase = { purpose: 'Sensor mounted on two bolts', loadDirection: 'Unknown; review before physical use', constraints: 'Keep bolt faces accessible', operatingConditions: 'Indoor robot; temperature unknown', confirmed: true };
    const candidate = orientationSuggestions(project, job, job.items[0].partId)[0];
    expect(candidate.contextConfirmed).toBe(true); expect(candidate.missingContext).toEqual([]);
    expect(candidate.assumptions.join(' ')).toMatch(/Team-confirmed purpose: Sensor/);
    expect(candidate.assumptions.join(' ')).toMatch(/not been independently verified/);
  });
  it('checks all required copies and spares instead of only one object', async () => {
    const project = await setup(), job = project.jobs[0], item = job.items[0];
    item.quantity = 1; item.spareQuantity = 0; job.printer.buildVolume = [80, 50, 10];
    expect(orientationSuggestions(project, job, item.partId).find(c => c.id === 'current')!.fits).toBe(true);
    item.spareQuantity = 1;
    expect(orientationSuggestions(project, job, item.partId).every(c => !c.fits)).toBe(true);
  });
  it('handles missing parts, invalid rotations, dimensions and quantities without claiming a candidate', async () => {
    const project = await setup(), job = project.jobs[0], item = job.items[0];
    expect(orientationSuggestions(project, job, 'missing')).toEqual([]);
    item.orientation = [NaN, 0, 0]; expect(orientationSuggestions(project, job, item.partId)).toEqual([]);
    item.orientation = [0, 0, 0]; item.quantity = 0; expect(orientationSuggestions(project, job, item.partId)).toEqual([]);
    item.quantity = 1; project.parts[0].geometry.dimensions = [0, 10, 10]; expect(orientationSuggestions(project, job, item.partId)).toEqual([]);
  });
});

describe('explicit build-volume proposals', () => {
  it('places every actual copy and spare, changes nothing until applied and then satisfies canonical fit validation', async () => {
    const project = await setup(), job = project.jobs[0], item = job.items[0]; item.spareQuantity = 3;
    const before = structuredClone(project), proposal = proposePlacement(project, job, item.partId);
    expect(proposal.available).toBe(true); expect(proposal.totalCopies).toBe(5); expect(project).toEqual(before);
    item.position = proposal.position!; item.orientation = proposal.orientation!;
    expect(layoutItem(project.parts[0], item)).toHaveLength(5); expect(fitWarnings(project, job)).toEqual([]);
    expect(proposal.assumptions.join(' ')).toMatch(/not a complete packing solver/);
    expect(proposal.assumptions.join(' ')).toMatch(/Brims, supports/);
  });
  it('preserves manual orientation when it fits and avoids other included parts', async () => {
    const project = await setup(['bracket', 'enclosure']), job = project.jobs[0], item = job.items[0];
    const other = job.items[1]; other.quantity = 1; other.position = [30, 21, 0]; item.orientation = [0, 0, 90];
    const proposal = proposePlacement(project, job, item.partId);
    expect(proposal.available).toBe(true); expect(proposal.orientation).toEqual([0, 0, 90]);
    expect(proposal.explanations.join(' ')).toMatch(/manual orientation is preserved/);
    item.position = proposal.position!; expect(fitWarnings(project, job)).toEqual([]);
  });
  it('proposes a disclosed orientation change if the current orientation cannot fit', async () => {
    const project = await setup(), job = project.jobs[0], item = job.items[0];
    item.quantity = 1; job.printer.buildVolume = [10, 50, 80];
    const proposal = proposePlacement(project, job, item.partId);
    expect(proposal.available).toBe(true); expect(proposal.orientation).toEqual([0, 90, 0]);
    expect(proposal.explanations.join(' ')).toMatch(/different orientation is proposed explicitly/);
    item.position = proposal.position!; item.orientation = proposal.orientation!; expect(fitWarnings(project, job)).toEqual([]);
  });
  it('reports no-fit and invalid input recovery without rescaling or dropping copies', async () => {
    const project = await setup(), job = project.jobs[0], item = job.items[0];
    job.printer.buildVolume = [3, 3, 3]; const proposal = proposePlacement(project, job, item.partId);
    expect(proposal.available).toBe(false); expect(proposal.reason).toMatch(/not rescaled/); expect(item.quantity).toBe(2);
    job.printer.buildVolume[0] = NaN; expect(proposePlacement(project, job, item.partId).reason).toMatch(/Correct quantities/);
    expect(proposePlacement(project, job, 'missing').available).toBe(false);
    job.printer.buildVolume = [256, 256, 256]; job.items.push({ ...structuredClone(item), partId: 'missing' });
    expect(proposePlacement(project, job, item.partId).reason).toMatch(/Correct missing parts/);
  });
});

describe('quantity reconciliation and editable recommendations', () => {
  it('counts repeated nested configuration-specific occurrences and keeps spare demand separate', async () => {
    const project = await setup(['bracket', 'spacer']), job = project.jobs[0], spacer = job.items[1];
    spacer.quantity = 2; spacer.spareQuantity = 3;
    const rows = quantityReconciliation(project, job);
    expect(rows[0]).toMatchObject({ cadQuantity: 2, occurrenceCount: 2, plannedQuantity: 2, delta: 0, needsReview: false });
    expect(rows[1]).toMatchObject({ cadQuantity: 4, occurrenceCount: 4, plannedQuantity: 2, spareQuantity: 3, totalQuantity: 5, delta: -2, suggestedQuantity: 4, sourceBasis: 'assembly occurrences', needsReview: true });
    expect(project.parts[1].source.occurrences!.map(o => o.path.join('/'))).toEqual(['left/spacer-a', 'left/spacer-b', 'right/spacer-a', 'right/spacer-b']);
    const practice = await importFixtureParts({ ...fixtureDefaultSelection, configuration: 'Robot=Practice', partIds: ['pulley'] }, { fetcher, delayMs: 0 });
    const practiceJob = createJob(practice); project.parts = practice;
    expect(quantityReconciliation(project, practiceJob)[0].cadQuantity).toBe(1);
  });
  it('uses explicit Part Studio/local source demand when occurrence paths do not exist', async () => {
    const project = await setup();
    const parts = await importFixtureParts({ ...fixtureDefaultSelection, elementId: fixtureCatalog[0].elements[1].id, partIds: ['bracket'] }, { fetcher, delayMs: 0 });
    project.parts = parts; const job = createJob(parts);
    expect(quantityReconciliation(project, job)[0]).toMatchObject({ cadQuantity: 1, occurrenceCount: 0, sourceBasis: 'source quantity' });
    parts[0].source = { kind: 'local' };
    expect(quantityReconciliation(project, job)[0].sourceBasis).toBe('local import');
    project.parts = []; expect(quantityReconciliation(project, job)[0].needsReview).toBe(true);
  });
  it.each(['bracket', 'enclosure', 'spacer', 'pulley', 'custom'] as const)('provides a disclosed editable %s example without changing manual settings', async category => {
    const project = await setup(), job = project.jobs[0], part = project.parts[0]; part.category = category;
    job.settings.walls = 7; job.settings.infill = 73; const before = structuredClone(project);
    const recommendation = recommendedProfile(part, job);
    expect(recommendation.category).toBe(category); expect(recommendation.confidence).toBe('review required');
    expect(recommendation.assumptions.join(' ')).toMatch(/Untested example/); expect(recommendation.assumptions.join(' ')).toMatch(/nozzle/);
    expect(recommendation.assumptions.join(' ')).toMatch(/Manual overrides are retained/); expect(project).toEqual(before);
    recommendation.settings.walls = 9; expect(job.settings.walls).toBe(7); expect(job.baseSettings.walls).toBe(4);
  });
  it('adapts an example layer starting point to declared nozzle without changing selected material', async () => {
    const project = await setup(), job = project.jobs[0], part = project.parts[0]; job.printer.nozzleDiameter = 0.2; part.materialHint = 'CAD: Nylon';
    const materialBefore = structuredClone(job.material); const profile = recommendedProfile(part, job);
    expect(profile.settings.layerHeight).toBe(0.1); expect(job.material).toEqual(materialBefore);
    expect(profile.assumptions.join(' ')).toMatch(/not a machine limit/);
  });
});

describe('navigable preflight issues', () => {
  it('targets quantity, orientation and placement inputs and separates warnings from errors', async () => {
    const project = await setup(), job = project.jobs[0], item = job.items[0];
    applyProposal(project, item.partId); item.quantity = 1; item.position = [999, 20, 0];
    let issues = preflightIssues(project, job);
    expect(issues.find(i => i.id.startsWith('reconcile-'))).toMatchObject({ severity: 'warning', field: 'Required quantity', partId: item.partId });
    expect(issues.find(i => i.id.startsWith('fit-'))).toMatchObject({ severity: 'error', field: 'Position X', page: 'prepare', partId: item.partId });
    item.orientation = [NaN, 0, 0]; item.spareQuantity = -1;
    issues = preflightIssues(project, job);
    expect(issues.find(i => i.id.startsWith('orientation-'))!.field).toBe('Rotate X');
    expect(issues.find(i => i.id.startsWith('quantity-'))!.field).toBe('Backup parts');
  });
  it('reports revoked mappings, stale hashes, layer review and stale approvals with actionable pages', async () => {
    const project = await setup(), job = project.jobs[0]; fakeToolpath(project); job.toolpath!.mappingConfirmed = false;
    job.approval = { id: 'old', actor: 'reviewer', at: '2026-10-17T00:00:00Z', manifestHash: 'old', toolpathHash: 'old', demonstrationOnly: true };
    const issues = preflightIssues(project, job, { toolpathCurrent: false, approvalCurrent: false });
    expect(issues.find(i => i.id === 'toolpath-mapping')).toMatchObject({ severity: 'error', page: 'toolpaths', field: 'Import G-code' });
    expect(issues.find(i => i.id === 'toolpath-stale')!.page).toBe('toolpaths');
    expect(issues.find(i => i.id === 'toolpath-review')!.field).toBe('Confirm toolpath review');
    expect(issues.find(i => i.id === 'approval-stale')!.field).toBe('Confirm manufacturing manifest');
    const unbound = await setup(); expect(preflightIssues(unbound, unbound.jobs[0]).some(i => i.id === 'toolpath-missing')).toBe(true);
  });
  it('detects stale flags and changed slicer identity even before asynchronous hashing finishes', async () => {
    const project = await setup(), job = project.jobs[0]; fakeToolpath(project);
    job.toolpath!.stale = true; expect(preflightIssues(project, job).some(i => i.id === 'toolpath-stale')).toBe(true);
    job.toolpath!.stale = false; job.slicer.version = 'changed';
    expect(preflightIssues(project, job).some(i => i.id === 'toolpath-stale')).toBe(true);
  });
  it('detects inch/mm metadata mismatches and retains once-normalized genuine inch imports', async () => {
    const project = await setup(), job = project.jobs[0], part = project.parts[0];
    part.geometry.dimensions = part.geometry.dimensions.map(v => v * 25.4) as Vec3;
    const issue = preflightIssues(project, job).find(i => i.id.startsWith('geometry-units-'))!;
    expect(issue.severity).toBe('error'); expect(issue.detail).toMatch(/inch\/mm conversion factor/);
    const local = await createLocalPart(readFileSync(new URL('../public/fixtures/spacer.stl', import.meta.url)), 'in', 'spacer-inch.stl');
    local.classification = 'make'; project.parts = [local]; const localJob = createJob([local]);
    expect(local.geometry.dimensions[0]).toBeCloseTo(18 * 25.4, 6);
    expect(preflightIssues(project, localJob).some(i => i.id.startsWith('geometry-units-') || i.id.startsWith('units-'))).toBe(false);
    (local.geometry as unknown as { units: string }).units = 'in';
    expect(preflightIssues(project, localJob).find(i => i.id.startsWith('units-'))!.field).toBe('Add CAD parts');
  });
  it('rejects missing, unavailable, ambiguous and incomplete exact sources without attempting substitution', async () => {
    const project = await setup(), job = project.jobs[0], part = project.parts[0];
    part.classification = 'review'; part.source.available = false; delete part.source.versionId; delete part.source.configuration;
    job.items.push({ ...structuredClone(job.items[0]), partId: 'missing' });
    const issues = preflightIssues(project, job);
    expect(issues.map(i => i.id)).toEqual(expect.arrayContaining([`classification-${part.id}`, `source-unavailable-${part.id}`, `version-${part.id}`, `configuration-${part.id}`, 'missing-missing']));
    expect(issues.filter(i => i.id.includes(part.id)).every(i => i.partId === part.id)).toBe(true);
  });
  it('reports overlapping bounds and duplicate job rows or source paths rather than deduplicating silently', async () => {
    const project = await setup(['bracket', 'enclosure']), job = project.jobs[0];
    job.items.forEach(item => { item.position = [50, 50, 0]; item.quantity = 1; });
    expect(preflightIssues(project, job).some(i => i.id.startsWith('overlap-'))).toBe(true);
    job.items.push(structuredClone(job.items[0])); project.parts[0].source.occurrences!.push(structuredClone(project.parts[0].source.occurrences![0]));
    const issues = preflightIssues(project, job);
    expect(issues.some(i => i.id.startsWith('duplicate-'))).toBe(true); expect(issues.some(i => i.id.startsWith('occurrences-'))).toBe(true);
  });
  it('identifies invalid settings and discloses nozzle compatibility as an overridable heuristic warning', async () => {
    const project = await setup(), job = project.jobs[0]; job.settings = { ...job.settings, layerHeight: 0.4, walls: 0.5, infill: 101, brimWidth: -1, speed: 0 };
    const issues = preflightIssues(project, job), nozzle = issues.find(i => i.id === 'settings-layer-nozzle')!;
    expect(nozzle.severity).toBe('warning'); expect(nozzle.detail).toMatch(/not a verified machine limit/); expect(job.settings.layerHeight).toBe(0.4);
    expect(issues.filter(i => i.id.startsWith('settings-') && i.severity === 'error').map(i => i.field)).toEqual(expect.arrayContaining(['Wall loops', 'Infill', 'Brim width', 'Print speed']));
    job.settings.layerHeight = NaN; expect(preflightIssues(project, job).find(i => i.id === 'settings-layer')!.severity).toBe('error');
  });
  it('is pure and repeatable across all suggestions and repeated checks', async () => {
    const project = await setup(), job = project.jobs[0], part: Part = project.parts[0], before = structuredClone(project);
    const first = preflightIssues(project, job); expect(preflightIssues(project, job)).toEqual(first);
    expect(proposePlacement(project, job, part.id)).toEqual(proposePlacement(project, job, part.id));
    expect(recommendedProfile(part, job)).toEqual(recommendedProfile(part, job));
    expect(quantityReconciliation(project, job)).toEqual(quantityReconciliation(project, job));
    expect(project).toEqual(before);
  });
});
