import { openSettings, openSlicingSettings, openProjectMenu, openCameraOptions, openParts } from './navigation';
import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { unzipSync, strFromU8 } from 'fflate';
import { createApp } from '../server/app';

test.use({ video: { mode: 'on', size: { width: 1512, height: 1050 } } });
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus || info.status === 'skipped') return;
  const video = page.video(); await page.close();
  if (video) await video.saveAs('docs/guided-workflow/actual-offline-slicing.webm');
});

test('genuine pinned Bambu CLI slices fixture geometry and requires native review for unsupported machine commands', async ({ page }) => {
  test.setTimeout(180_000); // Real Windows runtime integrity checks and slicing are disk/CPU work.
  test.skip(!process.env.CATALYST_REAL_SLICE_CONFIG, 'Provide an explicitly reviewed offline configuration and runtime libraries to exercise the genuine Bambu executable.');
  // CAD is explicitly a fixture; the executable, full profiles, worker process and
  // resulting native G-code are genuine. No printer or cloud account is connected.
  const directory = await mkdtemp(path.join(tmpdir(), 'catalyst-actual-browser-slice-'));
  const app = await createApp({ dataDirectory: directory, slicing: { configPath: process.env.CATALYST_REAL_SLICE_CONFIG } });
  const server: Server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Real slicer test server failed to bind.');
  const base = `http://127.0.0.1:${address.port}`;
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      const response = await route.fetch({ url: base + url.pathname + url.search });
      await route.fulfill({ response });
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Try demonstration fixtures', exact: false }).click();
    const source = page.getByRole('dialog', { name: 'Bring your design into Foundry', exact: true });
    for (const name of ['Idler pulley · 48 mm', 'Shaft spacer · 12 mm', 'Sensor enclosure']) await source.getByLabel(`Select ${name}`, { exact: true }).uncheck();
    await source.getByLabel('Spares for Intake mounting bracket', { exact: true }).fill('1');
    await source.getByRole('button', { name: 'Import selected parts', exact: true }).click();
    await expect(source).not.toBeVisible();
    await openSettings(page,'part');
    await page.getByText('Manual placement and rotation', { exact: true }).click();
    await page.getByLabel('Rotate X', { exact: true }).fill('90');
    await page.getByLabel('Position X', { exact: true }).fill('80');
    await page.getByLabel('Position Y', { exact: true }).fill('80');
    await page.getByRole('button', { name: '03 Slice & inspect', exact: true }).click();
    await openSlicingSettings(page);
    await expect(page.getByText('Offline CLI configured', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Use configured printer & profiles', exact: true }).click();
    await page.getByRole('button', { name: 'Slice exact job', exact: true }).click();
    await expect(page.getByLabel('Slicing job status', { exact: true })).toContainText('succeeded', {timeout:90_000});
    await expect(page.getByText('Actual slicing finished, but its commands cannot be fully inspected here.', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Review generated toolpath', exact: true })).toHaveCount(0);
    await expect(page.getByText('CURRENT', { exact: true })).toHaveCount(0);
    const commandSummary = page.locator('summary').filter({ hasText: /^Unsupported command details/ });
    const commandDetails = commandSummary.locator('..');
    await expect(commandDetails.getByRole('list')).not.toBeVisible();
    await commandSummary.click();
    await expect(commandDetails.getByRole('listitem').first()).toContainText(/unsupported/i);
    await commandSummary.click();
    await expect(commandDetails.getByRole('list')).not.toBeVisible();
    const waiting = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download native slicer project', exact: true }).click();
    const native = await readFile((await (await waiting).path())!);
    const archive = unzipSync(native), toolpaths = Object.keys(archive).filter(name => /plate_\d+\.gcode$/.test(name));
    expect(toolpaths).toHaveLength(1);
    const gcode = strFromU8(archive[toolpaths[0]]);
    expect(gcode).toContain('BambuStudio');
    expect(gcode).toContain('G1');
    await mkdir('docs/guided-workflow', { recursive: true });
    await writeFile('docs/guided-workflow/actual-browser-sliced-NON-MANUFACTURABLE.3mf', native);
    const jobs = await fetch(base + '/api/slicing/jobs').then(response => response.json());
    const job = jobs.jobs[0];
    expect(job.result.previewSupported).toBe(false);
    expect(job.result.demonstration).toBe(false);
    await writeFile('docs/guided-workflow/actual-browser-slicing.json', JSON.stringify({
      cad: 'Explicit demonstration fixture; not real team CAD', runtime: 'Genuine pinned Bambu CLI; no synthetic runner',
      machineOperated: false, accountsConnected: false, physicalProfilesQualified: false,
      status: job.status, nativeProjectHash: createHash('sha256').update(native).digest('hex'),
      toolpathHash: job.result.toolpathHash, slicerVersion: job.result.slicerVersion,
      previewSupported: job.result.previewSupported, unsupportedCommands: job.result.previewIssues,
      approvalAllowed: false,
    }, null, 2) + '\n');
    await page.getByRole('heading', { name: 'Slice with Bambu Studio', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'docs/guided-workflow/genuine-offline-slicing-native-review.png', fullPage: true });
    await page.getByRole('button', { name: '04 Approve', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Approve exact job', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '05 Export', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Export approved package', exact: true })).toBeDisabled();
    expect(errors).toEqual([]);
  } finally {
    const jobs = await fetch(base + '/api/slicing/jobs').then(response => response.json()).catch(() => ({ jobs: [] }));
    for (const job of jobs.jobs) if (['queued', 'running'].includes(job.status)) await fetch(base + `/api/slicing/jobs/${job.id}/cancel`, { method: 'POST' });
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
