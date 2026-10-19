import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

// Read-only browser evidence: the service is routed to a blank project and all CAD
// intake is an explicit fixture choice. The workspace's saved project is untouched.
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : process.platform === 'linux' ? { executablePath: '/usr/bin/chromium' } : {}),
  args: process.platform === 'linux' ? ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [],
});
try {
  await mkdir('docs/guided-workflow', { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1512, height: 1000 } });
  const page = await context.newPage();
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/project', route => route.fulfill({ json: { project: null } }));
  await page.goto(process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173');
  await expect(page.getByRole('heading', { name: 'From Onshape to a reviewed manufacturing job.', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Try demonstration fixtures', exact: false }).click();
  const source = page.getByRole('dialog', { name: 'Bring your design into Foundry', exact: true });
  await source.getByRole('button', { name: 'Import selected parts', exact: true }).click();
  await expect(source).not.toBeVisible();
  await expect(page.locator('.part-card')).toHaveCount(4);
  const notification = page.getByRole('button', { name: 'Dismiss notification', exact: true });
  if (await notification.count()) await notification.click();
  const canvas = page.getByRole('img', { name: 'Interactive 3D manufacturing workspace.', exact: false });
  for (const [label, width, height] of [['desktop', 1512, 1000], ['tablet', 1024, 800], ['mobile', 390, 844]] as const) {
    await page.setViewportSize({ width, height });
    await page.getByRole('button', { name: 'Fit to view', exact: true }).click();
    await expect(canvas).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `docs/guided-workflow/guided-layout-${label}.png`, fullPage: true });
  }
  await page.getByRole('tab', { name: 'Show settings inspector', exact: true }).click();
  await expect(page.getByLabel('Required quantity', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Rotate X', { exact: true })).not.toBeVisible();
  await page.screenshot({ path: 'docs/guided-workflow/guided-inspector-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1512, height: 1000 });
  await page.getByLabel('Required quantity', { exact: true }).fill('1');
  await page.getByLabel('Extra spares', { exact: true }).fill('2');
  await page.getByRole('tab', { name: 'Preflight checks', exact: true }).click();
  const quantities = page.locator('.quantity-reconciliation').filter({ hasText: 'Intake mounting bracket' });
  await quantities.scrollIntoViewIfNeeded();
  await expect(quantities.getByText('1 below CAD demand · manual override', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'docs/guided-workflow/guided-preflight.png', fullPage: true });
  expect(errors).toEqual([]);
  await context.close();
  console.log('Captured guided desktop/tablet/mobile workspace, mobile inspector and preflight; zero page errors. Explicit fixtures only.');
} finally { await browser.close(); }
