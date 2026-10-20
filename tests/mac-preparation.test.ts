import {expect,it} from 'vitest';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,readFile,writeFile,rm,symlink} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {verifyRuntime,bundledConfiguration} from '../server/bundled-slicer';
import {hashBytes} from '../server/slicing-config';
// @ts-expect-error Build tools are intentionally dependency-free JavaScript.
import {nativeMacTarget,bambuMac,sourceIdentity} from '../scripts/macos/native-tools.mjs';
// @ts-expect-error Lossless icon-container conversion is a JavaScript build tool.
import {icnsFromIco} from '../scripts/macos/prepare-icon.mjs';
const require=createRequire(import.meta.url),{macConfiguration}=require('../packaging/mac-configuration.cjs');
async function temporary(task:(directory:string)=>Promise<void>){const directory=await mkdtemp(join(tmpdir(),'foundry-mac-test-'));try{await task(directory);}finally{await rm(directory,{recursive:true,force:true});}}
async function runtime(directory:string,mac=false){
 const entries=[{path:mac?'BambuStudio.app/Contents/MacOS/BambuStudio':'bambu-studio.exe',data:Buffer.alloc(1024*1024+37,23)},{path:mac?'BambuStudio.app/Contents/Info.plist':'BambuStudio.dll',data:Buffer.from('SYNTHETIC NON-EXECUTABLE RUNTIME')},{path:'catalog.json',data:Buffer.from('[]')}];
 for(const file of entries){await mkdir(dirname(join(directory,file.path)),{recursive:true});await writeFile(join(directory,file.path),file.data);}
 const manifest={version:'2.8.2.61',...(mac?{platform:'darwin',architectures:['arm64','x64'],executable:entries[0].path}:{}),files:entries.map(file=>({path:file.path,sha256:hashBytes(file.data)}))};
 await writeFile(join(directory,'runtime-manifest.json'),JSON.stringify(manifest));return{entries,manifest};
}
it('gates native Mac builds and Windows NSIS/companion actions by actual platform and architecture',()=>{
 expect(()=>nativeMacTarget('arm64','win32','x64')).toThrow(/Native macOS/);
 expect(()=>nativeMacTarget('x64','darwin','arm64')).toThrow(/native Node/);
 expect(()=>nativeMacTarget('universal','darwin','arm64')).toThrow();
 const {nativeWindowsIntegration}=require('../electron/runtime.cjs');
 expect(nativeWindowsIntegration('win32','x64')).toBe(true);for(const target of [['darwin','arm64'],['darwin','x64'],['win32','arm64'],['linux','x64']])expect(nativeWindowsIntegration(...target)).toBe(false);
 if(process.platform!=='darwin'){const probe=spawnSync(process.execPath,['scripts/macos/build-installer.mjs'],{encoding:'utf8'});expect(probe.status).toBe(1);expect(probe.stderr).toMatch(/Native macOS execution is required/);}
});
it('validates separate Mac targets, exact native runtime inclusion and signing policy against the pinned builder',async()=>{
 const {validateConfiguration}=require('app-builder-lib/out/util/config/config');
 await validateConfiguration(require('../packaging/electron-builder.mac.cjs'),{isEnabled:false,add(){}});
 for(const arch of ['arm64','x64'])for(const unsigned of [false,true]){
  const config=macConfiguration(arch,unsigned);await validateConfiguration(config,{isEnabled:false,add(){}});
  expect(config.publish).toBeNull();expect(config.win).toBeUndefined();expect(config.nsis).toBeUndefined();
  expect(config.extraResources).toEqual([{from:`vendor/bambu-macos-${arch}`,to:'slicer'},{from:'vendor/licenses-macos',to:'licenses'}]);
  expect(config.forceCodeSigning).toBe(!unsigned);expect(config.mac.hardenedRuntime).toBe(!unsigned);expect(config.mac.notarize).toBe(false);
  expect(config.mac.signIgnore.some((pattern:string)=>new RegExp(pattern).test('/Foundry.app/Contents/Resources/slicer/BambuStudio.app/Contents/MacOS/BambuStudio'))).toBe(true);
 }
 expect(()=>macConfiguration('universal')).toThrow();
 expect(bambuMac.dmgSha256).toBe('cf648a95858fb630e1353c4987038df60d6caab693f18411fb95fb809f2d6926');
},30000);
it('hashes beyond the reusable buffer and rejects extra files, changed final bytes and wrong runtime targets',async()=>temporary(async directory=>{
 const {entries}=await runtime(directory),target={platform:'win32',arch:'x64'} as const;
 const hash=await verifyRuntime(directory,undefined,target);
 await expect(verifyRuntime(directory,hash,{platform:'darwin',arch:'arm64'})).rejects.toThrow(/Windows x64/);
 const changed=Buffer.from(entries[0].data);changed[changed.length-1]^=255;await writeFile(join(directory,entries[0].path),changed);
 await expect(verifyRuntime(directory,hash,target)).rejects.toThrow(/file changed/);await writeFile(join(directory,entries[0].path),entries[0].data);
 await writeFile(join(directory,'unlisted.dll'),'SYNTHETIC');await expect(verifyRuntime(directory,hash,target)).rejects.toThrow(/inventory changed/);
}));
it('accepts explicitly pinned Mac inventories as data and rejects wrong architectures, executables and duplicate path aliases',async()=>temporary(async directory=>{
 const {manifest}=await runtime(directory,true),target={platform:'darwin',arch:'arm64'} as const;
 expect(await verifyRuntime(directory,undefined,target)).toBe(hashBytes(JSON.stringify(manifest)));
 await expect(bundledConfiguration(directory,directory,'missing',false,undefined,target)).rejects.toThrow(/Review/);
 manifest.architectures=['x64'];await writeFile(join(directory,'runtime-manifest.json'),JSON.stringify(manifest));await expect(verifyRuntime(directory,undefined,target)).rejects.toThrow(/architecture/);
 manifest.architectures=['arm64'];manifest.executable='bambu-studio.exe';await writeFile(join(directory,'runtime-manifest.json'),JSON.stringify(manifest));await expect(verifyRuntime(directory,undefined,target)).rejects.toThrow(/executable mapping/);
 manifest.executable='BambuStudio.app/Contents/MacOS/BambuStudio';manifest.files.push({path:'CATALOG.JSON',sha256:hashBytes('[]')});await writeFile(join(directory,'runtime-manifest.json'),JSON.stringify(manifest));await expect(verifyRuntime(directory,undefined,target)).rejects.toThrow(/mapping/);
}));
it.runIf(process.platform!=='win32')('pins relative native-framework symlinks and rejects an escaping target',async()=>temporary(async directory=>{
 const {manifest}=await runtime(directory,true),file='BambuStudio.app/Contents/Frameworks/Kit.framework/Versions/A/Kit';
 await mkdir(dirname(join(directory,file)),{recursive:true});await writeFile(join(directory,file),'SYNTHETIC LIBRARY');manifest.files.push({path:file,sha256:hashBytes('SYNTHETIC LIBRARY')});
 const link='BambuStudio.app/Contents/Frameworks/Kit.framework/Versions/Current';await symlink('A',join(directory,link));(manifest.files as {path:string;sha256:string;link?:string}[]).push({path:link,link:'A',sha256:hashBytes('A')});
 await writeFile(join(directory,'runtime-manifest.json'),JSON.stringify(manifest));await expect(verifyRuntime(directory,undefined,{platform:'darwin',arch:'arm64'})).resolves.toBeTypeOf('string');
 await rm(join(directory,link));const escape='../../../../../../';await symlink(escape,join(directory,link));Object.assign(manifest.files.at(-1)!,{link:escape,sha256:hashBytes(escape)});await writeFile(join(directory,'runtime-manifest.json'),JSON.stringify(manifest));await expect(verifyRuntime(directory,undefined,{platform:'darwin',arch:'arm64'})).rejects.toThrow(/escapes/);
}));
it('retains the existing Catalyst artwork in a valid ICNS container',async()=>{
 const icon=icnsFromIco(await readFile(new URL('../packaging/assets/foundry.ico',import.meta.url)));
 expect(icon.subarray(0,4).toString()).toBe('icns');expect(icon.readUInt32BE(4)).toBe(icon.length);expect(icon.subarray(8,12).toString()).toMatch(/^ic\d\d$/);
});
it('builds a traceable source extraction without requiring an embedded Git repository, and rejects changed source bytes',async()=>temporary(async directory=>{
 const manifest={sourceBase:'16adc228baf750590bb25c21dd7404149e5e8ba1',files:[{path:'example.txt',sha256:hashBytes('SYNTHETIC SOURCE')}]};
 await writeFile(join(directory,'example.txt'),'SYNTHETIC SOURCE');await writeFile(join(directory,'PREPARATION-SOURCE-MANIFEST.json'),JSON.stringify(manifest));
 expect(await sourceIdentity(directory)).toMatchObject({sourceBase:manifest.sourceBase,sourceDirty:true,sourceKind:'verified-preparation-archive'});
 await writeFile(join(directory,'example.txt'),'CHANGED SOURCE');await expect(sourceIdentity(directory)).rejects.toThrow(/bytes changed/);
 manifest.files[0].path='../outside';await writeFile(join(directory,'PREPARATION-SOURCE-MANIFEST.json'),JSON.stringify(manifest));await expect(sourceIdentity(directory)).rejects.toThrow(/mapping/);
}));
