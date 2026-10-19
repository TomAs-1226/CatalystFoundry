const {createConnectHost}=require('./bambu-setup.cjs');
const {createUpdateHost}=require('./updates.cjs');
const {spawnUpdateHelper}=require('./update-process.cjs');
const { app, BrowserWindow, Menu, dialog, shell, safeStorage } = require('electron');
const http = require('node:http');
// Node 24.19+ honours the session's existing proxy/CA settings for server fetch.
// No proxy is created and no inherited networking configuration is replaced.
if (typeof http.setGlobalProxyFromEnv === 'function') http.setGlobalProxyFromEnv();
const path = require('node:path');
const { mkdir, writeFile, appendFile, readFile } = require('node:fs/promises');
const {randomUUID}=require('node:crypto');
const { once } = require('node:events');
const { desktopPaths, requestIsLocal, navigationIsLocal, externalUrlIsAllowed, smokeOptions, contentSecurityPolicy, browserOptions } = require('./runtime.cjs');

app.setName('Catalyst Foundry');
app.setPath('userData', path.join(app.getPath('appData'), 'Catalyst Foundry'));
let smoke;
try { smoke = smokeOptions(process.argv); }
catch (error) { dialog.showErrorBox('Catalyst Foundry verification', error.message); app.exit(1); }
if (smoke) app.setPath('userData', path.join(smoke.data, 'desktop-profile'));

let mainWindow;
let server;
let service;
let paths;
let origin;
let closing = false;
let shutdownComplete = false;
const pageErrors = [];
let startupTiming;
let updates;
let updateTimer;

async function log(message) {
  if (!paths) return;
  await mkdir(paths.logDirectory, { recursive: true });
  await appendFile(path.join(paths.logDirectory, 'desktop.log'), `${new Date().toISOString()} ${message}\n`, { mode: 0o600 });
}

async function stopService() {
  clearTimeout(updateTimer);updates?.dispose();
  await service?.locals?.shutdown?.();
  if (!server) return;
  const ownedServer = server;
  server = undefined;
  await new Promise(resolve => {
    const force = setTimeout(() => { ownedServer.closeAllConnections(); resolve(); }, 5000);
    force.unref();
    ownedServer.close(() => { clearTimeout(force); resolve(); });
    ownedServer.closeIdleConnections();
  });
}

async function fatal(error) {
  const message = error instanceof Error ? error.message : String(error);
  await log(`Startup/runtime failure: ${message}`).catch(() => {});
  if (smoke) {
    await mkdir(path.dirname(smoke.report), { recursive: true });
    await writeFile(smoke.report, JSON.stringify({ passed: false, platform: process.platform, phase: smoke.phase, startup:startupTiming,errors: [message, ...pageErrors] }, null, 2));
  } else dialog.showErrorBox('Catalyst Foundry could not start', `${message}\n\nYour saved project has not been deleted. Desktop logs: ${paths?.logDirectory || app.getPath('userData')}`);
  await stopService().catch(() => {});
  app.exit(1);
}

async function runSmoke(serverModule) {
  const initial = await fetch(`${origin}/api/project`).then(response => response.json());
  if (smoke.phase === 'save') {
    if (initial.project) throw new Error('Smoke save expected a new isolated project directory.');
    const project = serverModule.createProject('Desktop installation verification');
    const saved = await fetch(`${origin}/api/project`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(project) });
    if (!saved.ok) throw new Error(`Smoke persistence failed (HTTP ${saved.status}).`);
  } else if (initial.project?.name !== 'Desktop installation verification') {
    throw new Error('Second launch did not reopen the project saved by the first launch.');
  }

  const loaded = once(mainWindow.webContents, 'did-finish-load');
  mainWindow.webContents.reload();
  await loaded;
  let renderer;
  for (let attempt = 0; attempt < 100; attempt++) {
    renderer = await mainWindow.webContents.executeJavaScript(`({ title: document.title, mounted: !!document.getElementById('root')?.children.length, foundryVisible: /foundry/i.test(document.body.innerText), nodeUnavailable: typeof process === 'undefined' && typeof require === 'undefined', textLength: document.body.innerText.length })`);
    if (renderer.mounted && renderer.foundryVisible) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!renderer?.mounted || !renderer.foundryVisible || !renderer.nodeUnavailable) throw new Error('The installed renderer did not mount securely.');
  const blocked = await fetch(`${origin}/api/project`, { headers: { Origin: 'https://untrusted.example' } });
  if (blocked.status !== 403) throw new Error('Desktop same-origin protection failed.');
  const project = await fetch(`${origin}/api/project`).then(response => response.json());
  if (project.project?.name !== 'Desktop installation verification') throw new Error('Installed service did not preserve the verification project.');
  const capabilities = await fetch(`${origin}/api/capabilities`).then(response => response.json());
  if (pageErrors.length) throw new Error(`Renderer failure: ${pageErrors.join('; ')}`);
  const report = {
    schemaVersion: 1, passed: true, phase: smoke.phase,
    platform: process.platform, architecture: process.arch, packaged: app.isPackaged,
    appVersion: app.getVersion(), electronVersion: process.versions.electron, nodeVersion: process.versions.node,
    origin, loopbackBound: server.address().address === '127.0.0.1', crossOriginBlocked: true,
    renderer, persistence: { id: project.project.id, name: project.project.name, dataDirectory: paths.dataDirectory },
    capabilities, errors: pageErrors,
    startup: startupTiming,
    scope: 'Installed renderer, isolated local service, save and second-launch reopen only. No credentials or printer operations.',
  };
  await mkdir(path.dirname(smoke.report), { recursive: true });
  await writeFile(smoke.report, JSON.stringify(report, null, 2), { mode: 0o600 });
  app.quit();
}

