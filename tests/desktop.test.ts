import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { desktopPaths, requestIsLocal, navigationIsLocal, externalUrlIsAllowed, smokeOptions, browserOptions, contentSecurityPolicy } = require('../electron/runtime.cjs');
const packaging = require('../packaging/electron-builder.cjs');

describe('desktop launch and packaging boundary', () => {
  it('resolves offline application assets separately from writable per-user storage', () => {
    const appDirectory = path.resolve('Program Files', 'Catalyst Foundry', 'resources', 'app.asar');
    const userDirectory = path.resolve('Users', 'operator', 'AppData', 'Roaming', 'Catalyst Foundry');
    const paths = desktopPaths(appDirectory, userDirectory);
    expect(paths.staticDirectory).toBe(path.join(appDirectory, 'dist'));
    expect(paths.serverEntry).toBe(path.join(appDirectory, 'desktop-dist', 'server.cjs'));
    expect(paths.dataDirectory).toBe(path.join(userDirectory, 'data'));
    expect(paths.dataDirectory.startsWith(appDirectory)).toBe(false);
    expect(() => desktopPaths('relative-install', userDirectory)).toThrow(/absolute/);
  });

  it('rejects other browser origins, forged hosts and alternate loopback names', () => {
    const origin = 'http://127.0.0.1:49152';
    expect(requestIsLocal({ host: '127.0.0.1:49152', origin }, origin)).toBe(true);
    expect(requestIsLocal({ host: '127.0.0.1:49152' }, origin)).toBe(true);
    for (const headers of [
      { host: '127.0.0.1:49152', origin: 'https://other.example' },
      { host: '127.0.0.1:49152', origin: 'http://localhost:5173' },
      { host: 'localhost:49152', origin },
      { host: 'rebound.example:49152' },
      { host: '127.0.0.1:49153', origin },
    ]) expect(requestIsLocal(headers, origin)).toBe(false);
  });

  it('keeps renderer navigation on its local origin and never opens executable/file schemes', () => {
    expect(navigationIsLocal('http://127.0.0.1:49152/jobs', 'http://127.0.0.1:49152')).toBe(true);
    expect(navigationIsLocal('https://cad.onshape.com/documents/id', 'http://127.0.0.1:49152')).toBe(false);
    expect(externalUrlIsAllowed('https://cad.onshape.com/documents/id')).toBe(true);
    for (const value of ['file:///C:/Windows/cmd.exe', 'javascript:alert(1)', 'cmd://start', 'http://example.com', 'https://user:secret@example.com', 'invalid']) {
      expect(externalUrlIsAllowed(value)).toBe(false);
    }
  });

  it('preserves sandbox, context isolation, same-origin scripting and no browser Node API', () => {
    expect(browserOptions).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, allowRunningInsecureContent: false });
    expect(contentSecurityPolicy).toContain("script-src 'self'");
    expect(contentSecurityPolicy).toContain("connect-src 'self'");
    expect(contentSecurityPolicy).not.toContain('unsafe-eval');
  });

  it('requires isolated absolute paths for save/reopen installation verification', () => {
    expect(smokeOptions([])).toBeUndefined();
    const report = path.resolve('verification evidence', 'launch-save.json');
    const data = path.resolve('verification evidence', 'isolated-data');
    expect(smokeOptions([`--foundry-smoke-report=${report}`, `--foundry-smoke-data=${data}`, '--foundry-smoke-phase=reopen'])).toEqual({ report, data, phase: 'reopen' });
    expect(() => smokeOptions([`--foundry-smoke-report=${report}`])).toThrow(/isolated/);
    expect(() => smokeOptions(['--foundry-smoke-report=relative.json', `--foundry-smoke-data=${data}`])).toThrow(/absolute/);
    expect(() => smokeOptions([`--foundry-smoke-report=${report}`, `--foundry-smoke-data=${data}`, '--foundry-smoke-phase=print'])).toThrow(/Unknown/);
    expect(()=>smokeOptions(['--foundry-smoke-bundled'])).toThrow(/isolated/);
    expect(smokeOptions([`--foundry-smoke-report=${report}`,`--foundry-smoke-data=${data}`,'--foundry-smoke-bundled'])).toEqual({report,data,phase:'save',bundled:true});
  });

  it('packages offline assets and bundled server without project data, secrets or automatic publishing', async () => {
    expect(packaging.files).toEqual(expect.arrayContaining(['dist/**', 'desktop-dist/server.cjs', 'electron/main.cjs', 'electron/runtime.cjs', '!node_modules/**', '!**/.env*', '!**/project.json']));
    expect(packaging.publish).toBeNull();
    expect(packaging.nsis).toMatchObject({ perMachine: false, allowElevation: false, runAfterFinish: false, deleteAppDataOnUninstall: false });
    expect(packaging.win.target).toEqual([{ target: 'nsis', arch: ['x64'] }]);
    const main = await readFile(new URL('../electron/main.cjs', import.meta.url), 'utf8');
    expect(main).toContain("server.listen(0, '127.0.0.1')");
    expect(main).toContain('setPermissionRequestHandler');
    expect(main).toContain('shutdown');
    expect(main).not.toContain('disable-web-security');
    expect(main).not.toContain('no-sandbox');
  });

  it('validates the NSIS configuration against the pinned electron-builder schema', async () => {
    const { validateConfiguration } = require('app-builder-lib/out/util/config/config');
    await expect(validateConfiguration(packaging, { isEnabled: false, add() {} })).resolves.toBeUndefined();
  }, 30_000); // Cold loading the builder/schema on Windows can exceed Vitest's 5s default.

  it('keeps clean Windows dependency installation on registry HTTPS without Git or SSH', async () => {
    const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    const nodeGyp = lock.packages['node_modules/@electron/node-gyp'];
    expect(pkg.overrides['@electron/node-gyp']).toBe('10.2.0-electron.1');
    expect(nodeGyp.resolved).toBe('https://registry.npmjs.org/@electron/node-gyp/-/node-gyp-10.2.0-electron.1.tgz');
    expect(nodeGyp.integrity).toBe('sha512-YdpRE6qSNYyf7gBv1LBDc8OAs8f/mZthzM1k4pFzodNq8dBGf64MWC5Bq8VVlgdafjQXLpINHvtRAUC9uinoqw==');
    expect(Object.values(lock.packages).filter((entry: unknown) => /^(git\+|ssh:|git:)/i.test((entry as { resolved?: string }).resolved || ''))).toEqual([]);
  });
});

