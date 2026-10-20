/** Run after packaging/signing too: the copied vendor runtime must stay byte-identical. */
import {resolve,join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {verifyRuntime} from '../../server/bundled-slicer';
// @ts-expect-error Native build tools use dependency-free JavaScript.
import {nativeMacTarget,run} from './native-tools.mjs';
const application=resolve(process.argv[2]),arch=nativeMacTarget(process.argv[3]);
const directory=join(application,'Contents/Resources/slicer');
const manifest=await verifyRuntime(directory,undefined,{platform:'darwin',arch});
run('/usr/bin/codesign',['--verify','--deep','--strict',join(directory,'BambuStudio.app')]);
const inventory=JSON.parse(await readFile(join(directory,'runtime-manifest.json'),'utf8'));
console.log(JSON.stringify({passed:true,scope:'Packaged runtime bytes and preserved vendor signature only; not installation or slicing.',platform:'darwin',arch,manifestSha256:manifest,files:inventory.files.length}));
