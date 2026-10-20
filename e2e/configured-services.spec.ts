import {nativeOutput} from '../tests/helpers/native-output';
import { openSettings, openSlicingSettings, openProjectMenu, openCameraOptions, openParts } from './navigation';
import { test, expect, type Page } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';
import { createApp } from '../server/app';
import { OnshapeHttpError } from '../server/onshape';
import { BAMBU_TARGET_VERSION, type CommandRunner } from '../server/slicer';
import type { SlicingFileConfig } from '../server/slicing-config';
import type { OnshapeTransport } from '../src/adapters/onshape';

// Explicit synthetic upstreams: real browser -> real Express -> real Onshape adapter,
// geometry conversion/preparation, process mapping, persisted worker and hash validation.
// No Onshape account, genuine CAD service response or Bambu executable is used here.
const sourceName = 'HTTP mock spacer · not real CAD';
const did = 'acde00000000000000000001', vid = 'acde00000000000000000002', eid = 'acde00000000000000000003';
const sourceLink = `https://cad.onshape.com/documents/${did}/v/${vid}/e/${eid}`;
const hash = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
const syntheticGcode = '; Synthetic injected CLI test output. Not machine validated.\nG21\nG90\nM82\nG92 E0\n;LAYER_CHANGE\n;Z:0.2\nG1 X30 Y30 Z0.2 F1200\n;TYPE:Outer wall\nG1 X40 Y30 E1\nG1 X40 Y40 E2\nG1 X30 Y40 E3\nG1 X30 Y30 E4\n';

