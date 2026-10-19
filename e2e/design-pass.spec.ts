import { openSettings, openSlicingSettings, openProjectMenu, openCameraOptions, openParts } from './navigation';
import { test, expect, type Page } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createJob, createProject, type Project } from '../src/domain/model';
import { fixtureDefaultSelection, importFixtureParts } from '../src/adapters/onshape';

/** These focused browser regressions use explicitly labelled CAD fixtures and an in-memory
 * persistence service. core.spec.ts separately proves the complete flow with real disk I/O. */
async function preparedProject(includeSpacer = false): Promise<Project> {
  const parts = await importFixtureParts({ ...fixtureDefaultSelection, partIds: includeSpacer ? ['bracket', 'spacer'] : ['bracket'] }, {
    delayMs: 0,
    fetcher: (async (input: string | URL | Request) => {
      const filename = String(input).split('/').at(-1)!;
      return new Response(await readFile(path.resolve('public/fixtures', filename), 'utf8'));
    }) as typeof fetch,
  });
  const project = createProject('Design pass · fixture browser regression');
  project.parts = parts;
  project.jobs = [createJob(parts, 'Intake brackets · V18')];
  project.jobs[0].items[0].position = [44, 50, 0];
  if (includeSpacer) project.jobs[0].items[1].position = [200, 50, 0];
  project.activeJobId = project.jobs[0].id;
  return project;
}

async function memoryService(page: Page, initial: Project) {
  let saved = structuredClone(initial);
  await page.route('**/api/project', async route => {
    if (route.request().method() === 'PUT') {
      saved = route.request().postDataJSON() as Project;
      await route.fulfill({ json: { saved: true, id: saved.id } });
    } else await route.fulfill({ json: { project: saved } });
  });
  return () => saved;
}

async function inspector(page: Page, tab: 'Part inspector' | 'Process inspector' | 'Preflight checks') {
  await page.getByRole('button', { name: '02 Prepare', exact: true }).click();
  await openSettings(page,tab==='Part inspector'?'part':tab==='Process inspector'?'process':'checks');
  const advanced = page.locator('summary').filter({ hasText: tab === 'Part inspector' ? /^Manual placement and rotation$/ : /^Advanced slicing settings/ });
  if (tab !== 'Preflight checks' && await advanced.count()) {
    const details = advanced.locator('..');
    if (await details.getAttribute('open') === null) await advanced.click();
  }
}

async function bindDemo(page: Page) {
  await page.getByRole('button', { name: '03 Slice & inspect', exact: true }).click();
  await openSlicingSettings(page);
  await page.getByRole('button', { name: 'Load demonstration toolpath', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Bind an imported toolpath' });
  await expect(dialog.getByText('NON-MANUFACTURABLE DEMONSTRATION', { exact: true })).toBeVisible();
  await dialog.getByLabel('Confirm imported toolpath mapping').check();
  await dialog.getByRole('button', { name: 'Attach to current manifest', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('CURRENT', { exact: true })).toBeVisible();
}

async function approveDemo(page: Page) {
  await page.getByRole('button', { name: '04 Approve', exact: true }).click();
  await page.getByLabel('Reviewer name', { exact: true }).fill('Browser regression · lead');
  await page.getByLabel('Confirm toolpath review', { exact: true }).check();
  await page.getByLabel('Confirm manufacturing manifest', { exact: true }).check();
  const button = page.getByRole('button', { name: 'Approve exact job', exact: true });
  await expect(button).toBeEnabled();
  // Two synchronous user events reproduce a duplicate action without skipping the
  // application's lock or mutating state from the test.
  await button.evaluate(element => { (element as HTMLButtonElement).click(); (element as HTMLButtonElement).click(); });
  await expect(page.getByText('APPROVED', { exact: true })).toBeVisible();
}

async function assertBlocked(page: Page) {
  await page.getByRole('button', { name: '04 Approve', exact: true }).click();
  await expect(page.getByLabel('Confirm toolpath review', { exact: true })).not.toBeChecked();
  await expect(page.getByLabel('Confirm manufacturing manifest', { exact: true })).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Approve exact job', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '05 Export', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Export approved package', exact: true })).toBeDisabled();
}

async function capture(page: Page, name: string) {
  await mkdir('docs/guided-workflow', { recursive: true });
  await page.screenshot({ path: `docs/guided-workflow/${name}.png`, fullPage: true });
}

