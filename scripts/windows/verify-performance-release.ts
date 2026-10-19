import {readFile,readdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {Worker} from 'node:worker_threads';
import {createHash} from 'node:crypto';
import {parseGcode} from '../../src/adapters/toolpaths';
import {buildPathBuffers} from '../../src/components/toolpath-buffers';
const evidence=resolve(process.argv[2]),output=resolve(process.argv[3]),assets='dist/assets';
const names=await readdir(assets),snapshot=names.find(n=>n.startsWith('workspace-snapshot.worker-'))!,preview=names.find(n=>n.startsWith('toolpath-preview.worker-'))!;
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
function worker(code:string){return new Worker(`const {parentPort}=require('node:worker_threads');global.self={postMessage:(value,options)=>parentPort.postMessage(value,options?.transfer)};${code};parentPort.on('message',data=>self.onmessage({data}));`,{eval:true});}
const snapshotCode=await readFile(join(assets,snapshot),'utf8'),previewCode=await readFile(join(assets,preview),'utf8'),a=worker(snapshotCode),b=worker(previewCode);
const request=(target:Worker,value:unknown)=>new Promise<any>((resolve,reject)=>{const failed=(error:Error)=>{target.removeListener('message',ready);reject(error);};const ready=(value:unknown)=>{target.removeListener('error',failed);resolve(value);};target.once('message',ready);target.once('error',failed);target.postMessage(value);});
const reports=[];
try{
 for(const entry of await readdir(evidence,{withFileTypes:true})){
  if(!entry.isDirectory())continue;
  const project=JSON.parse(await readFile(join(evidence,entry.name,'NON-MANUFACTURABLE.project.json'),'utf8')),job=project.jobs[0];
  const current=await request(a,{key:1,project});
  if(current.error||!current.approvalCurrent||!current.toolpathCurrent||JSON.parse(current.json).jobs[0].approval.demonstrationOnly!==true)throw Error('Compiled worker rejected exact approved fixture '+entry.name+': '+current.error);
  const changed=structuredClone(project);changed.jobs[0].settings.walls++;const stale=await request(a,{key:2,project:changed});
  if(stale.approvalCurrent||stale.toolpathCurrent)throw Error('Compiled worker accepted changed manufacturing inputs');
  const paths=await request(b,{key:entry.name,gcode:job.toolpath.gcode,nativeBambu:true}),parsed=parseGcode(job.toolpath.gcode,{nativeBambu:true}),expected=buildPathBuffers(parsed);
  if(paths.error||!paths.preview.canApprove||paths.preview.segmentCount!==parsed.segments.length||paths.preview.segments!==undefined||paths.preview.renderBuffers.length!==expected.length)throw Error('Compiled packed preview mismatch');
  for(let i=0;i<expected.length;i++)for(const key of ['positions','starts','widths','heights'] as const){const x=expected[i][key],y=paths.preview.renderBuffers[i][key];if(hash(new Uint8Array(x.buffer,x.byteOffset,x.byteLength))!==hash(new Uint8Array(y.buffer,y.byteOffset,y.byteLength)))throw Error('Native preview array changed: '+key);}
  reports.push({fixture:entry.name,exactCurrency:true,exactCompactSave:true,changedInputsStale:true,packedNativeArraysMatch:true,segments:parsed.segments.length,fixtureDemonstrationOnly:true});
 }
 const report={passed:reports.length===6,at:new Date().toISOString(),reports,workers:{snapshot:{file:snapshot,sha256:hash(Buffer.from(snapshotCode))},preview:{file:preview,sha256:hash(Buffer.from(previewCode))}},scope:'Actual minified production worker assets executed headlessly against six existing byte-verified public X1/X2D holes/normal/tree native fixtures. No new native slice, Onshape calls, UI interaction, GPU or printer actions.'};if(!report.passed)throw Error('Expected six public native fixtures');
 await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,reports:report.reports.map(r=>({fixture:r.fixture,segments:r.segments,passed:true}))},null,2));
}finally{await a.terminate();await b.terminate();}