async function startServices(page: Page) {
  const directory = await mkdtemp(path.join(tmpdir(), 'catalyst-browser-synthetic-services-'));
  const profilePath = (name: string) => path.join(directory, `${name}.json`);
  const machine = { type: 'machine', printer_model: 'SYNTHETIC TEST PRINTER', printer_variant: '0.4', nozzle_diameter: ['0.4'], printable_area: ['0x0', '256x0', '256x256', '0x256'], printable_height: '256', machine_start_gcode: '', machine_end_gcode: '', gcode_flavor: 'marlin', retraction_length: ['0.8'], retraction_speed: ['30'], z_hop: ['0.4'] };
  const filament = { type: 'filament', filament_type: ['PLA'], filament_diameter: ['1.75'], filament_density: ['1.24'], filament_flow_ratio: ['1'], filament_max_volumetric_speed: ['12'], nozzle_temperature: ['210'], nozzle_temperature_initial_layer: ['210'], textured_plate_temp: ['55'], textured_plate_temp_initial_layer: ['55'], filament_start_gcode: [''], filament_end_gcode: [''] };
  const processProfile = { type: 'process', layer_height: '0.2', initial_layer_print_height: '0.2', wall_loops: '4', sparse_infill_density: '30%', sparse_infill_pattern: 'grid', enable_support: '0', support_type: 'normal(auto)', brim_width: '3', outer_wall_speed: '100', inner_wall_speed: '100', sparse_infill_speed: '100', top_shell_layers: '4', bottom_shell_layers: '4', line_width: '0.42' };
  const pins: Record<string, { path: string; sha256: string }> = {};
  for (const [name, value] of Object.entries({ machine, filament, process: processProfile })) {
    const bytes = JSON.stringify(value);
    await writeFile(profilePath(name), bytes);
    pins[name] = { path: profilePath(name), sha256: hash(bytes) };
  }
  const executable = path.join(directory, 'synthetic-cli-not-bambu');
  await writeFile(executable, 'Synthetic file; the test injects a runner and never executes this file.');
  await chmod(executable, 0o700);
  const config: SlicingFileConfig = {
    executable, executableSha256: hash(await readFile(executable)), version: BAMBU_TARGET_VERSION,
    machine: pins.machine, filament: pins.filament, process: pins.process, completeProfilesReviewed: true,
    workRoot: path.join(directory, 'synthetic-worker'), profileLabel: 'SYNTHETIC TEST PROFILES · NOT QUALIFIED',
    printer: { id: 'synthetic-printer', model: 'SYNTHETIC TEST PRINTER', nozzleDiameter: 0.4, plate: 'Textured PEI Plate', buildVolume: [256, 256, 256], tested: false },
    material: { id: 'synthetic-filament', name: 'Synthetic test PLA', type: 'PLA', color: '#ed826f', tested: false },
  };
  let authorization = true, invalidDimensions = false, holdExport = false;
  let sliceMode: 'succeed' | 'fail' | 'hold' = 'succeed';
  const calls: string[] = [], sliceCalls: string[][] = [];
  const inchStl = (await readFile('public/fixtures/spacer.stl', 'utf8')).replace(/vertex\s+([\d.e+-]+)\s+([\d.e+-]+)\s+([\d.e+-]+)/gi, (_all, x, y, z) => `vertex ${Number(x) / 25.4} ${Number(y) / 25.4} ${Number(z) / 25.4}`);
  const transport: OnshapeTransport = { async request<T>(method: 'GET' | 'POST' | 'DELETE', requestPath: string, options?: { body?: unknown; signal?: AbortSignal; binary?: boolean }) {
    calls.push(`${method} ${requestPath}`);
    if (!authorization) throw new OnshapeHttpError(401, 'Synthetic upstream: authorization expired. Re-authorise Onshape on the server.');
    let result: unknown;
    if (/\/documents\?/.test(requestPath)) result = { items: [{ id: did, name: 'Synthetic upstream document · not connected' }] };
    else if (/\/versions\?/.test(requestPath)) result = [{ id: vid, name: 'Mock immutable version' }];
    else if (/\/elements$/.test(requestPath)) result = [{ id: eid, name: 'Mock separated parts', elementType: 'PARTSTUDIO' }];
    else if (/\/configuration$/.test(requestPath)) result = { configurationParameters: [] };
    else if (/\/boundingboxes\?/.test(requestPath)) result = { lowX: 0, lowY: 0, lowZ: 0, highX: 0.018, highY: 0.018, highZ: 0.012 };
    else if (/\/stl\?/.test(requestPath)) {
      if (holdExport) await new Promise<void>((resolve, reject) => { options?.signal?.addEventListener('abort', () => reject(new DOMException('Synthetic export cancelled', 'AbortError')), { once: true }); });
      result = new TextEncoder().encode(invalidDimensions ? await readFile('public/fixtures/spacer.stl', 'utf8') : inchStl).buffer;
    } else if (/\/parts\/d\//.test(requestPath)) result = [{ partId: 'TEST-PART', name: sourceName, bodyType: 'solid' }];
    else throw new Error(`Unexpected synthetic Onshape request: ${requestPath}`);
    return result as T;
  } };
  const runner: CommandRunner = async (_executable, args, options) => {
    if (args.includes('--help')) return { code: 0, output: `BambuStudio ${BAMBU_TARGET_VERSION} --load-settings --load-filaments --slice --export-3mf` };
    sliceCalls.push([...args]);
    options.onLog?.('Explicit synthetic CLI runner: no Bambu executable or machine was used.');
    if (sliceMode === 'hold') await new Promise<void>((resolve, reject) => { options.signal?.addEventListener('abort', () => reject(new Error('Synthetic slicing cancelled')), { once: true }); });
    if (sliceMode === 'fail') return { code: 42, output: 'Synthetic configured-slicer failure' };
    const output = nativeOutput(args);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, zipSync({ 'Metadata/plate_1.gcode': strToU8(syntheticGcode), 'Metadata/test-provenance.txt': strToU8('Synthetic browser regression, not real slicing.') }));
    return { code: 0, output: 'Synthetic worker wrote its test archive.' };
  };
  const app = await createApp({ dataDirectory: directory, onshape: { transport }, slicing: { config, runner } });
  const server: Server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Synthetic services did not bind.');
  const base = `http://127.0.0.1:${address.port}`;
  await page.route('**/api/**', async route => { const upstream = await route.fetch({ url: base + new URL(route.request().url()).pathname + new URL(route.request().url()).search }); await route.fulfill({ response: upstream }); });
  return {
    calls, sliceCalls,
    setAuthorization(value: boolean) { authorization = value; },
    setInvalidDimensions(value: boolean) { invalidDimensions = value; },
    setHoldExport(value: boolean) { holdExport = value; },
    setSliceMode(value: typeof sliceMode) { sliceMode = value; },
    async close() {
      const jobs = await fetch(base + '/api/slicing/jobs').then(response => response.json()).catch(() => ({ jobs: [] }));
      await Promise.all((jobs.jobs ?? []).filter((job: { status: string }) => ['queued', 'running'].includes(job.status)).map((job: { id: string }) => fetch(base + `/api/slicing/jobs/${job.id}/cancel`, { method: 'POST' })));
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await rm(directory, { recursive: true, force: true });
    },
  };
}

