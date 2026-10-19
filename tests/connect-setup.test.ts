import {afterEach,expect,it,vi} from 'vitest';
import {createRequire} from 'node:module';
import {mkdtemp,rm,writeFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import express from 'express';
import {once} from 'node:events';
import {PrintingService,registerPrintingRoutes} from '../server/printing';
import type {SlicingContext} from '../server/slicing-http';
const {createConnectHost,trustedPublisher,download}=createRequire(import.meta.url)('../electron/bambu-setup.cjs');
const dirs:string[]=[];afterEach(async()=>{await Promise.all(dirs.splice(0).map(dir=>rm(dir,{recursive:true,force:true})));});
const publisher='CN="Shanghai Lunkuo Technology Co., Ltd", O="Shanghai Lunkuo Technology Co., Ltd", C=CN';
async function environment(installed=false){const directory=await mkdtemp(join(tmpdir(),'foundry-connect-test-'));dirs.push(directory);const application=join(directory,'Bambu Connect.exe');if(installed)await writeFile(application,'SOFTWARE TEST PLACEHOLDER');const launch=vi.fn(async()=>{}),runInstaller=vi.fn(async()=>{}),transfer=vi.fn(async(file:string)=>{await writeFile(file,'THIS IS NOT A VENDOR INSTALLER');});const host=createConnectHost({platform:'win32',programDirectory:directory,downloadDirectory:join(directory,'downloads'),registeredProgram:async()=>application,signature:async(file:string)=>{await stat(file);return{status:'Valid',publisher,version:'SOFTWARE TEST ONLY'};},launch,runInstaller,download:transfer});return{host,launch,runInstaller,transfer,directory,application};}
it('requires a valid exact publisher identity, not a matching name in an unrelated certificate field',()=>{
 expect(trustedPublisher({status:'Valid',publisher})).toBe(true);for(const value of [{status:'UnknownError',publisher},{status:'Valid',publisher:'CN="Shanghai Lunkuo Technology Co., Ltd", O="Other vendor", C=CN'},{status:'Valid',publisher:'O="Fake Shanghai Lunkuo Technology Co., Ltd", C=CN'}])expect(trustedPublisher(value)).toBe(false);
});
it('does not install or launch during detection; an explicit empty launch contains no file or printer instruction',async()=>{
 const e=await environment(true);expect((await e.host.capability()).available).toBe(true);expect(e.launch).not.toHaveBeenCalled();expect(e.transfer).not.toHaveBeenCalled();await e.host.launch();expect(e.launch).toHaveBeenCalledExactlyOnceWith(e.application);
 await expect(e.host.open('relative.3mf','test')).rejects.toThrow(/absolute/);expect(e.launch).toHaveBeenCalledTimes(1);
});
it('serializes setup of an existing companion and rejects changed installer bytes before execution',async()=>{
 const installed=await environment(true);await Promise.all([installed.host.install(),installed.host.install()]);await vi.waitFor(()=>expect(installed.host.status().phase).toBe('installed'));expect(installed.launch).toHaveBeenCalledTimes(1);expect(installed.runInstaller).not.toHaveBeenCalled();
 const fresh=await environment();await fresh.host.install();await vi.waitFor(()=>expect(fresh.host.status().phase).toBe('error'));expect(fresh.host.status().message).toMatch(/hash and publisher/);expect(fresh.runInstaller).not.toHaveBeenCalled();expect(fresh.launch).not.toHaveBeenCalled();
});
it('blocks a non-vendor redirect and oversized response before accepting a download',async()=>{
 const e=await environment(),redirect=vi.fn(async()=>new Response(null,{status:302,headers:{location:'http://127.0.0.1:1/private'}}));await expect(download(join(e.directory,'test.exe'),()=>{},redirect)).rejects.toThrow(/pinned HTTPS/);expect(redirect).toHaveBeenCalledTimes(1);
 const oversized=vi.fn(async()=>new Response('not executable',{status:200,headers:{'content-length':String(151*1024*1024)}}));await expect(download(join(e.directory,'test.exe'),()=>{},oversized)).rejects.toThrow(/limit/);
});
it('exposes explicit local install/open actions without fabricating login state or sending a manufacturing job',async()=>{
 const e=await environment(true),install=vi.fn(async()=>{}),open=vi.fn(async()=>{}),launch=vi.fn(async()=>{}),service=new PrintingService(e.directory,{} as SlicingContext,{capability:async()=>({available:true,reason:'SOFTWARE TEST'}),open,install,launch,status:()=>({phase:'installed',message:'SOFTWARE TEST'})});
 const app=express();app.use(express.json());registerPrintingRoutes(app,service);app.use((_error:unknown,_req:unknown,res:any,_next:unknown)=>res.status(400).json({error:'Invalid setup action'}));const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+(server.address() as any).port;
 try{const setup=await fetch(base+'/api/printing/setup').then(r=>r.json());expect(setup).toMatchObject({canInstall:true,canOpen:true,loginStatus:'unknown',printerStatus:'unknown'});
 const post=(route:string,body:unknown)=>fetch(base+'/api/printing/connect/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 expect((await post('install',{confirmInstall:false})).status).toBe(400);expect((await post('install',{confirmInstall:true,url:'https://example.com/evil.exe'})).status).toBe(400);expect(install).not.toHaveBeenCalled();expect((await post('install',{confirmInstall:true})).status).toBe(200);expect((await post('open',{})).status).toBe(200);expect(install).toHaveBeenCalledTimes(1);expect(launch).toHaveBeenCalledTimes(1);expect(open).not.toHaveBeenCalled();
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
