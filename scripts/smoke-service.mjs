import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

// Real standalone entry/lifecycle check, not an injected server or Windows claim.
const directory = await mkdtemp(path.join(tmpdir(), 'foundry-service-smoke-'));
const child = spawn(process.execPath, ['--use-env-proxy', '--import', 'tsx', 'server/production.ts'], {
  cwd: process.cwd(), env: { ...process.env, PORT: '0', HOST: '127.0.0.1', CATALYST_DATA_DIR: directory,
    ONSHAPE_ACCESS_TOKEN_FILE: '', CATALYST_SLICER_CONFIG: '' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '', errorOutput = '';
child.stderr.on('data', data => { errorOutput = (errorOutput + String(data)).slice(-4000); });
const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
try {
  const origin = await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('Standalone service did not become ready. ' + errorOutput)), 10000);
    child.on('data', () => {});
    child.stdout.on('data', data => {
      output += String(data);
      const match = output.match(/local service: http:\/\/localhost:(\d+)/);
      if (match) { clearTimeout(deadline); resolve(`http://127.0.0.1:${match[1]}`); }
    });
    child.once('error', error => { clearTimeout(deadline); reject(error); });
    child.once('exit', code => { clearTimeout(deadline); reject(new Error(`Service exited before readiness (${code}). ${errorOutput}`)); });
  });
  const index = await fetch(origin); assert.equal(index.status, 200);
  const capabilities = await fetch(`${origin}/api/capabilities`).then(response => response.json());
  assert.equal(capabilities.onshape.available, false); assert.equal(capabilities.slicing.available, false);
  child.kill('SIGTERM');
  const timeout = setTimeout(() => child.kill('SIGKILL'), 10000);
  const result = await closed; clearTimeout(timeout);
  assert.deepEqual(result, { code: 0, signal: null }, 'SIGTERM must stop owned work and exit cleanly.');
  let unavailable = false; try { await fetch(`${origin}/api/capabilities`); } catch { unavailable = true; }
  assert.equal(unavailable, true, 'The owned listener must close.');
  await writeFile('docs/guided-workflow/service-lifecycle-smoke.json', JSON.stringify({
    passed: true, platform: process.platform, productionIndex: 200, apiMocked: false,
    integrationsDisabledForSmoke: true, sigterm: result, listenerClosed: unavailable,
    scope: 'Standalone local production entry and graceful shutdown; not Windows/Electron validation.',
  }, null, 2) + '\n');
  console.log('Standalone service smoke passed: production HTTP, unavailable integrations, SIGTERM exit0 and listener closed.');
} finally {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  await closed;
  await rm(directory, { recursive: true, force: true });
}