/** Read rendered WebGL pixels immediately after a genuine camera interaction. A mocked
 * canvas or background-only render cannot satisfy the visible coral-geometry check. */
async function renderedGeometry(page: Page, key: '1' | '2' | '3') {
  return page.getByRole('img', { name: 'Interactive 3D manufacturing workspace.', exact: false }).evaluate((element, cameraKey) => {
    const canvas = element as HTMLCanvasElement;
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: cameraKey, bubbles: true }));
    const copy = document.createElement('canvas'); copy.width = canvas.width; copy.height = canvas.height;
    const context = copy.getContext('2d')!; context.drawImage(canvas, 0, 0);
    const data = context.getImageData(0, 0, copy.width, copy.height).data;
    let pixels = 0, minX = copy.width, minY = copy.height, maxX = 0, maxY = 0;
    for (let y = 0; y < copy.height; y++) for (let x = 0; x < copy.width; x++) {
      const offset = (y * copy.width + x) * 4;
      if (data[offset] > 90 && data[offset] > data[offset + 1] * 1.18 && data[offset] > data[offset + 2] * 1.18 && data[offset + 3] > 0) {
        pixels++; minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
    }
    return { pixels, minX, minY, maxX, maxY, width: copy.width, height: copy.height, webgl: !!canvas.getContext('webgl2') };
  }, key);
}

test('manufacturing mapping revocation, changed material, orientation and reopen invalidate approval', async ({ page }) => {
  const current = await memoryService(page, await preparedProject());
  const browserErrors: string[] = []; page.on('pageerror', error => browserErrors.push(error.message));
  await page.goto('/');
  await expect(page.locator('.part-card')).toHaveCount(1);
  await bindDemo(page);
  await approveDemo(page);
  await page.getByRole('button', { name: 'Save project', exact: true }).click();
  await expect(page.getByText('Project saved to this cloud workspace.', { exact: true })).toBeVisible();
  expect(current().jobs[0].reviews.filter(event => event.action === 'approved')).toHaveLength(1);

  await page.getByRole('button', { name: '03 Slice & inspect', exact: true }).click();

  await openSlicingSettings(page);
  await page.getByRole('button', { name: 'Revoke toolpath mapping', exact: true }).click();
  const revoke = page.getByRole('dialog', { name: 'Revoke toolpath mapping', exact: true });
  await expect(revoke.getByRole('button', { name: 'Revoke mapping', exact: true })).toBeDisabled();
  await revoke.getByLabel('Mapping revocation reason', { exact: true }).fill('Geometry-to-toolpath association withdrawn during manufacturing review.');
  await revoke.getByRole('button', { name: 'Revoke mapping', exact: true }).click();
  await expect(revoke).not.toBeVisible();
  await assertBlocked(page);
  await page.getByRole('button', { name: 'Save project', exact: true }).click();
  await expect.poll(() => current().jobs[0].toolpath?.mappingConfirmed).toBe(false);
  expect(current().jobs[0].approval).toBeUndefined();
  expect(current().jobs[0].toolpath?.reviewedAt).toBeUndefined();
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await assertBlocked(page);

  await bindDemo(page);
  await approveDemo(page);
  await page.getByRole('button', { name: '02 Prepare', exact: true }).click();
  await inspector(page, 'Process inspector');
  await page.getByLabel('Filament', { exact: true }).selectOption('PLA');
  await assertBlocked(page);
  await bindDemo(page);
  await approveDemo(page);
  await page.getByRole('button', { name: '02 Prepare', exact: true }).click();
  await inspector(page, 'Part inspector');
  await page.getByLabel('Rotate X', { exact: true }).fill('90');
  await assertBlocked(page);
  await page.getByRole('button', { name: 'Save project', exact: true }).click();
  await expect.poll(() => current().jobs[0].items[0].orientation[0]).toBe(90);
  expect(current().jobs[0].toolpath?.stale).toBe(true);
  expect(current().jobs[0].approval).toBeUndefined();
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await inspector(page, 'Part inspector');
  await expect(page.getByLabel('Rotate X', { exact: true })).toHaveValue('90');
  await assertBlocked(page);
  expect(browserErrors).toEqual([]);
});

