import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import { hashBytes, isPathInside, type SlicingFileConfig } from './slicing-config';
export interface BundledProfile {
  id:string; label:string; printer:SlicingFileConfig['printer']; material:SlicingFileConfig['material'];
  files:Record<'machine'|'filament'|'process',{path:string;sha256:string}>;
}
export async function verifyRuntime(directory:string, expectedHash?:string) {
  const bytes = await readFile(join(directory,'runtime-manifest.json'));
  const hash = hashBytes(bytes);
  if (expectedHash && hash !== expectedHash) throw new Error('Bundled slicer manifest changed after profile review.');
  const manifest = JSON.parse(bytes.toString()) as {version:string;files:{path:string;sha256:string}[]};
  if (manifest.version !== '2.8.2.61' || !manifest.files?.length) throw new Error('Invalid bundled slicer runtime manifest.');
  const seen = new Set<string>();
  for (const file of manifest.files) {
    const path = join(directory,file.path);
    if (!isPathInside(directory,path) || seen.has(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('Invalid bundled runtime file mapping.');
    seen.add(file.path);
    if (hashBytes(await readFile(path)) !== file.sha256) throw new Error(`Bundled slicer file changed: ${file.path}`);
  }
  if (!seen.has('bambu-studio.exe') || !seen.has('BambuStudio.dll') || !seen.has('catalog.json')) throw new Error('Incomplete bundled slicer runtime.');
  return hash;
}
export async function bundledCatalog(directory:string):Promise<BundledProfile[]> {
  if (!isAbsolute(directory)) throw new Error('Bundled slicer directory must be absolute.');
  return JSON.parse(await readFile(join(directory,'catalog.json'),'utf8'));
}
export async function bundledConfiguration(directory:string, dataDirectory:string, id:string, reviewed:unknown, expectedRuntimeHash?:string):Promise<SlicingFileConfig> {
  if (reviewed !== true) throw new Error('Review the exact machine, nozzle, plate and material mapping before enabling this profile.');
  const runtimeHash = await verifyRuntime(directory,expectedRuntimeHash);
  const profile = (await bundledCatalog(directory)).find(p=>p.id===id);
  if (!profile) throw new Error('Select a bundled profile from the supplied catalog.');
  const pin = (kind:'machine'|'filament'|'process') => ({...profile.files[kind],path:join(directory,profile.files[kind].path)});
  return {executable:join(directory,'bambu-studio.exe'),executableSha256:hashBytes(await readFile(join(directory,'bambu-studio.exe'))),version:'2.8.2.61',completeProfilesReviewed:true,
    machine:pin('machine'),filament:pin('filament'),process:pin('process'),workRoot:join(dataDirectory,'slicer-work'),bedType:profile.printer.plate,
    printer:profile.printer,material:profile.material,profileLabel:profile.label,runtime:{directory,sha256:runtimeHash}};
}
/** Install paths may move; an operator's review transfers only to identical
 * runtime bytes, profile bytes and machine/material metadata. External configs
 * never enter this migration. Changed bundles require a new explicit review. */
export async function relocateBundledConfiguration(saved:SlicingFileConfig,directory:string,dataDirectory:string){
  if(saved.completeProfilesReviewed!==true||!saved.runtime?.sha256)throw new Error('Review a bundled profile before enabling the included slicer.');
  const profile=(await bundledCatalog(directory)).find(p=>p.label===saved.profileLabel&&(['machine','filament','process'] as const).every(kind=>p.files[kind].sha256===saved[kind]?.sha256)&&isDeepStrictEqual(p.printer,saved.printer)&&isDeepStrictEqual(p.material,saved.material));
  if(!profile)throw new Error('The bundled profile mapping changed. Select and review an included profile again.');
  const current=await bundledConfiguration(directory,dataDirectory,profile.id,true,saved.runtime.sha256);
  if(current.executableSha256!==saved.executableSha256||current.version!==saved.version)throw new Error('The bundled executable changed. Review the installed profile again.');
  return current;
}