describe('official Bambu Connect protocol',()=>{
 it('encodes the absolute path and display name without allowing arbitrary URLs or auto-start parameters',()=>{const {connectUrl}=require('../electron/bambu-connect.cjs');const file=path.resolve('job with & symbols.gcode.3mf');const url=new URL(connectUrl(file,'Intake & feeder'));expect(url.protocol).toBe('bambu-connect:');expect(url.hostname).toBe('import-file');expect(url.searchParams.get('path')).toBe(file);expect(url.searchParams.get('name')).toBe('Intake & feeder');expect([...url.searchParams.keys()]).toEqual(['path','name','version']);expect(()=>connectUrl('https://bad.test/a.gcode.3mf','x')).toThrow();expect(()=>connectUrl(path.resolve('script.exe'),'x')).toThrow();expect(packaging.files).toContain('electron/bambu-connect.cjs');});
});

it('isolates demonstration profiles and rejects mixed or normal-profile launches',()=>{const {demoOptions}=require('../electron/runtime.cjs');expect(demoOptions([])).toBeUndefined();expect(demoOptions(['--foundry-demo-data='+path.resolve('Foundry-demo-software')])).toEqual({data:path.resolve('Foundry-demo-software')});for(const flags of [['--foundry-demo-data=relative'],['--foundry-demo-data='+path.resolve('Catalyst Foundry')],['--foundry-demo-data='+path.resolve('Foundry-demo-software'),'--foundry-smoke-bundled']])expect(()=>demoOptions(flags)).toThrow(/dedicated/);});
