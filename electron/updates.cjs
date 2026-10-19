const {verify,createHash,randomUUID}=require('node:crypto');
const {mkdir,open,readFile,writeFile,rename,unlink,stat,statfs,readdir}=require('node:fs/promises');
const {createReadStream}=require('node:fs');
const path=require('node:path');
const policy=require('./update-policy.cjs');
const FIELDS=['schemaVersion','channel','version','platform','arch','url','size','sha256','releasedAt'];
function version(value){
 if(typeof value!=='string'||value.length>80)throw Error('Invalid update version.');
 const match=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*))?$/.exec(value);
 if(!match||match.slice(1,4).some(n=>Number(n)>999999))throw Error('Invalid update version.');
 return {numbers:match.slice(1,4).map(Number),pre:match[4]?.split('.')};
}
function compareVersions(a,b){
 const left=version(a),right=version(b);
 for(let i=0;i<3;i++)if(left.numbers[i]!==right.numbers[i])return Math.sign(left.numbers[i]-right.numbers[i]);
 if(!left.pre||!right.pre)return left.pre? -1:right.pre?1:0;
 for(let i=0;i<Math.max(left.pre.length,right.pre.length);i++){
  const l=left.pre[i],r=right.pre[i];if(l===r)continue;if(l===undefined)return -1;if(r===undefined)return 1;
  const ln=/^\d+$/.test(l),rn=/^\d+$/.test(r);return ln&&rn?Math.sign(Number(l)-Number(r)):ln? -1:rn?1:l<r?-1:1;
 }return 0;
}
function canonicalPayload(payload){return JSON.stringify(Object.fromEntries(FIELDS.map(key=>[key,payload[key]])));}
function releaseUrl(v,name){return `https://github.com/${policy.owner}/${policy.repo}/releases/download/v${v}/${name}`;}
function validateManifest(value,currentVersion,publicKey=policy.publicKey){
 const p=value?.payload;
 if(!p||Object.keys(p).sort().join(',')!==[...FIELDS].sort().join(',')||Object.keys(value).sort().join(',')!=='payload,signature')throw Error('Unsupported update manifest.');
 version(p.version);
 if(p.schemaVersion!==1||p.channel!==policy.channel||p.platform!=='win32'||p.arch!=='x64'||!Number.isSafeInteger(p.size)||p.size<1||p.size>policy.maxInstallerBytes||!/^\d{4}-\d\d-\d\dT/.test(p.releasedAt)||!Number.isFinite(Date.parse(p.releasedAt))||!(/^[a-f0-9]{64}$/).test(p.sha256))throw Error('Invalid update metadata.');
 if(p.url!==releaseUrl(p.version,`Catalyst-Foundry-${p.version}-x64-Setup.exe`))throw Error('Update must come from the app release repository.');
 if(typeof value.signature!=='string'||!(/^[A-Za-z0-9+/]{86}==$/).test(value.signature)||!verify(null,Buffer.from(canonicalPayload(p)),publicKey,Buffer.from(value.signature,'base64')))throw Error('Update signature is invalid.');
 if(compareVersions(p.version,currentVersion)<=0)throw Error('This update is not newer than the installed app.');
 return Object.freeze({...p});
}
function downloadUrlAllowed(value){
 try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(u.hostname);}catch{return false;}
}
async function vendorResponse(url,fetcher=fetch,signal){
 for(let redirects=0;redirects<6;redirects++){
  if(!downloadUrlAllowed(url)&&!url.startsWith(`https://api.github.com/repos/${policy.owner}/${policy.repo}/releases?`))throw Error('Untrusted update download destination.');
  const response=await fetcher(url,{redirect:'manual',signal,headers:{'User-Agent':'CatalystFoundry-updates','Accept':new URL(url).hostname==='api.github.com'?'application/vnd.github+json':'application/octet-stream'}});
  if([301,302,303,307,308].includes(response.status)){const target=response.headers.get('location');if(!target)throw Error('Update redirect has no location.');url=new URL(target,url).href;if(!downloadUrlAllowed(url))throw Error('Untrusted update redirect.');await response.body?.cancel();continue;}
  if(!response.ok)throw Error(`Update service returned HTTP ${response.status}.`);
  return response;
 }throw Error('Too many update redirects.');
}
async function readBounded(response,limit){
 const chunks=[];let bytes=0;
 for await(const chunk of response.body??[]){bytes+=chunk.byteLength;if(bytes>limit)throw Error('Update metadata is too large.');chunks.push(Buffer.from(chunk));}
 return Buffer.concat(chunks).toString('utf8');
}
async function fileDigest(file){const hash=createHash('sha256');for await(const bytes of createReadStream(file))hash.update(bytes);return hash.digest('hex');}
function createUpdateHost(options){
 const {directory,currentVersion,install}=options,fetcher=options.fetch??fetch,publicKey=options.publicKey??policy.publicKey;
 if(!path.isAbsolute(directory))throw Error('Update storage must be absolute.');version(currentVersion);
 let status={available:true,currentVersion,phase:'idle',message:'Updates are checked in the background. Restart is always your choice.',repository:`https://github.com/${policy.owner}/${policy.repo}`,channel:policy.channel};
 let candidate,downloaded,busy,disposed=false,controller;const listeners=new Set();
 const set=patch=>{status={...status,...patch};for(const listen of listeners)listen({...status});};
 const exclusive=action=>{if(busy)return busy;busy=action().finally(()=>{busy=undefined;});return busy;};
 const fail=error=>{set({phase:'error',message:error.message,progress:undefined});throw error;};
 const host={
  status:()=>({...status}),
  async check(){return exclusive(async()=>{
   if(disposed)throw Error('Updater has closed.');
   if(status.phase==='ready'||status.phase==='installing')return host.status();
   controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),30_000);timeout.unref?.();
   set({phase:'checking',message:'Checking signed internal releases…'});
   try{
    const releases=JSON.parse(await readBounded(await vendorResponse(`https://api.github.com/repos/${policy.owner}/${policy.repo}/releases?per_page=10`,fetcher,controller.signal),2*1024*1024));
    if(!Array.isArray(releases))throw Error('Unexpected update feed.');
    const newer=releases.filter(r=>!r.draft&&typeof r.tag_name==='string'&&(()=>{try{return compareVersions(r.tag_name.replace(/^v/,''),currentVersion)>0;}catch{return false;}})()).sort((a,b)=>compareVersions(b.tag_name.slice(1),a.tag_name.slice(1)));
    candidate=undefined;
    for(const release of newer){
     const v=release.tag_name.replace(/^v/,'');const asset=release.assets?.find(a=>a.name==='foundry-update.json');
     if(!asset)continue;
     if(asset.browser_download_url!==releaseUrl(v,'foundry-update.json'))throw Error('Update manifest is outside the release repository.');
     const value=JSON.parse(await readBounded(await vendorResponse(asset.browser_download_url,fetcher,controller.signal),16*1024));
     candidate=validateManifest(value,currentVersion,publicKey);if(candidate.version!==v)throw Error('Release tag and signed update disagree.');break;
    }
    const checkedAt=new Date().toISOString();
    await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'last-check.json'),JSON.stringify({checkedAt,version:candidate?.version}),{mode:0o600});
    set({phase:candidate?'available':'current',version:candidate?.version,checkedAt,message:candidate?`Foundry ${candidate.version} is available.`:'This app is up to date.'});return host.status();
   }catch(error){return fail(error);}finally{clearTimeout(timeout);}
  });},
  async download(){return exclusive(async()=>{
   if(disposed||!candidate)throw Error('Check for a signed update first.');
   controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),20*60_000);timeout.unref?.();
   let partial;
   try{
    await mkdir(directory,{recursive:true});const free=await statfs(directory);
    if(Number(free.bavail)*Number(free.bsize)<candidate.size+200*1024*1024)throw Error('Free more disk space before downloading this update.');
    const target=path.join(directory,`update-${candidate.version}-${candidate.sha256}.exe`);
    if(await stat(target).then(s=>s.size===candidate.size,()=>false)&&await fileDigest(target)===candidate.sha256){downloaded=target;set({phase:'ready',progress:100,message:'Update verified. Save and restart when ready.'});return host.status();}
    set({phase:'downloading',progress:0,message:'Downloading the signed update…'});
    const response=await vendorResponse(candidate.url,fetcher,controller.signal);
    if(Number(response.headers.get('content-length')??0)>candidate.size)throw Error('Update download size exceeds signed metadata.');
    partial=path.join(directory,`.download-${randomUUID()}`);const file=await open(partial,'wx',0o600),hash=createHash('sha256');let bytes=0,lastProgress=-1;
    try{for await(const chunk of response.body??[]){bytes+=chunk.byteLength;if(bytes>candidate.size)throw Error('Update download exceeds signed size.');hash.update(chunk);await file.write(chunk);const progress=Math.floor(bytes/candidate.size*100);if(progress!==lastProgress){lastProgress=progress;set({progress});}}await file.sync();}finally{await file.close();}
    if(bytes!==candidate.size||hash.digest('hex')!==candidate.sha256)throw Error('Update bytes do not match the signed release.');
    await rename(partial,target);partial=undefined;downloaded=target;set({phase:'ready',progress:100,message:'Update verified. Save and restart when ready.'});return host.status();
   }catch(error){return fail(error);}finally{clearTimeout(timeout);if(partial)await unlink(partial).catch(()=>{});}
  });},
  async install(){
   if(disposed||busy||status.phase!=='ready'||!candidate||!downloaded)throw Error('A verified update must finish downloading first.');
   return exclusive(async()=>{
    try{
     if((await stat(downloaded)).size!==candidate.size||await fileDigest(downloaded)!==candidate.sha256)throw Error('Downloaded update changed; download it again.');
     set({phase:'installing',message:'Saved. Closing Foundry and installing the verified update…'});
     await install(downloaded,candidate.sha256,candidate.version);return host.status();
    }catch(error){return fail(error);}
   });
  },
  async start(){
   // Only owned, non-symlink installer cache files at or below the installed
   // version are removed. CAD, projects, settings and newer downloads stay put.
   try{for(const entry of await readdir(directory,{withFileTypes:true})){const match=/^update-(.+)-([a-f0-9]{64})[.]exe$/.exec(entry.name);if(!entry.isFile()||!match)continue;try{if(compareVersions(match[1],currentVersion)<=0)await unlink(path.join(directory,entry.name));}catch{}}}catch{}
   try{const previous=JSON.parse(await readFile(path.join(directory,'last-check.json'),'utf8'));if(Date.now()-Date.parse(previous.checkedAt)<6*60*60_000)return;}catch{}
   await host.check();if(options.autoDownload!==false&&status.phase==='available')await host.download();
  },
  dispose(){disposed=true;controller?.abort();listeners.clear();},
  subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
 };
 return host;
}
module.exports={createUpdateHost,validateManifest,canonicalPayload,compareVersions,vendorResponse,releaseUrl,fileDigest};
