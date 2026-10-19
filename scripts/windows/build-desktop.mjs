import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
if (!process.env.npm_execpath) throw new Error('Run this preparation through npm run desktop:prepare.');
// Native startup and React recovery use exactly the same art and styles.
const startupBundle=await build({entryPoints:[path.join(root,'src/components/startup-design.ts')],bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
const startup=await import('data:text/javascript;base64,'+Buffer.from(startupBundle.outputFiles[0].contents).toString('base64'));
const startupCss=await readFile(path.join(root,'src/components/startup-screen.css'),'utf8');
await writeFile(path.join(root,'electron/startup.html'),`<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Catalyst Foundry</title><style>html,body{margin:0;background:#101214}${startupCss}</style></head><body><main class="foundry-startup" data-stage="engine" data-paused="true" data-animation-ms="${startup.startupAnimationMs}" data-reduced-ms="${startup.startupReducedMs}" role="status" aria-live="polite" aria-busy="true">${startup.startupMarkup}</main></body></html>`);
const result = spawnSync(process.execPath, [process.env.npm_execpath, 'run', 'build'], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
await mkdir(path.join(root, 'desktop-dist'), { recursive: true });
await build({
  entryPoints: [path.join(root, 'electron/server-entry.ts')],
  outfile: path.join(root, 'desktop-dist/server.cjs'),
  bundle: true, platform: 'node', target: 'node24', format: 'cjs',
  sourcemap: false, legalComments: 'eof', external: ['electron'], logLevel: 'info',
});
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
await access(path.join(root, 'dist/index.html'));
await writeFile(path.join(root, 'desktop-dist/build.json'), JSON.stringify({
  version: pkg.version,
  platformBuiltOn: process.platform,
  node: process.versions.node,
  electron: pkg.devDependencies.electron,
  generatedAt: new Date().toISOString(),
  windowsInstallationValidated: false,
  note: 'Preparation is not Windows installation verification. Run Verify-Installer.ps1 on Windows.',
}, null, 2));
console.log('Desktop assets prepared. Native Windows installation remains a separate verification step.');
