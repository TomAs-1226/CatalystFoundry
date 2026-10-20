/** Build-time only. Input must be the hash-verified official portable ZIP extraction. */
import { cp, mkdir, readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import {prepareBambuProfiles} from '../prepare-bambu-profiles';
import { hashBytes } from '../../server/slicing-config';
const input = resolve(process.argv[2] ?? '../../downloads/bambu');
const output = resolve('vendor/bambu');
await mkdir(output, { recursive: true });
await cp(input, output, { recursive: true, filter: path => !/\.pdb$/i.test(path) && !relative(input,path).split(/[\\/]/).includes('include') });
const catalog = await prepareBambuProfiles(join(output, "resources/profiles/BBL"),output);
const files: {path:string;sha256:string}[] = [];
async function inventory(directory:string) {
  for (const name of (await readdir(directory)).sort()) {
    const file = join(directory,name);
    if ((await stat(file)).isDirectory()) await inventory(file);
    else if (name !== 'runtime-manifest.json') files.push({path:relative(output,file).replaceAll('\\','/'),sha256:hashBytes(await readFile(file))});
  }
}
await inventory(output);
await writeFile(join(output,'runtime-manifest.json'),JSON.stringify({version:'2.8.2.61',archiveSha256:'3faaa194a90a2e7defa39a6a63f5a654b8cdb762c6a98556cf771fba582229f5',files},null,2)+'\n');
console.log(`Prepared official Bambu Studio 2.8.2.61: ${files.length} pinned runtime files, ${catalog.length} resolved profile mappings.`);
