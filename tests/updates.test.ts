import {expect,it} from 'vitest';
import {createRequire} from 'node:module';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,basename} from 'node:path';
import {once} from 'node:events';
import {spawn,spawnSync,type ChildProcess} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import express from 'express';
import {registerUpdateRoutes} from '../server/desktop-updates';
import {restartUpdate} from '../src/components/restart-update';
const require=createRequire(import.meta.url);
const {createUpdateHost,validateManifest,canonicalPayload,compareVersions,releaseUrl,vendorResponse}=require('../electron/updates.cjs');
const {spawnUpdateHelper}=require('../electron/update-process.cjs');
const keys=generateKeyPairSync('ed25519'),publicKey=keys.publicKey.export({type:'spki',format:'pem'});
it('locks edits between a successful save and native restart readiness, and unlocks on helper failure',async()=>{
 const sequence:string[]=[];
 await restartUpdate({canRestart:true,save:async()=>{sequence.push('saved');return true;},lock:locked=>sequence.push('lock:'+locked),install:async()=>{sequence.push('install');}});expect(sequence).toEqual(['saved','lock:true','install']);
 sequence.length=0;await expect(restartUpdate({canRestart:true,save:async()=>true,lock:locked=>sequence.push('lock:'+locked),install:async()=>{throw Error('helper unavailable');}})).rejects.toThrow('helper unavailable');expect(sequence).toEqual(['lock:true','lock:false']);
 sequence.length=0;await expect(restartUpdate({canRestart:true,save:async()=>false,lock:locked=>sequence.push('lock:'+locked),install:async()=>{sequence.push('install');}})).rejects.toThrow(/Save/);expect(sequence).toEqual([]);
});
const installer=Buffer.from('SOFTWARE-ONLY installer bytes, never executable'),sha256=createHash('sha256').update(installer).digest('hex');
function signed(version='0.2.0'){
 const payload={schemaVersion:1,channel:'internal',version,platform:'win32',arch:'x64',url:releaseUrl(version,`Catalyst-Foundry-${version}-x64-Setup.exe`),size:installer.length,sha256,releasedAt:'2026-10-19T00:00:00.000Z'};
 return {payload,signature:sign(null,Buffer.from(canonicalPayload(payload)),keys.privateKey).toString('base64')};
}
async function temp(fn:(directory:string)=>Promise<void>){const dir=await mkdtemp(join(tmpdir(),'foundry-updates-'));try{await fn(dir);}finally{if(dirname(dir)!==tmpdir()||!basename(dir).startsWith('foundry-updates-'))throw Error('Unsafe test cleanup');await rm(dir,{recursive:true,force:true});}}
async function stopOwned(child:ChildProcess|undefined){if(child&&child.exitCode===null&&child.signalCode===null){const stopped=once(child,'exit');child.kill();await stopped;}}
async function waitFile(file:string,child?:ChildProcess){const deadline=Date.now()+12000;do{if(child&&child.exitCode!==null)throw Error('Native helper exited before readiness: '+child.exitCode);try{return await readFile(file,'utf8');}catch{}await new Promise(resolve=>setTimeout(resolve,50));}while(Date.now()<deadline);throw Error('Native helper did not complete.');}
function compileHelper(directory:string){const output=join(directory,'update-runner.exe'),compiled=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/windows/build-update-helper.mjs',import.meta.url)),output],{encoding:'utf8',windowsHide:true});if(compiled.status!==0)throw Error(compiled.stdout+compiled.stderr);return output;}
it.runIf(process.platform==='win32')('runs the real hidden Windows helper and authenticates bytes before waiting, without executing an installer',async()=>temp(async directory=>{
 const installer=join(directory,'non-executable-test.exe'),bytes=Buffer.from('NON EXECUTABLE SOFTWARE FIXTURE'),sha256=createHash('sha256').update(bytes).digest('hex');await writeFile(installer,bytes);
 const parent=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});await once(parent,'spawn');let helper:ChildProcess|undefined;
 try{
  helper=spawnUpdateHelper({helperPath:compileHelper(directory),probeOnly:true,installer,application:join(directory,'never-launched.exe'),parentPid:parent.pid,sha256,resultFile:join(directory,'result.json'),readyFile:join(directory,'ready.json')});await once(helper!,'spawn');
  const ready=JSON.parse((await waitFile(join(directory,'ready.json'),helper)).replace(/^\uFEFF/,''));expect(ready).toEqual({ready:true,processId:helper!.pid,sha256});expect(parent.exitCode).toBeNull();await expect(readFile(join(directory,'result.json'))).rejects.toThrow();
  await stopOwned(helper);helper=undefined;await writeFile(installer,'TAMPERED NON EXECUTABLE FIXTURE');
  helper=spawnUpdateHelper({helperPath:join(directory,'update-runner.exe'),probeOnly:true,installer,application:join(directory,'never-launched.exe'),parentPid:parent.pid,sha256,resultFile:join(directory,'bad-result.json'),readyFile:join(directory,'bad-ready.json')});await once(helper!,'spawn');await once(helper!,'exit');expect(helper!.exitCode).toBe(1);expect(JSON.parse(await readFile(join(directory,'bad-result.json'),'utf8')).error).toMatch(/bytes changed/);await expect(readFile(join(directory,'bad-ready.json'))).rejects.toThrow();
 }finally{await stopOwned(helper);await stopOwned(parent);}
}),20000);
it.runIf(process.platform==='win32')('keeps the windowless native helper alive after its launching parent exits',async()=>temp(async directory=>{
 const readyFile=join(directory,'ready.json'),resultFile=join(directory,'survived.txt'),parentFile=join(directory,'parent.cjs');let helperPid:number|undefined;
 const bytes=Buffer.from('NON EXECUTABLE LIFECYCLE FIXTURE'),installer=join(directory,'never-used.exe');await writeFile(installer,bytes);
 const options=JSON.stringify({helperPath:compileHelper(directory),probeOnly:true,installer,application:join(directory,'never-launched.exe'),sha256:createHash('sha256').update(bytes).digest('hex'),readyFile,resultFile});
 await writeFile(parentFile,`const {spawnUpdateHelper}=require(${JSON.stringify(require.resolve('../electron/update-process.cjs'))});const fs=require('node:fs');const helper=spawnUpdateHelper({...${options},parentPid:process.pid});const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(readyFile)})){clearInterval(timer);helper.unref();process.exit(0);}},50);setTimeout(()=>{helper.kill();process.exit(1);},12000).unref();`);
 const parent=spawn(process.execPath,[parentFile],{stdio:'ignore',windowsHide:true});await once(parent,'spawn');
 try{const ready=JSON.parse((await waitFile(readyFile)).replace(/^\uFEFF/,''));helperPid=ready.processId;if(parent.exitCode===null)await once(parent,'exit');expect(parent.exitCode).toBe(0);expect(JSON.parse(await waitFile(resultFile))).toMatchObject({passed:true,probeOnly:true});helperPid=undefined;}
 finally{await stopOwned(parent);if(helperPid){try{process.kill(helperPid);}catch{}}}
}),20000);
function transport(manifest=signed(),bytes:Uint8Array=installer){const calls:string[]=[];return {calls,fetch:async(url:string,options:any)=>{
 calls.push(url);expect(options.headers.Authorization).toBeUndefined();
 if(url.startsWith('https://api.github.com/')){expect(options.headers.Accept).toBe('application/vnd.github+json');return new Response(JSON.stringify([{draft:false,tag_name:'v0.2.0',assets:[{name:'foundry-update.json',browser_download_url:releaseUrl('0.2.0','foundry-update.json')}]}]));}
 expect(options.headers.Accept).toBe('application/octet-stream');
 if(url.endsWith('foundry-update.json'))return new Response(JSON.stringify(manifest));
 return new Response(bytes as BodyInit);
}};}
it('authenticates every manifest field and rejects tampering, arbitrary destinations, and downgrade/replay',()=>{
 expect(validateManifest(signed(),'0.1.0',publicKey).version).toBe('0.2.0');
 for(const change of [(p:any)=>p.sha256='a'.repeat(64),(p:any)=>p.size++,(p:any)=>p.url='https://other.example/installer.exe',(p:any)=>p.channel='stable',(p:any)=>p.extra='unsigned']){const value=signed();change(value.payload);expect(()=>validateManifest(value,'0.1.0',publicKey)).toThrow();}
 expect(()=>validateManifest(signed(),'0.2.0',publicKey)).toThrow(/newer/);expect(()=>validateManifest(signed(),'1.0.0',publicKey)).toThrow(/newer/);expect(()=>validateManifest({...signed(),signature:'A'.repeat(86)+'=='},'0.1.0',publicKey)).toThrow(/signature/);
 expect(compareVersions('0.2.0','0.2.0-beta.9')).toBe(1);expect(compareVersions('0.2.0-beta.10','0.2.0-beta.9')).toBe(1);expect(compareVersions('0.10.0','0.2.0')).toBe(1);
});
it('downloads exact signed bytes without installation, then installs only once after full revalidation',async()=>temp(async directory=>{
 const network=transport();let installs=0,release:()=>void=()=>{};
 const host=createUpdateHost({directory,currentVersion:'0.1.0',publicKey,fetch:network.fetch,install:()=>{installs++;return new Promise<void>(resolve=>{release=resolve;});}});
 expect(network.calls).toHaveLength(0);await host.check();expect(host.status().phase).toBe('available');expect(installs).toBe(0);
 await host.download();expect(host.status().phase).toBe('ready');expect(installs).toBe(0);
 const first=host.install();await expect(host.install()).rejects.toThrow(/verified update/);await new Promise(resolve=>setTimeout(resolve,20));expect(installs).toBe(1);release();await first;
}));
it('rejects corrupt downloads and changed cached installer bytes before any install callback',async()=>temp(async directory=>{
 let installs=0;const bad=transport(signed(),Buffer.from('changed'));
 const host=createUpdateHost({directory,currentVersion:'0.1.0',publicKey,fetch:bad.fetch,install:async()=>{installs++;}});await host.check();await expect(host.download()).rejects.toThrow(/signed release/);expect(host.status().phase).toBe('error');expect(installs).toBe(0);
 const good=createUpdateHost({directory,currentVersion:'0.1.0',publicKey,fetch:transport().fetch,install:async()=>{installs++;}});await good.check();await good.download();const file=join(directory,`update-0.2.0-${sha256}.exe`);expect(await readFile(file)).toEqual(installer);await writeFile(file,Buffer.alloc(installer.length));await expect(good.install()).rejects.toThrow(/changed/);expect(installs).toBe(0);
}));
it('rejects non-vendor redirects and reports update-service failures without touching installed files',async()=>{
 await expect(vendorResponse(releaseUrl('0.2.0','foundry-update.json'),async()=>new Response(null,{status:302,headers:{Location:'http://127.0.0.1/private'}}))).rejects.toThrow(/redirect/);
 await expect(vendorResponse('https://other.example/installer.exe',async()=>new Response('bad'))).rejects.toThrow(/Untrusted/);
 await expect(vendorResponse(releaseUrl('0.2.0','foundry-update.json'),async()=>new Response('unavailable',{status:503}))).rejects.toThrow(/503/);
});
it('coalesces concurrent checks and limits automatic feed requests to once per six hours',async()=>temp(async directory=>{
 const network=transport(),options={directory,currentVersion:'0.1.0',publicKey,fetch:network.fetch,autoDownload:false,install:async()=>{throw Error('must not install');}};
 const host=createUpdateHost(options);await Promise.all([host.check(),host.check()]);expect(network.calls.filter(url=>url.startsWith('https://api.github.com/'))).toHaveLength(1);
 const again=createUpdateHost(options);await again.start();expect(network.calls.filter(url=>url.startsWith('https://api.github.com/'))).toHaveLength(1);
}));
it('removes only owned completed installer cache files after upgrading, preserving future downloads and local data',async()=>temp(async directory=>{
 const old=join(directory,`update-0.1.0-${sha256}.exe`),future=join(directory,`update-0.3.0-${sha256}.exe`),project=join(directory,'project.json');await writeFile(old,installer);await writeFile(future,installer);await writeFile(project,'operator data');await writeFile(join(directory,'last-check.json'),JSON.stringify({checkedAt:new Date().toISOString()}));
 const host=createUpdateHost({directory,currentVersion:'0.2.0',fetch:async()=>{throw Error('Recent check must not fetch');},install:async()=>{throw Error('must not install');}});await host.start();await expect(readFile(old)).rejects.toThrow();expect(await readFile(future)).toEqual(installer);expect(await readFile(project,'utf8')).toBe('operator data');
}));
it('requires explicit restart confirmation, forbids supplied paths/URLs, and blocks restart during slicing',async()=>{
 let active=true,installs=0;const app=express();app.use(express.json());registerUpdateRoutes(app,{status:()=>({available:true,phase:'ready',message:'test'}),check:async()=>({available:true,phase:'current',message:'test'}),download:async()=>({available:true,phase:'ready',message:'test'}),install:async()=>{installs++;return {available:true,phase:'installing',message:'test'};}},()=>active);app.use((error:Error,_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(400).json({error:error.message}));
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address() as any,url=`http://127.0.0.1:${address.port}/api/desktop/updates/`;
 const post=(action:string,body:unknown)=>fetch(url+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{expect((await post('install',{})).status).toBe(400);expect((await post('install',{confirmRestart:true,url:'https://evil.test'})).status).toBe(400);expect((await post('install',{confirmRestart:true})).status).toBe(400);expect(installs).toBe(0);active=false;expect((await post('install',{confirmRestart:true})).status).toBe(200);expect(installs).toBe(1);}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