async function selectLiveMock(page: Page) {
  await page.getByRole('button', { name: 'Select design', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Bring your design into Foundry', exact: true });
  await dialog.getByLabel('Onshape document link', { exact: true }).fill(sourceLink);
  await dialog.getByRole('button', { name: 'Open design', exact: true }).click();
  await expect(dialog.getByLabel('Immutable Onshape version', { exact: true })).toHaveValue(vid);
  await expect(dialog.getByLabel('Onshape source element', { exact: true })).toHaveValue(eid);
  await dialog.getByRole('button', { name: 'Load parts', exact: true }).click();
  await expect(dialog.getByLabel(`Manufacturing choice for ${sourceName}`, { exact: true })).toHaveValue('review');
  await dialog.getByRole('button', { name: 'Mark selected as make', exact: true }).click();
  await dialog.getByLabel(`Live spares for ${sourceName}`, { exact: true }).fill('2');
  return dialog;
}

test('configured HTTP workflow uses real services with explicit mock Onshape upstream and synthetic CLI runner', async ({ page }) => {
  const services = await startServices(page);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto('/');
    const dialog = await selectLiveMock(page);
    await dialog.getByRole('button', { name: 'Transfer selected parts', exact: true }).click();
    await expect(dialog.getByText('18.00 × 18.00 × 12.00 mm · 1 CAD + 2 spare', { exact: true })).toBeVisible();
    await expect(page.locator('.part-card')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Add verified parts', exact: true })).toBeDisabled();
    await dialog.getByLabel('I checked the imported dimensions against Onshape.', { exact: true }).check();
    await dialog.getByRole('button', { name: 'Add verified parts', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('.part-card')).toHaveCount(1);
    await expect(page.getByLabel('Required quantity', { exact: true })).toHaveValue('1');
    await expect(page.getByLabel('Backup parts', { exact: true })).toHaveValue('2');
    await page.getByRole('button', { name: '03 Slice & inspect', exact: true }).click();
    await openSlicingSettings(page);
    await expect(page.getByText('Offline CLI configured', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Use configured printer & profiles', exact: true }).click();
    await page.getByRole('button', { name: 'Slice exact job', exact: true }).click();
    await expect(page.getByLabel('Slicing job status', { exact: true })).toContainText('succeeded');
    await page.getByRole('button', { name: 'Review generated toolpath', exact: true }).click();
    await expect(page.getByText('CURRENT', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Toolpath layer', { exact: true })).toBeVisible();
    await page.getByLabel('Toolpath layer', { exact: true }).fill('0');
    await mkdir('docs/guided-workflow', { recursive: true });
    await page.screenshot({ path: 'docs/guided-workflow/configured-http-synthetic-result.png', fullPage: true });
    await page.getByRole('button', { name: '04 Approve', exact: true }).click();
    await page.getByLabel('Reviewer name', { exact: true }).fill('Synthetic HTTP regression reviewer');
    await page.getByLabel('Confirm toolpath review', { exact: true }).check();
    await page.getByLabel('Confirm manufacturing manifest', { exact: true }).check();
    await page.getByRole('button', { name: 'Approve exact job', exact: true }).click();
    await expect(page.getByText('APPROVED', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '05 Export', exact: true }).click();
    for (const name of ['Selected machine matches the package', 'Loaded material matches the mapping', 'Installed nozzle matches the profile', 'Build plate matches the profile', 'Bed is clear and ready']) await page.getByLabel(name, { exact: true }).check();
    const waiting = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export approved package', exact: true }).click();
    const download = await waiting;
    const bytes = await readFile((await download.path())!);
    const archive = unzipSync(bytes), manifest = JSON.parse(strFromU8(archive['manifest.json']));
    expect(manifest.demonstrationOnly).toBe(true);
    expect(manifest.dispatchPerformed).toBe(false);
    expect(manifest.parts[0].source).toMatchObject({ kind: 'onshape', documentId: did, versionId: vid, elementId: eid });
    expect(manifest.parts[0].totalQuantity).toBe(3);
    expect(manifest.toolpathHash).toBe(hash(syntheticGcode));
    expect(Object.keys(archive).some(name => name.endsWith('.3mf'))).toBe(true);
    expect(services.sliceCalls).toHaveLength(1);
    expect(services.sliceCalls[0]).toEqual(expect.arrayContaining(['--arrange', '0', '--slice', '--export-3mf']));
    await page.getByRole('button', { name: 'Save project', exact: true }).click();
    await expect(page.getByText('Project saved to this cloud workspace.', { exact: true })).toBeVisible();
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.getByRole('button', { name: '04 Approve', exact: true }).click();
    await expect(page.getByText('APPROVED', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '02 Prepare', exact: true }).click();
    await openSettings(page,'part');
    await page.getByText('Manual placement and rotation', { exact: true }).click();
    await page.getByLabel('Rotate Z', { exact: true }).fill('90');
    await page.getByRole('button', { name: '04 Approve', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Approve exact job', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '05 Export', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Export approved package', exact: true })).toBeDisabled();
    let releasePreparation!: () => void, requestedPreparation!: () => void;
    const preparationRequested = new Promise<void>(resolve => { requestedPreparation = resolve; });
    const preparationRelease = new Promise<void>(resolve => { releasePreparation = resolve; });
    await page.route('**/api/slicing/prepare', async route => { requestedPreparation(); await preparationRelease; await route.fallback(); });
    await page.getByRole('button', { name: '03 Slice & inspect', exact: true }).click();
    await openSlicingSettings(page);
    await page.getByRole('button', { name: 'Slice exact job', exact: true }).click();
    await preparationRequested;
    await page.getByRole('button', { name: '02 Prepare', exact: true }).click();
    await page.getByLabel('Rotate Z', { exact: true }).fill('180');
    releasePreparation();
    await expect(page.getByRole('alert')).toContainText('no slice was queued');
    expect(services.sliceCalls).toHaveLength(1);
    await page.unroute('**/api/slicing/prepare');
    await page.getByRole('button', { name: 'Dismiss error', exact: true }).click();
    let releaseProfile!: () => void, requestedProfile!: () => void;
    const profileRequested = new Promise<void>(resolve => { requestedProfile = resolve; });
    const profileRelease = new Promise<void>(resolve => { releaseProfile = resolve; });
    await page.route('**/api/slicing/profile', async route => { requestedProfile(); await profileRelease; await route.fallback(); });
    await page.getByRole('button', { name: '03 Slice & inspect', exact: true }).click();
    await openSlicingSettings(page);
    await page.getByRole('button', { name: 'Use configured printer & profiles', exact: true }).click();
    await profileRequested;
    await page.getByRole('button', { name: '02 Prepare', exact: true }).click();
    await openSettings(page,'process');
    await page.getByLabel('Nozzle', { exact: true }).selectOption('0.6');
    releaseProfile();
    await expect(page.getByRole('alert')).toContainText('The job changed while profiles were loading');
    await expect(page.getByLabel('Nozzle', { exact: true })).toHaveValue('0.6');
    await page.unroute('**/api/slicing/profile');
    expect(services.calls.some(call => call.includes('/stl?mode=text&units=inch&scale=1'))).toBe(true);
    expect(errors).toEqual([]);
  } finally { await services.close(); }
});

test('configured HTTP failures recover from expired access, wrong units, cancelled imports, slicer failure and cancellation', async ({ page }) => {
  const services = await startServices(page);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto('/');
    services.setAuthorization(false);
    await page.getByRole('button', { name: 'Select design', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Bring your design into Foundry', exact: true });
    await dialog.getByLabel('Onshape document link', { exact: true }).fill(sourceLink);
    await dialog.getByRole('button', { name: 'Open design', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('authorization expired');
    await expect(page.locator('.part-card')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
    services.setAuthorization(true);
    dialog = await selectLiveMock(page);
    services.setInvalidDimensions(true);
    await dialog.getByRole('button', { name: 'Transfer selected parts', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText(/dimension|unit|scale/i);
    await expect(page.locator('.part-card')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Add verified parts', exact: true })).toHaveCount(0);
    services.setInvalidDimensions(false); services.setHoldExport(true);
    await dialog.getByRole('button', { name: 'Transfer selected parts', exact: true }).click();
    await dialog.getByRole('button', { name: 'Cancel transfer', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText(/cancelled/i);
    await expect(page.locator('.part-card')).toHaveCount(0);
    services.setHoldExport(false);
    await dialog.getByRole('button', { name: 'Transfer selected parts', exact: true }).click();
    await dialog.getByLabel('I checked the imported dimensions against Onshape.', { exact: true }).check();
    await dialog.getByRole('button', { name: 'Add verified parts', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await page.getByRole('button', { name: '03 Slice & inspect', exact: true }).click();
    await openSlicingSettings(page);
    await page.getByRole('button', { name: 'Use configured printer & profiles', exact: true }).click();
    services.setSliceMode('fail');
    await page.getByRole('button', { name: 'Slice exact job', exact: true }).click();
    await expect(page.getByLabel('Slicing job status', { exact: true })).toContainText('failed');
    await expect(page.getByLabel('Slicing job status', { exact: true })).toContainText('code 42');
    await expect(page.getByRole('button', { name: 'Review generated toolpath', exact: true })).toHaveCount(0);
    services.setSliceMode('hold');
    await page.route('**/api/slicing/jobs/*', route => route.request().method() === 'GET'
      ? route.fulfill({ status: 503, json: { error: 'Synthetic status-service outage' } })
      : route.fallback());
    await page.getByRole('button', { name: 'Slice exact job', exact: true }).click();
    await expect(page.getByText('Status disconnected:', { exact: false })).toBeVisible();
    await page.unroute('**/api/slicing/jobs/*');
    await page.getByRole('button', { name: 'Refresh job status', exact: true }).click();
    await expect(page.getByLabel('Slicing job status', { exact: true })).toContainText('running');
    await page.getByRole('button', { name: 'Cancel slicing', exact: true }).click();
    await expect(page.getByLabel('Slicing job status', { exact: true })).toContainText('cancelled');
    await expect(page.getByRole('button', { name: 'Review generated toolpath', exact: true })).toHaveCount(0);
    services.setSliceMode('succeed');
    await page.getByRole('button', { name: 'Slice exact job', exact: true }).click();
    await expect(page.getByLabel('Slicing job status', { exact: true })).toContainText('succeeded');
    await page.getByRole('button', { name: 'Review generated toolpath', exact: true }).click();
    await expect(page.getByText('CURRENT', { exact: true })).toBeVisible();
    expect(services.sliceCalls).toHaveLength(3);
    await page.screenshot({ path: 'docs/guided-workflow/configured-http-recovery.png', fullPage: true });
    expect(errors).toEqual([]);
  } finally { await services.close(); }
});
