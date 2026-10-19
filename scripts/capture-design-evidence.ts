import { chromium, expect } from '@playwright/test';

// Standalone screenshot companion. Uses the same labelled demonstration bootstrap as
// the before screenshots; it does not alter the workspace's saved project.
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? (process.platform === 'linux' ? '/usr/bin/chromium' : undefined),
  args: process.platform === 'linux' ? ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [],
});
try {
  const context = await browser.newContext({ viewport: { width: 1512, height: 1000 } });
  const page = await context.newPage();
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/project', route => route.fulfill({ json: { project: null } }));
  await page.goto(process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173');
  await page.getByRole('button', {name: /Try demonstration fixtures/}).click();
  const intake = page.getByRole('dialog', {name: 'Bring your design into Foundry'});
  await intake.getByRole('button', {name: 'Import selected parts', exact: true}).click();
  await expect(intake).not.toBeVisible();
  await expect(page.locator('.part-card')).toHaveCount(4);
  await page.getByLabel('Required quantity', { exact: true }).fill('1');
  await page.getByLabel('Extra spares', { exact: true }).fill('2');
  await page.getByRole('tab', { name: 'Preflight checks', exact: true }).click();
  const quantities = page.locator('.quantity-reconciliation').filter({ hasText: 'Intake mounting bracket' });
  await quantities.scrollIntoViewIfNeeded();
  await expect(quantities.getByText('1 below CAD demand · manual override', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'docs/guided-workflow/after-preflight.png', fullPage: true });
  await page.getByRole('tab', { name: 'Part inspector', exact: true }).click();
  await page.getByText('Orientation alternatives', { exact: true }).click();
  const candidate = page.locator('.candidate').filter({ hasText: 'Current orientation' });
  await candidate.getByText('Why / assumptions', { exact: true }).click();
  const explanation = candidate.getByText('Ranking compares fit and geometric height. It does not rank strength or predict print duration.', { exact: true });
  await explanation.scrollIntoViewIfNeeded();
  await expect(explanation).toBeInViewport();
  await page.screenshot({ path: 'docs/guided-workflow/after-intelligence.png', fullPage: true });
  expect(errors).toEqual([]);
  console.log('Captured after-preflight.png and after-intelligence.png from real rendered UI; zero page errors.');
  await context.close();
} finally {
  await browser.close();
}
