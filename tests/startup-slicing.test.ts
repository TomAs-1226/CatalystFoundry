import {expect,it,vi} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server/app';
import * as bundled from '../server/bundled-slicer';
import {createProject} from '../src/domain/model';
import {serializeProject} from '../src/domain/persistence';

it('serves the saved project during verification and keeps slicer routes blocked, including a failed integrity check',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'foundry-startup-gate-')),project=createProject('PUBLIC startup gate fixture');await writeFile(join(directory,'project.json'),serializeProject(project));await writeFile(join(directory,'bundled-slicer.json'),'{}');
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});const verification=vi.spyOn(bundled,'relocateBundledConfiguration').mockImplementation(async()=>{await gate;throw Error('Controlled full-runtime integrity failure');});const runner=vi.fn();let app:Awaited<ReturnType<typeof createApp>>|undefined,server:ReturnType<Awaited<ReturnType<typeof createApp>>['listen']>|undefined;
 try{
  const opening=createApp({dataDirectory:directory,slicing:{deferInitialization:true,bundledDirectory:directory,runner}});
  app=await Promise.race([opening,new Promise<never>((_,reject)=>{const timer=setTimeout(()=>reject(Error('Project service waited for slicer verification')),1500);timer.unref();})]);
  server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server!.once('listening',resolve));const origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
  expect((await (await fetch(origin+'/api/project')).json()).project.id).toBe(project.id);
  let responded=false;const setup=fetch(origin+'/api/slicing/setup').then(async response=>{responded=true;return response.json();});await new Promise(resolve=>setTimeout(resolve,40));expect(responded).toBe(false);expect(runner).not.toHaveBeenCalled();
  release();expect(await setup).toMatchObject({configured:false,capability:{available:false,reason:'Controlled full-runtime integrity failure'}});
  const attempt=await fetch(origin+'/api/slicing/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});expect(attempt.status).toBe(503);expect(await attempt.json()).toMatchObject({error:'Controlled full-runtime integrity failure'});expect(runner).not.toHaveBeenCalled();
  expect((await (await fetch(origin+'/api/project')).json()).project.id).toBe(project.id);
 }finally{release();verification.mockRestore();if(app)await app.locals.shutdown();if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));await rm(directory,{recursive:true,force:true});}
});
