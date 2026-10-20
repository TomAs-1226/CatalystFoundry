import { readFile, open, readdir, realpath, readlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, join, relative } from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import { hashBytes, isPathInside, type SlicingFileConfig } from './slicing-config';
export interface BundledProfile {
  id:string; label:string; printer:SlicingFileConfig['printer']; material:SlicingFileConfig['material'];
  files:Record<'machine'|'filament'|'process',{path:string;sha256:string}>;
}
export interface RuntimeTarget {platform:'win32'|'darwin';arch:'x64'|'arm64';}
interface RuntimeFile {path:string;sha256:string;link?:string;}
interface RuntimeManifest {version:string;platform?:string;architectures?:string[];executable?:string;files:RuntimeFile[];}
const windowsExecutable='bambu-studio.exe',macExecutable='BambuStudio.app/Contents/MacOS/BambuStudio';
function safeRelative(file:unknown):file is string {
  return typeof file==='string'&&file.length>0&&!/[\\:\0]/.test(file)&&file.split('/').every(part=>part!==''&&part!=='.'&&part!=='..');
}
function runtimeExecutable(manifest:RuntimeManifest,target:RuntimeTarget) {
  if(!['win32','darwin'].includes(target.platform)||!['x64','arm64'].includes(target.arch))throw Error('Unsupported bundled slicer platform/architecture.');
  // Existing 0.2.x Windows inventories predate the explicit platform fields.
  if(manifest.platform===undefined){if(target.platform!=='win32'||target.arch!=='x64')throw Error('This bundled slicer requires Windows x64.');return windowsExecutable;}
  if(manifest.platform!==target.platform||!Array.isArray(manifest.architectures)||!manifest.architectures.includes(target.arch))throw Error('Bundled slicer platform/architecture does not match this app.');
  const executable=target.platform==='darwin'?macExecutable:windowsExecutable;
  if(manifest.executable!==executable)throw Error('Invalid bundled slicer executable mapping.');
  return executable;
}
async function verifiedRuntime(directory:string,expectedHash:string|undefined,target:RuntimeTarget) {
  if(!isAbsolute(directory))throw Error('Bundled slicer directory must be absolute.');
  const bytes = await readFile(join(directory,'runtime-manifest.json'));
  const hash = hashBytes(bytes);
  if (expectedHash && hash !== expectedHash) throw new Error('Bundled slicer manifest changed after profile review.');
  const manifest = JSON.parse(bytes.toString()) as RuntimeManifest;
  if (manifest.version !== '2.8.2.61' || !Array.isArray(manifest.files)||!manifest.files.length||manifest.files.length>50_000) throw new Error('Invalid bundled slicer runtime manifest.');
  const executable=runtimeExecutable(manifest,target);
  const seen = new Set<string>();
  for (const file of manifest.files) {
    if (!file||!safeRelative(file.path)||seen.has(file.path.toLowerCase())||!/^[a-f0-9]{64}$/.test(file.sha256)||file.link!==undefined&&(typeof file.link!=='string'||!file.link||/[\0\r\n]/.test(file.link)||isAbsolute(file.link))) throw new Error('Invalid bundled runtime file mapping.');
    seen.add(file.path.toLowerCase());
  }
  const required=target.platform==='win32'?[windowsExecutable,'BambuStudio.dll','catalog.json']:[macExecutable,'BambuStudio.app/Contents/Info.plist','catalog.json'];
  if(required.some(file=>!seen.has(file.toLowerCase())))throw Error('Incomplete bundled slicer runtime.');
  const root=await realpath(directory);
  // Enumerate directory entries once instead of resolving/stat-ing 6,000+
  // individual paths. Never traverse a link; pin its text and internal target.
  const inventory=new Map<string,'file'|'link'>();
  async function visit(directory:string,prefix=''){
    for(const entry of await readdir(directory,{withFileTypes:true})){
      const name=prefix+entry.name;
      if(entry.isDirectory())await visit(join(directory,entry.name),name+'/');
      else if(entry.isFile()||entry.isSymbolicLink()){if(name!=='runtime-manifest.json')inventory.set(name,entry.isSymbolicLink()?'link':'file');}
      else throw Error('Non-file in bundled runtime.');
    }
  }
  await visit(root);
  if(inventory.size!==manifest.files.length||manifest.files.some(file=>!inventory.has(file.path)))throw Error('Bundled runtime inventory changed.');
  let cursor=0,failed=false;
  // Four reusable 256 KiB buffers bound memory without skipping any file/hash.
  // Yield between reads so a large DLL cannot block the local service thread.
  const checks=await Promise.allSettled(Array.from({length:Math.min(4,manifest.files.length)},async()=>{
    const buffer=Buffer.allocUnsafe(256*1024);
    try{for(;;){
      if(failed)return;
      const file=manifest.files[cursor++];if(!file)return;
      const path=join(root,file.path);
      if(file.link!==undefined){
        if(inventory.get(file.path)!=='link'||await readlink(path)!==file.link||hashBytes(file.link)!==file.sha256)throw Error(`Bundled slicer link changed: ${file.path}`);
        const canonical=await realpath(path);
        if(!isPathInside(root,canonical))throw Error('Bundled runtime file escapes its directory.');
        const mapped=relative(root,canonical).replaceAll('\\','/').toLowerCase();
        if(!seen.has(mapped)&&![...seen].some(entry=>entry.startsWith(mapped+'/')))throw Error('Bundled runtime link target is not inventoried.');
        continue;
      }
      if(inventory.get(file.path)!=='file')throw Error('Unmapped link or non-file in bundled runtime.');
      const handle=await open(path,'r'),digest=createHash('sha256');
      try{for(;;){const {bytesRead}=await handle.read(buffer,0,buffer.length,null);if(!bytesRead)break;digest.update(buffer.subarray(0,bytesRead));}}finally{await handle.close();}
      if(digest.digest('hex')!==file.sha256)throw new Error(`Bundled slicer file changed: ${file.path}`);
    }}catch(error){failed=true;throw error;}
  }));
  const failure=checks.find((check):check is PromiseRejectedResult=>check.status==='rejected');
  if(failure)throw failure.reason;
  return {hash,executable};
}
export async function verifyRuntime(directory:string,expectedHash?:string,target:RuntimeTarget={platform:process.platform as RuntimeTarget['platform'],arch:process.arch as RuntimeTarget['arch']}) {
  return (await verifiedRuntime(directory,expectedHash,target)).hash;
}
export async function bundledCatalog(directory:string):Promise<BundledProfile[]> {
  if (!isAbsolute(directory)) throw new Error('Bundled slicer directory must be absolute.');
  return JSON.parse(await readFile(join(directory,'catalog.json'),'utf8'));
}
export async function bundledConfiguration(directory:string, dataDirectory:string, id:string, reviewed:unknown, expectedRuntimeHash?:string,target:RuntimeTarget={platform:process.platform as RuntimeTarget['platform'],arch:process.arch as RuntimeTarget['arch']}):Promise<SlicingFileConfig> {
  if (reviewed !== true) throw new Error('Review the exact machine, nozzle, plate and material mapping before enabling this profile.');
  const runtime = await verifiedRuntime(directory,expectedRuntimeHash,target);
  const profile = (await bundledCatalog(directory)).find(p=>p.id===id);
  if (!profile) throw new Error('Select a bundled profile from the supplied catalog.');
  const pin = (kind:'machine'|'filament'|'process') => {if(!safeRelative(profile.files[kind].path))throw Error('Invalid bundled profile mapping.');return {...profile.files[kind],path:join(directory,profile.files[kind].path)};};
  return {executable:join(directory,runtime.executable),executableSha256:hashBytes(await readFile(join(directory,runtime.executable))),version:'2.8.2.61',completeProfilesReviewed:true,
    machine:pin('machine'),filament:pin('filament'),process:pin('process'),workRoot:join(dataDirectory,'slicer-work'),bedType:profile.printer.plate,
    printer:profile.printer,material:profile.material,profileLabel:profile.label,runtime:{directory,sha256:runtime.hash}};
}
/** Install paths may move; an operator's review transfers only to identical
 * runtime bytes, profile bytes and machine/material metadata. External configs
 * never enter this migration. Changed bundles require a new explicit review. */
export async function relocateBundledConfiguration(saved:SlicingFileConfig,directory:string,dataDirectory:string,target:RuntimeTarget={platform:process.platform as RuntimeTarget['platform'],arch:process.arch as RuntimeTarget['arch']}){
  if(saved.completeProfilesReviewed!==true||!saved.runtime?.sha256)throw new Error('Review a bundled profile before enabling the included slicer.');
  const profile=(await bundledCatalog(directory)).find(p=>p.label===saved.profileLabel&&(['machine','filament','process'] as const).every(kind=>p.files[kind].sha256===saved[kind]?.sha256)&&isDeepStrictEqual(p.printer,saved.printer)&&isDeepStrictEqual(p.material,saved.material));
  if(!profile)throw new Error('The bundled profile mapping changed. Select and review an included profile again.');
  const current=await bundledConfiguration(directory,dataDirectory,profile.id,true,saved.runtime.sha256,target);
  if(current.executableSha256!==saved.executableSha256||current.version!==saved.version)throw new Error('The bundled executable changed. Review the installed profile again.');
  return current;
}
