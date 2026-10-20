/** Native Mac build preparation only. No account, network plugin or printer access. */
import {mkdir,mkdtemp,readdir,readFile,writeFile,readlink,realpath,open,copyFile} from 'node:fs/promises';
import {join,resolve,relative} from 'node:path';
import {prepareBambuProfiles} from '../prepare-bambu-profiles';
import {hashBytes,isPathInside} from '../../server/slicing-config';
import {verifyRuntime} from '../../server/bundled-slicer';
// @ts-expect-error Native build tools are deliberately dependency-free JavaScript.
import {nativeMacTarget,run,hashFile,bambuMac} from './native-tools.mjs';

const [arch,dmgArgument,sourceArgument]=process.argv.slice(2);nativeMacTarget(arch);
if(!dmgArgument||!sourceArgument)throw Error('Supply the pinned Bambu DMG and source tar.gz. See docs/MACOS.md.');
const root=resolve('.'),dmg=resolve(dmgArgument),source=resolve(sourceArgument);
if(await hashFile(dmg)!==bambuMac.dmgSha256||await hashFile(source)!==bambuMac.sourceSha256)throw Error('Official Mac runtime/source archive hash mismatch.');
const output=join(root,`vendor/bambu-macos-${arch}`),licenses=join(root,'vendor/licenses-macos');
// A fresh directory prevents leftover files from becoming trusted runtime input.
await mkdir(join(root,'vendor'),{recursive:true});await mkdir(output);await mkdir(licenses,{recursive:true});await mkdir(join(root,'.build-cache'),{recursive:true});
const mount=await mkdtemp(join(root,'.build-cache/mac-mount-'));
let attached=false;
try{
 run('/usr/bin/hdiutil',['attach',dmg,'-readonly','-nobrowse','-mountpoint',mount]);attached=true;
 const candidates=(await readdir(mount)).filter(name=>name.endsWith('.app'));
 if(candidates.length!==1||candidates[0]!=='BambuStudio.app')throw Error('Unexpected official DMG application layout.');
 const vendor=join(output,'BambuStudio.app');run('/usr/bin/ditto',[join(mount,candidates[0]),vendor]);
 run('/usr/bin/codesign',['--verify','--deep','--strict',vendor]);
 run('/usr/sbin/spctl',['--assess','--type','execute',vendor]);
 const plist=join(vendor,'Contents/Info.plist');
 const executable=run('/usr/bin/plutil',['-extract','CFBundleExecutable','raw','-o','-',plist]).trim();
 const version=run('/usr/bin/plutil',['-extract','CFBundleVersion','raw','-o','-',plist]).trim();
 const normalizedVersion=version.match(/\d+\.\d+\.\d+\.\d+/)?.[0].split('.').map(Number).join('.');
 if(executable!=='BambuStudio'||normalizedVersion!==bambuMac.version)throw Error('Pinned vendor executable/version does not match.');
 const cpuArch=arch==='x64'?'x86_64':'arm64';
 const executableArchitectures=run('/usr/bin/lipo',['-archs',join(vendor,'Contents/MacOS/BambuStudio')]).trim().split(/\s+/).map((v:string)=>v==='x86_64'?'x64':v);
 if(!executableArchitectures.includes(arch))throw Error('The official runtime lacks this architecture.');
 // Main-executable slices do not establish the architecture of every library.
 // Advertise only the target verified across all Mach-O dependencies below.
 const architectures=[arch];
 let machOBinaries=0;
 const files:{path:string;sha256:string;link?:string}[]=[];
 async function inventory(directory:string){
  for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
   const file=join(directory,entry.name),name=relative(output,file).replaceAll('\\','/');
   if(entry.isSymbolicLink()){
    const link=await readlink(file);if(!isPathInside(output,await realpath(file)))throw Error('Vendor symlink escapes the copied runtime.');
    files.push({path:name,sha256:hashBytes(link),link});
   }else if(entry.isDirectory())await inventory(file);
   else if(entry.isFile()){
    const handle=await open(file,'r'),magic=Buffer.alloc(4);try{await handle.read(magic,0,4,0);}finally{await handle.close();}
    if(['feedface','feedfacf','cefaedfe','cffaedfe','cafebabe','bebafeca','cafebabf','bfbafeca'].includes(magic.toString('hex'))){run('/usr/bin/lipo',['-verify_arch',cpuArch,file]);machOBinaries++;}
    files.push({path:name,sha256:await hashFile(file)});
   }else throw Error('Unsupported native runtime entry.');
  }
 }
 await prepareBambuProfiles(join(vendor,'Contents/Resources/profiles/BBL'),output);
 await inventory(output);
 await writeFile(join(output,'runtime-manifest.json'),JSON.stringify({version:bambuMac.version,platform:'darwin',architectures,executable:'BambuStudio.app/Contents/MacOS/BambuStudio',archiveSha256:bambuMac.dmgSha256,files},null,2)+'\n');
 const manifestSha256=await verifyRuntime(output,undefined,{platform:'darwin',arch:arch as 'x64'|'arm64'});
 await copyFile(source,join(licenses,'BambuStudio-v02.08.02.61-source.tar.gz'));
 run('/usr/bin/tar',['-xf',source,'-C',licenses,'BambuStudio-02.08.02.61/LICENSE']);
 await copyFile(join(root,'docs/MACOS.md'),join(licenses,'MACOS.md'));
 await writeFile(join(root,'.build-cache',`mac-runtime-${arch}.json`),JSON.stringify({version,arch,architectures,executableArchitectures,machOBinaries,fileCount:files.length,manifestSha256,vendorSignatureVerified:true,offlineSliceVerified:false},null,2)+'\n');
 console.log(`Prepared ${arch}: ${files.length} pinned files; ${machOBinaries} Mach-O architectures checked. Native slicing is still untested.`);
}finally{if(attached)run('/usr/bin/hdiutil',['detach',mount]);}