test('camera keeps real geometry visible through desktop, tablet and mobile resize and navigation', async ({ page }) => {
  // Explicit fixture intake: first launch must not silently create demonstration jobs.
  await page.route('**/api/project', route => route.fulfill({ json: { project: null } }));
  await page.goto('/');
  await expect(page.locator('.part-card')).toHaveCount(0);
  await page.getByRole('button', { name: 'Select design', exact: true }).click();
  const source = page.getByRole('dialog', { name: 'Bring your design into Foundry' });
  await source.getByRole('tab', { name: 'Demonstration fixtures', exact: true }).click();
  await source.getByRole('button', { name: 'Import selected parts', exact: true }).click();
  await expect(source).not.toBeVisible();
  await expect(page.locator('.part-card')).toHaveCount(4);
  const canvas = page.getByRole('img', { name: 'Interactive 3D manufacturing workspace.', exact: false });
  await expect(canvas).toBeVisible();
  for (const [name, width, height] of [['desktop', 1512, 1000], ['tablet', 1024, 800], ['mobile', 390, 844]] as const) {
    await page.setViewportSize({ width, height });
    await openCameraOptions(page);
    await page.getByRole('button', { name: 'Top view', exact: true }).click();
    await page.getByRole('button', { name: 'Fit to view', exact: true }).click();
    await expect.poll(async () => (await renderedGeometry(page, '2')).pixels).toBeGreaterThan(200);
    const render = await renderedGeometry(page, '2');
    expect(render.webgl).toBe(true);
    expect(render.minX).toBeGreaterThan(8);
    expect(render.minY).toBeGreaterThan(8);
    expect(render.maxX).toBeLessThan(render.width - 8);
    expect(render.maxY).toBeLessThan(render.height - 8);
    const bounds = await canvas.boundingBox(); expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeGreaterThan(width === 390 ? 300 : 350);
    expect(bounds!.height).toBeGreaterThan(300);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await openCameraOptions(page);
    await page.getByRole('button', { name: 'Isometric view', exact: true }).click();
    await expect.poll(async () => (await renderedGeometry(page, '1')).pixels).toBeGreaterThan(200);
    await capture(page, `after-${name}`);
  }
  await page.setViewportSize({ width: 1512, height: 1050 });
  const grid = page.getByRole('button', { name: 'Toggle plate grid', exact: true });
  await expect(grid).toHaveAttribute('aria-pressed', 'true');
  await grid.click();
  await expect(grid).toHaveAttribute('aria-pressed', 'false');
  await grid.click();
  await page.getByRole('button', { name: 'Part', exact: true }).click();
  await expect.poll(async () => (await renderedGeometry(page, '1')).pixels).toBeGreaterThan(200);
  await page.getByRole('button', { name: 'Build plate', exact: true }).click();
  const bounds = await canvas.boundingBox();
  const middle = { x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 };
  await page.mouse.move(middle.x, middle.y); await page.mouse.down();
  await page.mouse.move(middle.x + 65, middle.y + 35, { steps: 6 }); await page.mouse.up();
  await page.mouse.down({ button: 'right' }); await page.mouse.move(middle.x + 85, middle.y + 45, { steps: 4 }); await page.mouse.up({ button: 'right' });
  await page.mouse.wheel(0, -90);
  const orbitBeforeSetting = await canvas.screenshot();
  await inspector(page, 'Process inspector');
  await page.getByLabel('Wall loops', { exact: true }).fill('5');
  const orbitAfterSetting = await canvas.screenshot();
  expect(Buffer.compare(orbitBeforeSetting, orbitAfterSetting), 'Changing process settings must preserve the camera.').toBe(0);
  await page.getByRole('button', { name: 'Fit to view', exact: true }).click();
  await expect.poll(async () => (await renderedGeometry(page, '3')).pixels).toBeGreaterThan(200);
  await openProjectMenu(page);
  await page.getByRole('button', { name: 'Job queue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Manufacturing queue', exact: true })).toBeVisible();
  await page.getByLabel('Search jobs', { exact: true }).fill('not present');
  await expect(page.getByRole('heading', { name: 'No matching jobs', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await page.getByLabel('Queue status filter', { exact: true }).selectOption('approved');
  await expect(page.getByRole('heading', { name: 'No matching jobs', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await capture(page, 'after-queue');
  await page.getByRole('button', { name: 'Open job', exact: true }).click();
  await expect(canvas).toBeVisible();
});

test('explainable preparation, quantity reconciliation, preflight links, presets and revision isolation', async ({ page }) => {
  const original = await preparedProject(true);
  const current = await memoryService(page, original);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await inspector(page, 'Part inspector');
  await expect(page.getByLabel('Required quantity', { exact: true })).toHaveValue('2');
  await page.getByLabel('Required quantity', { exact: true }).fill('1');
  await page.getByLabel('Backup parts', { exact: true }).fill('2');
  await inspector(page, 'Preflight checks');
  await expect(page.getByText('1 below CAD demand · manual override', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Fix: Intake mounting bracket: planned quantity differs from CAD demand.', exact: true }).click();
  await expect(page.getByLabel('Required quantity', { exact: true })).toBeFocused();
  await expect(page.getByLabel('Required quantity', { exact: true })).toHaveValue('1');
  await inspector(page, 'Preflight checks');
  await page.getByRole('button', { name: 'Use CAD quantity for Intake mounting bracket', exact: true }).click();
  await inspector(page, 'Part inspector');
  await expect(page.getByLabel('Required quantity', { exact: true })).toHaveValue('2');
  await expect(page.getByLabel('Backup parts', { exact: true })).toHaveValue('2');
  await page.getByLabel('Position X', { exact: true }).fill('100');
  await expect(page.locator('.projectmeta .tag').filter({ hasText: /^needs review$/ })).toBeVisible();
  await inspector(page, 'Preflight checks');
  await page.getByRole('button', { name: 'Fix: Intake mounting bracket and Shaft spacer · 12 mm: geometry bounds overlap.', exact: true }).first().click();
  await expect(page.getByLabel('Position X', { exact: true })).toBeFocused();
  await page.getByLabel('Position X', { exact: true }).fill('400');
  await inspector(page, 'Preflight checks');
  await page.getByRole('button', { name: 'Fix: Intake mounting bracket, copy 1: outside the build volume.', exact: true }).click();
  await expect(page.getByLabel('Position X', { exact: true })).toBeFocused();
  await page.getByText('Build-volume suggestion', { exact: true }).click();
  await expect(page.getByText('4 including spares', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Apply placement suggestion', exact: true }).click();
  await expect(page.getByLabel('Position X', { exact: true })).not.toHaveValue('400');
  await expect(page.getByText('Within build volume', { exact: true })).toBeVisible();
  await expect(page.locator('.projectmeta .tag').filter({ hasText: /^ready to slice$/ })).toBeVisible();
  await page.getByText('Orientation alternatives', { exact: true }).click();
  const candidate = page.locator('.candidate').filter({ hasText: 'Turn 90° around X' });
  await candidate.getByText('Why / assumptions', { exact: true }).click();
  await expect(candidate.getByText('Inspect the layer direction against team-reviewed loads; no weak sections or safety factors have been calculated.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Apply orientation Turn 90° around X', exact: true }).click();
  await expect(page.getByLabel('Rotate X', { exact: true })).toHaveValue('90');
  await page.getByRole('button', { name: 'Loads & critical surfaces need team review', exact: false }).click();
  const guidance = page.getByRole('dialog', { name: 'Orientation & strength review', exact: true });
  await expect(guidance.getByLabel('Confirm load context', { exact: true })).toBeDisabled();
  await guidance.getByLabel('Intended use', { exact: true }).fill('Sensor mounting through the existing two bolt interfaces.');
  await guidance.getByLabel('Load directions', { exact: true }).fill('Unknown; team load study and physical validation required.');
  await guidance.getByLabel('Critical constraints', { exact: true }).fill('Bolt-hole alignment and the sensor reference face require dimensional review.');
  await guidance.getByLabel('Operating conditions', { exact: true }).fill('Indoor robot operation; exact temperature and impact envelope not yet established.');
  await guidance.getByLabel('Confirm load context', { exact: true }).check();
  await guidance.getByRole('button', { name: 'Save review context', exact: true }).click();
  await page.getByLabel('Inspect installed CAD orientation', { exact: false }).check();
  await expect(page.getByLabel('Rotate X', { exact: true })).toHaveValue('90');
  await page.getByLabel('Inspect installed CAD orientation', { exact: false }).uncheck();
  await inspector(page, 'Process inspector');
  await page.getByLabel('Part category', { exact: true }).selectOption('enclosure');
  await page.getByLabel('Layer height', { exact: true }).fill('0.01');
  await inspector(page, 'Preflight checks');
  await page.getByRole('button', { name: 'Fix: Layer height is outside the supported adapter range.', exact: true }).click();
  await expect(page.getByLabel('Layer height', { exact: true })).toBeFocused();
  await page.getByLabel('Layer height', { exact: true }).fill('0.18');
  await page.getByLabel('Wall loops', { exact: true }).fill('7');
  await page.getByLabel('Infill', { exact: true }).fill('25');
  await page.getByLabel('Supports', { exact: true }).selectOption('true');
  await page.getByLabel('Brim width', { exact: true }).fill('4');
  await page.getByLabel('Print speed', { exact: true }).fill('90');
  await page.getByLabel('Nozzle', { exact: true }).selectOption('0.6');
  await page.getByLabel('Filament', { exact: true }).selectOption('ASA');
  await page.getByRole('button', { name: 'Apply example base profile', exact: true }).click();
  await expect(page.getByLabel('Wall loops', { exact: true })).toHaveValue('7');
  await expect(page.getByLabel('Layer height', { exact: true })).toHaveValue('0.18');
  await page.getByRole('button', { name: 'Save team preset', exact: true }).click();
  const preset = page.getByRole('dialog', { name: 'Save team process preset', exact: true });
  await preset.getByLabel('Preset name', { exact: true }).fill('Team enclosure · review required');
  await preset.getByRole('button', { name: 'Save preset', exact: true }).click();
  await page.getByRole('button', { name: 'Reset overrides', exact: true }).click();
  await page.getByRole('dialog', { name: 'Reset process overrides', exact: true }).getByRole('button', { name: 'Reset to base profile', exact: true }).click();
  await expect(page.getByLabel('Wall loops', { exact: true })).toHaveValue('3');
  await page.getByLabel('Team preset', { exact: true }).selectOption({ label: 'Team enclosure · review required · untested' });
  await expect(page.getByLabel('Wall loops', { exact: true })).toHaveValue('7');
  await expect(page.getByLabel('Infill', { exact: true })).toHaveValue('25');
  await expect(page.getByLabel('Supports', { exact: true })).toHaveValue('true');
  await page.getByRole('button', { name: 'Save project', exact: true }).click();
  await expect.poll(() => current().teamPresets.length).toBe(1);
  expect(current().teamPresets[0]).toMatchObject({ tested: false, printer: { nozzleDiameter: 0.6 }, material: { type: 'ASA' }, settings: { walls: 7, infill: 25, supports: true } });
  expect(current().jobs[0].useCase.confirmed).toBe(true);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await inspector(page, 'Process inspector');
  await expect(page.getByLabel('Team preset', { exact: true }).locator('option')).toHaveCount(2);
  await expect(page.getByLabel('Wall loops', { exact: true })).toHaveValue('7');
  await bindDemo(page);
  await approveDemo(page);
  await page.getByRole('button', { name: '02 Prepare', exact: true }).click();
  await page.getByRole('button', { name: 'V19 fixture update · review changes', exact: true }).click();
  const revision = page.getByRole('dialog', { name: 'Source revision review', exact: true });
  await expect(revision.getByText('Exported geometry changed', { exact: false })).toBeVisible();
  await expect(revision.getByText('Live revision checks unavailable · fixture comparison only', { exact: true })).toBeVisible();
  await revision.getByRole('button', { name: 'Create separate revision job', exact: true }).click();
  await page.getByRole('button', { name: 'Save project', exact: true }).click();
  await expect.poll(() => current().jobs.length).toBe(2);
  const oldJob = current().jobs[0], newJob = current().jobs[1];
  expect(oldJob.approval).toBeDefined();
  expect(oldJob.items[0].quantity).toBe(2);
  expect(oldJob.items[0].spareQuantity).toBe(2);
  expect(newJob.toolpath).toBeUndefined();
  expect(newJob.approval).toBeUndefined();
  expect(current().parts.find(part => part.id === oldJob.items[0].partId)?.geometry.hash).toBe(original.parts[0].geometry.hash);
  expect(current().parts.find(part => part.id === newJob.items[0].partId)?.source.revision).toBe('V19');
  expect(errors).toEqual([]);
});
