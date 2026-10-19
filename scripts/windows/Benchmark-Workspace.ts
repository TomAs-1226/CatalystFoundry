import {readFile,writeFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {Worker} from 'node:worker_threads';
import {deserializeProject,serializeProject} from '../../src/domain/persistence';
import {fingerprint,isApprovalCurrent,isToolpathCurrent} from '../../src/domain/invariants';
const project=await deserializeProject(await readFile(process.argv[2],'utf8')),job=project.jobs[0];
const bundle=await build({entryPoints:['src/components/workspace-snapshot.worker.ts'],bundle:true,write:false,format:'cjs',platform:'browser'});
const worker=new Worker(`const {parentPort}=require('node:worker_threads');global.self={postMessage:value=>parentPort.postMessage(value)};${bundle.outputFiles[0].text};parentPort.on('message',data=>self.onmessage({data}));`,{eval:true});
async function measure(action:()=>Promise<unknown>){let last=performance.now(),maxDelay=0,ticks=0;const timer=setInterval(()=>{const now=performance.now();maxDelay=Math.max(maxDelay,now-last-5);last=now;ticks++;},5);const started=performance.now();try{const result=await action();await new Promise(resolve=>setTimeout(resolve,15));return {elapsedMs:performance.now()-started,maximumMainThreadDelayMs:maxDelay,heartbeatTicks:ticks,result};}finally{clearInterval(timer);}}
const offThread=()=>new Promise<any>((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);worker.postMessage({key:1,project});});
try{
 const baseline=await measure(async()=>{const [manifest,approvalCurrent,toolpathCurrent]=await Promise.all([fingerprint(project,job),isApprovalCurrent(project,job),isToolpathCurrent(project,job)]);return {json:serializeProject(project,false),manifest,approvalCurrent,toolpathCurrent};});
 const improved=await measure(offThread),a=baseline.result as any,b=improved.result as any;
 if(a.json!==b.json||a.approvalCurrent!==b.approvalCurrent||a.toolpathCurrent!==b.toolpathCurrent)throw Error('Worker output differs from authoritative domain checks.');
 const {result:_before,...before}=baseline,{result:_after,...after}=improved;
 const report={at:new Date().toISOString(),passed:true,runtime:process.version,platform:process.platform,fixture:'Public NON-MANUFACTURABLE two-hole native project',projectJsonBytes:Buffer.byteLength(a.json),before,after,exactSaveBytesMatch:true,currencyChecksMatch:true,scope:'Headless Node main-thread heartbeat versus the actual bundled workspace worker. Not browser/GPU/FPS, visual smoothness or low-end hardware qualification.'};
 await writeFile(process.argv[3],JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{await worker.terminate();}