async function start() {
  paths = desktopPaths(app.getAppPath(), app.getPath('userData'));
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    width: 1440, height: 960, minWidth: 900, minHeight: 640,
    title: 'Catalyst Foundry', backgroundColor: '#101214', show: false,
    webPreferences: browserOptions,
  });
  mainWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  mainWindow.webContents.session.setPermissionCheckHandler(() => false);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (externalUrlIsAllowed(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!navigationIsLocal(url, origin)) event.preventDefault();
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    pageErrors.push(`Renderer process stopped: ${details.reason}`);
    if (!closing) void fatal(new Error(pageErrors.at(-1)));
  });
  mainWindow.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame && code !== -3) pageErrors.push(`Load failed: ${description} (${url})`);
  });
  mainWindow.webContents.on('console-message', details => {
    if (smoke && details.level === 'error') pageErrors.push(`Renderer console: ${details.message}`);
  });
  const startupVisible = new Promise(resolve => mainWindow.once('show', () => resolve(performance.now())));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = undefined; });
  await mainWindow.loadFile(path.join(__dirname, 'startup.html'));
  // Start the sequence only after the native document is actually visible.
  // Engine initialization runs during this interval; slow starts add no delay.
  await startupVisible;
  // A Windows launcher may apply SW_HIDE to the first show request. Ensure the
  // loaded startup document is visible before starting its animation interval.
  if (!mainWindow.isVisible()) mainWindow.show();
  const startupMotion=await mainWindow.webContents.executeJavaScript(`(() => {
    const root=document.querySelector('.foundry-startup');
    root.dataset.paused='false';
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    const minimumMs=Number(reduced?root.dataset.reducedMs:root.dataset.animationMs);
    if(!Number.isFinite(minimumMs)||minimumMs<0)throw Error('Invalid startup presentation duration');
    const finite=root.getAnimations({subtree:true}).filter(a=>a.effect?.getComputedTiming().iterations!==Infinity);
    return {minimumMs,reducedMotion:reduced,finiteAnimations:finite.length};
  })()`);
  const startupMinimumMs=startupMotion.minimumMs;
  const startupPresentedAt = performance.now();
  const serverModule = require(paths.serverEntry);
  if(!smoke&&app.isPackaged)updates=createUpdateHost({directory:path.join(app.getPath('userData'),'updates'),currentVersion:app.getVersion(),install:async(installer,sha256)=>{
    const readyFile=path.join(app.getPath('userData'),'updates','install-ready.json');
    const helperPath=path.join(app.getPath('userData'),'updates',`helper-${randomUUID()}.exe`);
    // Stage the trusted helper outside the installation being replaced.
    const helperBytes=await readFile(path.join(process.resourcesPath,'setup','update-runner.exe'));
    await writeFile(helperPath,helperBytes,{flag:'wx',mode:0o600});
    const helper=spawnUpdateHelper({helperPath,installer,application:app.getPath('exe'),parentPid:process.pid,sha256,resultFile:path.join(app.getPath('userData'),'updates','install-result.json'),readyFile});
    try{
      await once(helper,'spawn');let ready=false;const deadline=Date.now()+30_000;
      while(Date.now()<deadline){if(helper.exitCode!==null)throw Error('The native update helper could not start.');try{const value=JSON.parse((await readFile(readyFile,'utf8')).replace(/^\uFEFF/,''));if(value.ready&&value.processId===helper.pid&&value.sha256===sha256){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
      if(!ready)throw Error('The native update helper did not become ready.');
      helper.unref();setTimeout(()=>app.quit(),350);
    }catch(error){helper.kill();throw error;}
  }});
  service = await serverModule.createApp({ dataDirectory: paths.dataDirectory, staticDirectory: paths.staticDirectory,
    updates,
    sync: smoke ? {} : { defaultUrl: 'https://catalyst-foundry-sync.catalyst-foundry-sync.workers.dev', vault: safeStorage.isEncryptionAvailable() ? {encrypt:value=>safeStorage.encryptString(value).toString('base64'),decrypt:value=>safeStorage.decryptString(Buffer.from(value,'base64'))} : undefined,openExternal:async url=>{if(!externalUrlIsAllowed(url))throw new Error('Only HTTPS authorization pages are allowed.');await shell.openExternal(url);}},
    printing: smoke ? undefined : createConnectHost({programDirectory:path.join(process.env.LOCALAPPDATA??path.join(app.getPath('home'),'AppData','Local'),'Programs','BambuConnect'),downloadDirectory:path.join(app.getPath('userData'),'setup','bambu-connect')}),
    slicing: smoke ? {} : { bundledDirectory: app.isPackaged ? path.join(process.resourcesPath, 'slicer') : path.join(app.getAppPath(), 'vendor/bambu') } });
  server = http.createServer((request, response) => {
    if (!requestIsLocal(request.headers, origin)) {
      response.writeHead(403, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'Desktop service accepts its own loopback origin only.' }));
      return;
    }
    response.setHeader('Content-Security-Policy', contentSecurityPolicy);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    service(request, response);
  });
  server.on('error', error => void fatal(error));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
  if (closing || !mainWindow || mainWindow.isDestroyed()) return;
  await mainWindow.webContents.executeJavaScript("document.querySelector('.foundry-startup').dataset.stage='workspace'");
  while (performance.now() - startupPresentedAt < startupMinimumMs) {
    await new Promise(resolve => setTimeout(resolve, Math.ceil(startupMinimumMs - (performance.now() - startupPresentedAt))));
  }
  if (closing || !mainWindow || mainWindow.isDestroyed()) return;
  // Completion promises cover a delayed first frame. The loading spinner is
  // intentionally unbounded and must not delay the workspace handoff.
  const completion=await mainWindow.webContents.executeJavaScript(`(async () => {
    const root=document.querySelector('.foundry-startup');
    const finite=root.getAnimations({subtree:true}).filter(a=>a.effect?.getComputedTiming().iterations!==Infinity);
    await Promise.allSettled(finite.map(a=>a.finished));
    return {animationCompleted:finite.every(a=>a.playState==='finished')||matchMedia('(prefers-reduced-motion: reduce)').matches,completedAnimations:finite.filter(a=>a.playState==='finished').length};
  })()`);
  startupTiming = {...startupMotion,...completion,elapsedBeforeNavigationMs:performance.now()-startupPresentedAt,windowVisible:mainWindow.isVisible()};
  if (smoke && (startupTiming.elapsedBeforeNavigationMs < startupMinimumMs || !startupTiming.windowVisible || !startupTiming.animationCompleted || (!startupMotion.reducedMotion&&!startupMotion.finiteAnimations))) throw new Error('Startup presentation ended before the visible animation completed.');
  await mainWindow.loadURL(`${origin}/?desktop-startup=complete`);
  await log(`Started ${app.getVersion()} ${process.platform}/${process.arch}, local port ${server.address().port}.`);
  if(updates){const checkUpdates=()=>{if(closing)return;void updates.start().catch(error=>log('Update check: '+error.message)).finally(()=>{if(!closing){updateTimer=setTimeout(checkUpdates,6*60*60_000);updateTimer.unref();}});};updateTimer=setTimeout(checkUpdates,30_000);updateTimer.unref();}
  if (smoke) await runSmoke(serverModule);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show(); mainWindow.focus();
  });
  app.whenReady().then(start).catch(fatal);
}
app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  closing = true;
  if (shutdownComplete) return;
  event.preventDefault();
  stopService().then(() => { shutdownComplete = true; app.quit(); }).catch(fatal);
});

