import { mkdir, realpath, writeFile, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

/** Windows packaged-process redirection can redirect children even when realpath(root)
 * still returns the unredirected directory. Resolve a file we actually create before
 * constructing any prepared paths. Browser paths never select this trusted root. */
export async function canonicalWorkDirectory(directory: string): Promise<string> {
  await mkdir(directory, { recursive: true });
  const probe = join(resolve(directory), `.foundry-root-${randomUUID()}`);
  await writeFile(probe, 'Foundry work directory check', { mode: 0o600, flag: 'wx' });
  try { return dirname(await realpath(probe)); }
  finally { await unlink(probe); }
}
