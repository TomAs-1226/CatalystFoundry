import { test, expect } from '@playwright/test';

// Run only when UI automation is explicitly wanted. The canvas redesign was
// compiled/unit-tested without executing browser or native UI automation.
test('canvas starts expanded and settings appear only when requested',async({page})=>{
  await page.route('**/api/project',route=>route.fulfill({json:{project:null}}));
  await page.goto('/');
  await page.getByRole('button',{name:'02 Prepare',exact:true}).click();
  const workspace=page.locator('.workspace');
  await expect(workspace).toHaveAttribute('data-parts-open','false');
  await expect(workspace).toHaveAttribute('data-inspector-open','false');
  await expect(workspace.locator('.parts-panel')).toBeHidden();
  await expect(workspace.locator('.inspector')).toBeHidden();
  const viewer=await page.locator('.viewer-column').boundingBox();
  const area=await workspace.boundingBox();
  expect(viewer!.width).toBeGreaterThan(area!.width*.95);
  await page.getByRole('button',{name:'Toggle source parts',exact:true}).click();
  await expect(workspace.locator('.parts-panel')).toBeVisible();
  await page.getByRole('button',{name:'Print setup',exact:true}).click();
  await expect(workspace.locator('.parts-panel')).toBeHidden();
  await expect(workspace.locator('.inspector')).toBeVisible();
  await page.getByRole('button',{name:'Close settings',exact:true}).click();
  await expect(workspace.locator('.inspector')).toBeHidden();
  await page.locator('.project-menu > summary').click();
  await expect(page.getByRole('button',{name:'Open project',exact:true})).toBeVisible();
});
