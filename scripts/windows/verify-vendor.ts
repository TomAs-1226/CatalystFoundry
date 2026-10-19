import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { verifyRuntime } from '../../server/bundled-slicer';
import { hashBytes } from '../../server/slicing-config';
const runtimeHash=await verifyRuntime(resolve('vendor/bambu'));
if(hashBytes(await readFile('vendor/licenses/BambuStudio-v02.08.02.61-source.tar.gz'))!=='fccea7043da48dfd05b98fdfc341cb29d0169880f3b3ae6bedf00ebfd3be7d28')throw new Error('Bundled upstream source archive mismatch.');
if(!(await readFile('vendor/licenses/BambuStudio-02.08.02.61/LICENSE','utf8')).includes('GNU AFFERO GENERAL PUBLIC LICENSE'))throw new Error('Missing upstream license.');
console.log(`Bundled runtime inventory verified: ${runtimeHash}`);
