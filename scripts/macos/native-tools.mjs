import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {open,readFile,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
export function nativeMacTarget(arch,platform=process.platform,hostArch=process.arch){
 if(platform!=='darwin')throw Error('Native macOS execution is required; no Mac installer was built.');
 if(!['arm64','x64'].includes(arch)||arch!==hostArch)throw Error('Build/test arm64 on Apple Silicon or x64 on Intel, using native Node.');
 const [major,minor]=process.versions.node.split('.').map(Number);
 if(major!==24||minor<19)throw Error('Use Node 24.19 or newer in the 24 LTS line.');
 return arch;
}
export function run(file,args,options={}){
 const result=spawnSync(file,args,{encoding:'utf8',maxBuffer:16*1024*1024,timeout:600_000,...options});
 if(result.error||result.status!==0)throw Error(`${file} failed (${result.status??'spawn'}): ${result.error?.message??result.stderr??''}`);
 return result.stdout??'';
}
export async function hashFile(file){
 const handle=await open(file,'r'),hash=createHash('sha256'),buffer=Buffer.allocUnsafe(256*1024);
 try{for(;;){const {bytesRead}=await handle.read(buffer,0,buffer.length,null);if(!bytesRead)break;hash.update(buffer.subarray(0,bytesRead));}}finally{await handle.close();}
 return hash.digest('hex');
}
export async function sourceIdentity(directory){
 const root=await realpath(directory),top=spawnSync('git',['-C',root,'rev-parse','--show-toplevel'],{encoding:'utf8'});
 const samePath=(left,right)=>process.platform==='win32'?left.toLowerCase()===right.toLowerCase():left===right;
 if(top.status===0&&samePath(await realpath(top.stdout.trim()),root))return{sourceBase:run('git',['-C',root,'rev-parse','HEAD']).trim(),sourceDirty:!!run('git',['-C',root,'status','--porcelain']).trim(),sourceKind:'git-checkout'};
 const file=join(root,'PREPARATION-SOURCE-MANIFEST.json'),manifest=JSON.parse(await readFile(file,'utf8'));
 if(!/^[a-f0-9]{40}$/.test(manifest.sourceBase)||!Array.isArray(manifest.files)||!manifest.files.length)throw Error('A traced source checkout or preparation archive manifest is required.');
 const seen=new Set();
 for(const entry of manifest.files){
  if(typeof entry.path!=='string'||/[\\:\0]/.test(entry.path)||entry.path.split('/').some(part=>!part||part==='.'||part==='..')||seen.has(entry.path)||!/^[a-f0-9]{64}$/.test(entry.sha256))throw Error('Invalid source archive mapping.');
  seen.add(entry.path);const candidate=await realpath(resolve(root,entry.path));
  if(!candidate.startsWith(root+'/')&&!candidate.startsWith(root+'\\'))throw Error('Source archive file escapes its directory.');
  if(await hashFile(candidate)!==entry.sha256)throw Error('Source archive bytes changed: '+entry.path);
 }
 return{sourceBase:manifest.sourceBase,sourceDirty:true,sourceKind:'verified-preparation-archive',sourceManifestSha256:await hashFile(file)};
}
export const bambuMac=Object.freeze({version:'2.8.2.61',tag:'v02.08.02.61',
 dmgUrl:'https://github.com/bambulab/BambuStudio/releases/download/v02.08.02.61/Bambu_Studio_mac-v02.08.02.61-20260820225108.dmg',
 dmgSha256:'cf648a95858fb630e1353c4987038df60d6caab693f18411fb95fb809f2d6926',
 sourceUrl:'https://codeload.github.com/bambulab/BambuStudio/tar.gz/refs/tags/v02.08.02.61',
 sourceSha256:'fccea7043da48dfd05b98fdfc341cb29d0169880f3b3ae6bedf00ebfd3be7d28'});
