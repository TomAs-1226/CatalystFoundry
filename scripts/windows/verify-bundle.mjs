import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const { createApp, createProject } = require(path.join(root, 'desktop-dist/server.cjs'));
const { requestIsLocal } = require(path.join(root, 'electron/runtime.cjs'));
// This reproducible smoke must not consume a developer's authorised credentials/profile.
delete process.env.ONSHAPE_ACCESS_TOKEN_FILE;
delete process.env.CATALYST_SLICER_CONFIG;
const dataDirectory = await mkdtemp(path.join(tmpdir(), 'foundry-bundled-service-'));
let app;
let server;
let origin;
async function open() {
  app = await createApp({ dataDirectory, staticDirectory: path.join(root, 'dist') });
  server = http.createServer((request, response) => {
    if (!requestIsLocal(request.headers, origin)) { response.writeHead(403); response.end(); return; }
    app(request, response);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
}
async function close() {
  await app?.locals.shutdown?.();
  if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  server = undefined;
}
try {
  await open();
  assert.equal(server.address().address, '127.0.0.1');
  const html = await fetch(origin).then(response => response.text());
  assert.match(html, /id="root"/);
  const capabilities = await fetch(`${origin}/api/capabilities`).then(response => response.json());
  assert.equal(capabilities.onshape.available, false);
  assert.equal(capabilities.slicing.available, false);
  assert.equal((await fetch(`${origin}/api/project`, { headers: { Origin: 'https://untrusted.example' } })).status, 403);
  const forgedHostStatus = await new Promise((resolve, reject) => {
    http.get(`${origin}/api/project`, { headers: { Host: 'rebound.example' } }, response => {
      response.resume(); resolve(response.statusCode);
    }).on('error', reject);
  });
  assert.equal(forgedHostStatus, 403);
  const project = createProject('Bundled desktop service verification');
  const saved = await fetch(`${origin}/api/project`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(project) });
  assert.equal(saved.status, 200);
  await close();
  await open();
  assert.deepEqual((await fetch(`${origin}/api/project`).then(response => response.json())).project, project);
  console.log(JSON.stringify({ passed: true, runtime: `Node ${process.versions.node}`, platform: process.platform, checks: ['bundled service imports without TypeScript loader', 'offline production index', 'loopback binding', 'cross-origin and forged-host rejection', 'real disk save and new-service reopen', 'unconfigured adapters reported unavailable', 'graceful service shutdown'], windowsInstallationValidated: false, electronRendererValidated: false }, null, 2));
} finally {
  await close();
  await rm(dataDirectory, { recursive: true, force: true });
}
