import {expect,it} from 'vitest';
import {build} from 'esbuild';
import {Worker} from 'node:worker_threads';
import {createProject} from '../src/domain/model';
import {deserializeProject,serializeProject} from '../src/domain/persistence';
import {viewerBudget} from '../src/components/viewer-quality';
it('executes the shipped snapshot worker and returns compact recoverable bytes with fail-closed current flags',async()=>{
 const bundle=await build({entryPoints:['src/components/workspace-snapshot.worker.ts'],bundle:true,write:false,format:'cjs',platform:'browser'});
 const worker=new Worker(`const {parentPort}=require('node:worker_threads');global.self={postMessage:value=>parentPort.postMessage(value)};${bundle.outputFiles[0].text};parentPort.on('message',data=>self.onmessage({data}));`,{eval:true});
 const request=(project:unknown)=>new Promise<any>((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);worker.postMessage({key:7,project});});
 try{
  const project=createProject('Local restart recovery'),result=await request(project);expect(result.key).toBe(7);expect(result.toolpathCurrent).toBe(false);expect(result.approvalCurrent).toBe(false);expect(result.json.length).toBeLessThan(serializeProject(project).length);expect(await deserializeProject(result.json)).toEqual(project);
  const corrupt=structuredClone(project);corrupt.jobs[0].toolpath={hash:'bad'} as any;const bad=await request(corrupt);expect(bad.error).toBeTruthy();expect(bad.json).toBeUndefined();
 }finally{await worker.terminate();}
});
it('keeps display quality independent of manufacturing and bounds heavy/moving scenes',()=>{
 expect(viewerBudget('auto',500_000)).toMatchObject({shadows:false,pixels:1_200_000});expect(viewerBudget('auto',500_000,true)).toMatchObject({edges:false,shadows:false,pixels:1_000_000});expect(viewerBudget('economy',10)).toMatchObject({edges:false,shadows:false,pixels:650_000});expect(viewerBudget('quality',500_000)).toMatchObject({shadows:true});
});
