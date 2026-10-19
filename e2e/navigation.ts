import type { Page } from '@playwright/test';
export async function openSettings(page:Page,tab:'part'|'process'|'checks'='part') {
  await page.getByRole('button',{name:'02 Prepare',exact:true}).click();
  if(await page.locator('.workspace').getAttribute('data-inspector-open')==='true'&&await page.locator('.inspector').getAttribute('data-tab')===tab)return;
  const label=tab==='part'?'Edit part':tab==='process'?'Print setup':undefined;
  await (label?page.getByRole('button',{name:label,exact:true}):page.locator('.canvas-menus button').last()).click();
}
export async function openSlicingSettings(page:Page) {
  if(await page.locator('.workspace').getAttribute('data-inspector-open')!=='true')await page.getByRole('button',{name:'Slice setup',exact:true}).click();
}
export async function openProjectMenu(page:Page) {
  if(await page.locator('.project-menu').getAttribute('open')===null)await page.locator('.project-menu > summary').click();
}
export async function openCameraOptions(page:Page) {
  if(await page.locator('.camera-options').getAttribute('open')===null)await page.getByLabel('Camera options',{exact:true}).click();
}
export async function openParts(page:Page) {
  if(await page.locator('.workspace').getAttribute('data-parts-open')!=='true')await page.getByRole('button',{name:'Toggle source parts',exact:true}).click();
}
