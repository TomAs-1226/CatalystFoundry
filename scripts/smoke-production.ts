import { chromium, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// Use a disposable CATALYST_DATA_DIR for the production server. No API is mocked.
const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3002';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? (process.platform === 'linux' ? '/usr/bin/chromium' : undefined),
  args: process.platform === 'linux' ? ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [],
});
try {
  const page = await browser.newPage({ viewport: { width: 1512, height: 1000 } });
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const response = await page.goto(baseURL);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('button', { name: 'Select design', exact: true })).toBeVisible();
  await expect(page.locator('.part-card')).toHaveCount(0);
  await page.getByRole('button', { name: /Try demonstration fixtures/ }).click();
  const firstIntake = page.getByRole('dialog', { name: 'Bring your design into Foundry' });
  await expect(firstIntake.getByRole('tab', { name: 'Demonstration fixtures', exact: true })).toHaveAttribute('aria-selected', 'true');
  await firstIntake.getByRole('button', { name: 'Import selected parts', exact: true }).click();
  await expect(firstIntake).not.toBeVisible();
  await expect(page.locator('.part-card')).toHaveCount(4);
  const canvas = page.getByRole('img', { name: 'Interactive 3D manufacturing workspace.', exact: false });
  await expect(canvas).toBeVisible();
  expect(await canvas.evaluate(element => !!(element as HTMLCanvasElement).getContext('webgl2'))).toBe(true);
  await page.getByRole('tab', { name: 'Process inspector', exact: true }).click();
  await expect(page.getByLabel('Layer height', { exact: true })).not.toBeVisible();
  await page.getByText('Advanced slicing settings', { exact: false }).click();
  await expect(page.getByLabel('Layer height', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Preflight checks', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Job preflight', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add CAD parts', exact: true }).first().click();
  const source = page.getByRole('dialog', { name: 'Bring your design into Foundry' });
  await expect(source.getByText('ONSHAPE_ACCESS_TOKEN_FILE', { exact: false }).first()).toBeVisible();
  await source.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('tab', { name: 'Show 3D workspace', exact: true }).click();
  await expect(canvas).toBeVisible();
  const widths = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
  const capabilitiesResponse = await page.request.get(`${baseURL}/api/capabilities`);
  expect(capabilitiesResponse.status()).toBe(200);
  const capabilities = await capabilitiesResponse.json();
  expect(capabilities.onshape.available).toBe(false);
  expect(capabilities.slicing.available).toBe(false);
  expect(capabilities.handoff.available).toBe(false);
  expect(pageErrors).toEqual([]);
  const result = {
    passed: true, server: baseURL, apiMocked: false, httpStatus: response?.status(),
    webgl2: true, inspectorAndSourceDialog: true, mobileWidths: widths,
    capabilities, pageErrors,
  };
  await writeFile('docs/guided-workflow/production-smoke.json', JSON.stringify(result, null, 2) + '\n');
  console.log('Production smoke passed: actual built UI/API, WebGL2, inspectors, source dialog, 390px layout; zero page errors.');
} finally {
  await browser.close();
}
