import { openSettings, openSlicingSettings, openProjectMenu, openCameraOptions, openParts } from './navigation';
import { test, expect, type Download, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { unzipSync, strFromU8 } from 'fflate';
import { createApp } from '../server/app';
import { createProject, type Project } from '../src/domain/model';
import { stableStringify } from '../src/domain/invariants';

const digest = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');

async function inspector(page: Page, tab: 'Part inspector' | 'Process inspector' | 'Preflight checks') {
  await page.getByRole('button', { name: '02 Prepare', exact: true }).click();
  await openSettings(page,tab==='Part inspector'?'part':tab==='Process inspector'?'process':'checks');
  const advanced = page.locator('summary').filter({ hasText: tab === 'Part inspector' ? /^Manual placement and rotation$/ : /^Advanced slicing settings/ });
  if (tab !== 'Preflight checks' && await advanced.count()) {
    const details = advanced.locator('..');
    if (await details.getAttribute('open') === null) await advanced.click();
  }
}

async function evidence(page: Page, name: string) {
  await mkdir('docs/guided-workflow', { recursive: true });
  await page.screenshot({ path: `docs/guided-workflow/${name}.png`, fullPage: true });
}


async function downloadedBytes(download: Download): Promise<Uint8Array> {
  const saved = await download.path();
  expect(saved).not.toBeNull();
  return new Uint8Array(await readFile(saved!));
}

async function downloadBy(page: Page, action: () => Promise<unknown>): Promise<Uint8Array> {
  const waiting = page.waitForEvent('download');
  await action();
  return downloadedBytes(await waiting);
}

async function mockPersistence(page: Page, project = createProject('E2E · mocked persistence')) {
  // Explicit test double: these cases exercise browser recovery, not disk persistence.
  let saved = project;
  await page.route('**/api/project', async route => {
    if (route.request().method() === 'PUT') {
      saved = route.request().postDataJSON() as Project;
      await route.fulfill({ json: { saved: true, id: saved.id } });
    } else await route.fulfill({ json: { project: saved } });
  });
}

async function openFixtureSource(page: Page) {
  await page.getByRole('button', { name: 'Select design', exact: true }).click();
  const source = page.getByRole('dialog', { name: 'Bring your design into Foundry' });
  await expect(source.getByText('Onshape setup required', { exact: true })).toBeVisible();
  await source.getByRole('tab', { name: 'Demonstration fixtures', exact: true }).click();
  await source.getByRole('button', { name: 'Use fixture link' }).click();
  await source.getByRole('button', { name: 'Resolve', exact: true }).click();
  await expect(source.getByText('Fixture document found.', { exact: false })).toBeVisible();
  await source.getByLabel('Immutable version').selectOption({ label: 'V18 · Design freeze' });
  await source.getByLabel('Configuration', { exact: true }).selectOption({ label: 'Competition robot' });
  return source;
}

async function bindDemonstrationToolpath(page: Page) {
  await page.getByRole('button', { name: '03 Slice & inspect', exact: true }).click();
  await openSlicingSettings(page);
  await expect(page.getByRole('button', { name: 'Slice with Bambu Studio' })).toBeDisabled();
  await page.getByRole('button', { name: 'Load demonstration toolpath' }).click();
  const dialog = page.getByRole('dialog', { name: 'Bind an imported toolpath' });
  await expect(dialog.getByText('NON-MANUFACTURABLE DEMONSTRATION', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Attach to current manifest' })).toBeDisabled();
  await dialog.getByLabel('Confirm imported toolpath mapping').check();
  await dialog.getByRole('button', { name: 'Attach to current manifest' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('CURRENT', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Toolpath layer')).toBeVisible();
  await page.getByLabel('Toolpath layer').fill('0');
  await expect(page.getByText('Layer 1 /', { exact: false })).toBeVisible();
  await page.getByLabel('Walls', { exact: true }).uncheck();
  await page.getByLabel('Walls', { exact: true }).check();
}

async function approveDemonstration(page: Page) {
  await page.getByRole('button', { name: '04 Approve', exact: true }).click();
  const approve = page.getByRole('button', { name: 'Approve exact job', exact: true });
  await expect(approve).toBeDisabled();
  await page.getByLabel('Reviewer name').fill('E2E · manufacturing lead');
  await page.getByLabel('Confirm toolpath review').check();
  await page.getByLabel('Confirm manufacturing manifest').check();
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect(page.getByText('APPROVED', { exact: true })).toBeVisible();
  await expect(page.getByText('Demonstration only.', { exact: false })).toBeVisible();
}

test.use({ video: { mode: 'on', size: { width: 1512, height: 1050 } } });
test.afterEach(async ({ page }, info) => {
    if (info.status !== info.expectedStatus || !info.title.startsWith('complete fixture workflow')) return;
    const video = page.video();
    await page.close();
    if (video) await video.saveAs('docs/guided-workflow/complete-workflow.webm');
  });

test('complete fixture workflow, exact approval, hashed package, and real disk save/reopen', async ({ page }, testInfo) => {
  // Browser requests are forwarded to the actual Express app with an isolated disk store.
  // Only the network destination changes: persistence/validation/write/rename/reopen are real.
  const directory = await mkdtemp(path.join(tmpdir(), 'catalyst-e2e-persistence-'));
  const app = await createApp({ dataDirectory: directory });
  const server: Server = await new Promise(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test persistence server did not bind.');
  const persistenceUrl = `http://127.0.0.1:${address.port}/api/project`;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    const blank = createProject('E2E · actual disk persistence');
    const prepared = await fetch(persistenceUrl, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(blank) });
    expect(prepared.ok).toBe(true);
    await page.route('**/api/project', async route => {
      const response = await route.fetch({ url: persistenceUrl });
      await route.fulfill({ response });
    });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Choose a design to prepare.', exact: true })).toBeVisible();
    const source = await openFixtureSource(page);
    await expect(source.getByLabel('Select 608 bearing · purchased', { exact: true })).toBeDisabled();
    await expect(source.getByLabel('Select Linked camera mount · access required', { exact: true })).toBeDisabled();
    await source.getByLabel('Select Idler pulley · 48 mm', { exact: true }).uncheck();
    await source.getByLabel('Select Sensor enclosure', { exact: true }).uncheck();
    await source.getByLabel('Spares for Intake mounting bracket').fill('1');
    await source.getByRole('button', { name: 'Import selected parts' }).click();
    await expect(source).not.toBeVisible();
    await expect(page.locator('.part-card')).toHaveCount(2);
    await evidence(page, 'after-source');
    await expect(page.getByLabel('Required quantity')).toHaveValue('2');
    await expect(page.getByLabel('Backup parts')).toHaveValue('1');
    await expect(page.getByLabel('Rotate Z', { exact: true })).not.toBeVisible();
    await inspector(page, 'Part inspector');

    const canvas = page.getByRole('img', { name: 'Interactive 3D manufacturing workspace.', exact: false });
    await expect(canvas).toBeVisible();
    expect(await canvas.evaluate(element => !!(element as HTMLCanvasElement).getContext('webgl2'))).toBe(true);
    await page.getByLabel('Required quantity').fill('1');
    await page.getByLabel('Required quantity').fill('2');
    await page.getByLabel('Rotate Z', { exact: true }).fill('90');
    await page.getByLabel('Position X', { exact: true }).fill('50');
    await page.getByLabel('Position Y', { exact: true }).fill('50');
    await inspector(page, 'Process inspector');
    await page.getByLabel('Layer height', { exact: true }).fill('0.16');
    await page.getByLabel('Wall loops', { exact: true }).fill('5');
    await page.getByRole('button', { name: 'Apply example base profile' }).click();
    await expect(page.getByLabel('Layer height', { exact: true })).toHaveValue('0.16');
    await expect(page.getByLabel('Wall loops', { exact: true })).toHaveValue('5');
    await page.getByLabel('Filament', { exact: true }).selectOption('PLA');
    await page.getByLabel('Nozzle', { exact: true }).selectOption('0.6');
    await openParts(page);
    await page.locator('.part-card').filter({ hasText: 'Shaft spacer' }).click();
    await inspector(page, 'Part inspector');
    await expect(page.getByLabel('Required quantity')).toHaveValue('4');
    await page.getByLabel('Position X', { exact: true }).fill('200');
    await page.getByLabel('Position Y', { exact: true }).fill('180');
    await expect(page.getByText('Within build volume', { exact: true })).toBeVisible();
    await openCameraOptions(page);
    await page.getByRole('button', { name: 'Top view', exact: true }).click();
    await page.getByRole('button', { name: 'Fit to view', exact: true }).click();
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds!.x + bounds!.width / 2 + 70, bounds!.y + bounds!.height / 2 + 35, { steps: 6 });
    await page.mouse.up();
    await page.mouse.wheel(0, -100);
    await openCameraOptions(page);
    await page.getByRole('button', { name: 'Isometric view', exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath('prepared-plate.png'), fullPage: true });
    await evidence(page, 'after-prepared');
    await bindDemonstrationToolpath(page);
    await page.screenshot({ path: testInfo.outputPath('actual-gcode-preview.png'), fullPage: true });
    await evidence(page, 'after-toolpath');
    await approveDemonstration(page);
    await evidence(page, 'after-approved');
    await page.getByRole('button', { name: '05 Export', exact: true }).click();
    for (const name of ['Selected machine matches the package', 'Loaded material matches the mapping', 'Installed nozzle matches the profile', 'Build plate matches the profile', 'Bed is clear and ready']) await page.getByLabel(name, { exact: true }).check();

    const firstBytes = await downloadBy(page, () => page.getByRole('button', { name: 'Export approved package' }).click());
    await writeFile('docs/guided-workflow/demonstration-approved-package.zip', firstBytes);
    const first = unzipSync(firstBytes);
    const second = unzipSync(await downloadBy(page, () => page.getByRole('button', { name: 'Export approved package' }).click()));
    const manifest = JSON.parse(strFromU8(first['manifest.json']));
    const checksums = JSON.parse(strFromU8(first['checksums.sha256.json'])) as Record<string, string>;
    expect(Object.keys(first)).toEqual(expect.arrayContaining(['manifest.json', 'project.catalyst.json', 'settings.json', 'toolpaths/job.gcode', 'README.txt', 'checksums.sha256.json']));
    expect(Object.keys(first).filter(name => name.startsWith('geometry/'))).toHaveLength(2);
    expect(Object.keys(first).filter(name => name.startsWith('originals/'))).toHaveLength(2);
    for (const [name, hash] of Object.entries(checksums)) expect(digest(first[name]), name).toBe(hash);
    expect(manifest.demonstrationOnly).toBe(true);
    expect(manifest.dispatchPerformed).toBe(false);
    expect(strFromU8(first['README.txt'])).toContain('DO NOT RUN ON A MACHINE');
    expect(manifest.units).toBe('mm');
    expect(manifest.parts.map((part: { totalQuantity: number }) => part.totalQuantity)).toEqual([3, 4]);
    expect(manifest.parts[0].orientation).toEqual([0, 0, 90]);
    expect(manifest.parts.every((part: { source: { revision: string; configuration: string } }) => part.source.revision === 'V18' && part.source.configuration === 'Robot=Competition')).toBe(true);
    expect(manifest.parts[0].source.occurrences).toHaveLength(2);
    expect(manifest.parts[1].source.occurrences).toHaveLength(4);
    expect(manifest.toolpathHash).toBe(digest(first['toolpaths/job.gcode']));
    const { approval, release, demonstrationOnly, handoff, dispatchPerformed, ...approvalInputs } = manifest;
    expect(approval.manifestHash).toBe(digest(stableStringify(approvalInputs)));
    expect(JSON.parse(strFromU8(second['manifest.json'])).release.id).toBe(release.id);
    const packagedProject = JSON.parse(strFromU8(second['project.catalyst.json'])) as Project;
    expect(packagedProject.jobs[0].releases).toHaveLength(1);
    await evidence(page, 'after-export');

    await page.getByLabel('Operator assignment').fill('Riley · printer station 1');
    await page.getByRole('button', { name: 'Assign job', exact: true }).click();
    await openProjectMenu(page);
    await page.getByRole('button', { name: 'Job queue', exact: true }).click();
    await expect(page.getByRole('cell', { name: 'assigned', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Riley · printer station 1', exact: true })).toBeVisible();
    await expect(page.getByText('Assignment records operator responsibility. It does not mean a printer has accepted or started a job.', { exact: false })).toBeVisible();

    await page.getByRole('button', { name: 'Save project', exact: true }).click();
    await expect(page.getByText('Project saved to this cloud workspace.', { exact: true })).toBeVisible();
    const savedOnDisk = JSON.parse(await readFile(path.join(directory, 'project.json'), 'utf8')) as Project;
    expect(savedOnDisk.jobs[0].approval?.manifestHash).toBe(approval.manifestHash);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.locator('.part-card')).toHaveCount(2);
    await inspector(page, 'Part inspector');
    await expect(page.getByLabel('Rotate Z', { exact: true })).toHaveValue('90');
    await page.getByRole('button', { name: '04 Approve', exact: true }).click();
    await expect(page.getByText('APPROVED', { exact: true })).toBeVisible();
    await openProjectMenu(page);
    await page.getByRole('button', { name: 'Job queue', exact: true }).click();
    const portable = await downloadBy(page, () => page.getByRole('button', { name: 'Export project', exact: true }).click());
    await writeFile('docs/guided-workflow/demonstration-project.catalyst.json', portable);
    const portableProject = JSON.parse(new TextDecoder().decode(portable)) as Project;
    expect(portableProject.id).toBe(blank.id);
    expect(portableProject.jobs[0].releases).toHaveLength(1);
    await page.locator('input[type=file]').first().setInputFiles({ name: 'reopened.catalyst.json', mimeType: 'application/json', buffer: Buffer.from(portable) });
    await expect(page.getByText('Project reopened. Geometry hashes and approvals were checked.', { exact: true })).toBeVisible();
    await inspector(page, 'Part inspector');
    await expect(page.getByLabel('Rotate Z', { exact: true })).toHaveValue('90');
    await evidence(page, 'after-reopened');

    await inspector(page, 'Process inspector');
    await page.getByLabel('Wall loops', { exact: true }).fill('6');
    await page.getByRole('button', { name: '03 Slice & inspect', exact: true }).click();
    await openSlicingSettings(page);
    await expect(page.getByText('Manufacturing inputs changed. Import a matching toolpath and review it again.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '04 Approve', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Approve exact job', exact: true })).toBeDisabled();
    await expect(page.getByText('The toolpath is stale.', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: '05 Export', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Export approved package' })).toBeDisabled();

    // Wait for the real browser autosave. The explicit disk save still has five walls
    // and an approval; reloading must preserve this newer, unapproved six-wall draft.
    await expect.poll(() => page.evaluate(() => {
      const draft = JSON.parse(localStorage.getItem('catalyst-project') ?? '{}');
      const job = draft.jobs?.find((candidate: { id: string }) => candidate.id === draft.activeJobId);
      return { walls: job?.settings.walls, stale: job?.toolpath?.stale, approved: !!job?.approval };
    })).toEqual({ walls: 6, stale: true, approved: false });
    expect(JSON.parse(await readFile(path.join(directory, 'project.json'), 'utf8')).jobs[0].settings.walls).toBe(5);
    await page.reload();
    await expect(page.getByText('Recovered browser draft', { exact: true })).toBeVisible();
    await inspector(page, 'Process inspector');
    await expect(page.getByLabel('Wall loops', { exact: true })).toHaveValue('6');
    await page.getByRole('button', { name: '04 Approve', exact: true }).click();
    await expect(page.getByText('The toolpath is stale.', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve exact job', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '05 Export', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Export approved package' })).toBeDisabled();

    // Explicit outage test double: the already-validated browser draft remains real.
    await page.unroute('**/api/project');
    await page.route('**/api/project', route => route.fulfill({ status: 503, json: { error: 'Simulated startup service outage' } }));
    await page.reload();
    await expect(page.getByText('Recovered browser draft', { exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('Your validated browser draft was recovered');
    await inspector(page, 'Process inspector');
    await expect(page.getByLabel('Wall loops', { exact: true })).toHaveValue('6');
    await page.getByRole('button', { name: '04 Approve', exact: true }).click();
    await expect(page.getByText('The toolpath is stale.', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: '05 Export', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Export approved package' })).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath('startup-draft-recovery.png'), fullPage: true });
    expect(errors).toEqual([]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});


test('invalid links, configuration changes, cancelled transfers, and invalid STL recover with mocked persistence', async ({ page }) => {
  await mockPersistence(page);
  await page.goto('/');
  const source = await openFixtureSource(page);
  await source.getByLabel('Onshape document link').fill('https://example.com/documents/not-onshape');
  await source.getByRole('button', { name: 'Resolve', exact: true }).click();
  await expect(source.getByRole('alert')).toContainText(/onshape/i);
  await source.getByLabel('Configuration', { exact: true }).selectOption({ label: 'Practice robot' });
  const pulley = source.getByRole('row').filter({ hasText: 'Idler pulley · 48 mm' });
  await expect(pulley.getByRole('cell').nth(2)).toHaveText('1');
  await source.getByRole('button', { name: 'Import selected parts' }).click();
  await source.getByRole('button', { name: 'Cancel transfer' }).click();
  await expect(source.getByRole('alert')).toContainText(/cancel/i);
  await expect(page.locator('.part-card')).toHaveCount(0);
  await source.getByRole('tab', { name: 'Local STL fallback', exact: true }).click();
  await source.locator('input[type=file]').setInputFiles({ name: 'bad.stl', mimeType: 'model/stl', buffer: Buffer.from('this is not a mesh') });
  await expect(source.getByRole('alert')).toBeVisible();
  await expect(source.getByRole('button', { name: 'Add inspected STL' })).toBeDisabled();
  const fixture = await readFile(path.resolve('public/fixtures/spacer.stl'));
  await source.locator('input[type=file]').setInputFiles({ name: 'inch-spacer.stl', mimeType: 'model/stl', buffer: fixture });
  await source.getByLabel('STL source units').selectOption('in');
  await expect(source.getByText('457.20 × 457.20 × 304.80 mm', { exact: true })).toBeVisible();
  await expect(source.getByRole('button', { name: 'Add inspected STL' })).toBeDisabled();
  await source.getByLabel('STL source units').selectOption('mm');
  await expect(source.getByText('18.00 × 18.00 × 12.00 mm', { exact: true })).toBeVisible();
  await source.getByLabel('I checked these dimensions against the intended CAD dimensions.', { exact: true }).check();
  await source.getByRole('button', { name: 'Add inspected STL' }).click();
  await expect(source).not.toBeVisible();
  await expect(page.getByLabel('Part classification')).toHaveValue('review');
  await expect(page.getByLabel('Include in this manufacturing batch', { exact: true })).toBeDisabled();
  await page.getByLabel('Part classification').selectOption('make');
  await page.getByLabel('Include in this manufacturing batch', { exact: true }).check();
  await expect(page.getByLabel('Required quantity')).toHaveValue('1');
  await page.getByRole('button', { name: '03 Slice & inspect', exact: true }).click();
  await openSlicingSettings(page);
  await page.locator('input[type=file]').nth(1).setInputFiles({ name: 'unsupported-arc.gcode', mimeType: 'text/plain', buffer: Buffer.from('G21\nG90\nM82\nG92 E0\nG1 X10 Y10 Z0.2 F1200\nG2 X20 Y10 I5 J0 E1\nG1 X20 Y20 E2\n') });
  const toolpath = page.getByRole('dialog', { name: 'Bind an imported toolpath' });
  await expect(toolpath.getByText('This file cannot be approved.', { exact: false })).toBeVisible();
  await toolpath.getByLabel('Confirm imported toolpath mapping').check();
  await expect(toolpath.getByRole('button', { name: 'Attach to current manifest' })).toBeDisabled();
  await toolpath.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.locator('input[type=file]').first().setInputFiles({ name: 'broken.catalyst.json', mimeType: 'application/json', buffer: Buffer.from('{ definitely not valid project JSON') });
  await expect(page.getByRole('alert')).toContainText(/JSON|Unexpected|property name/i);
  await expect(page.locator('.part-card')).toHaveCount(1);
  await page.getByRole('button', { name: '02 Prepare', exact: true }).click();
  await expect(page.getByLabel('Part classification', { exact: true })).toHaveValue('make');
});

test('mobile workspace opens sources and recovers from a disconnected save with mocked persistence', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockPersistence(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Choose a design to prepare.', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.getByRole('button', { name: 'Select design', exact: true }).click();
  const source = page.getByRole('dialog', { name: 'Bring your design into Foundry' });
  await expect(source).toBeVisible();
  await expect(source.getByText('Onshape setup required', { exact: true })).toBeVisible();
  await source.getByRole('tab', { name: 'Demonstration fixtures', exact: true }).click();
  await expect(source.getByLabel('Immutable version')).toBeVisible();
  await source.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.unroute('**/api/project');
  await page.route('**/api/project', route => route.fulfill({ status: 503, json: { error: 'Simulated disconnected save. Export a recovery project.' } }));
  await page.getByRole('button', { name: 'Save project', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Simulated disconnected save');
  await openProjectMenu(page);
  await page.getByRole('button', { name: 'Job queue', exact: true }).click();
  const copy = await downloadBy(page, () => page.getByRole('button', { name: 'Export project', exact: true }).click());
  expect(JSON.parse(new TextDecoder().decode(copy)).schemaVersion).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({ path: testInfo.outputPath('mobile-recovery.png'), fullPage: true });
});
