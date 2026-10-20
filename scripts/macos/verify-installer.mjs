/** Isolated native installation/two-launch verification; no normal profile or printers. */
import {parseArgs} from 'node:util';
import {resolve,join} from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {nativeMacTarget,run,hashFile} from './native-tools.mjs';
const {values}=parseArgs({options:{arch:{type:'string'},dmg:{type:'string'},evidence:{type:'string'},'unsigned-local':{type:'boolean',default:false}}});
const arch=nativeMacTarget(values.arch??process.arch);
if(!values.dmg||!values.evidence)throw Error('Supply --dmg and a NEW --evidence directory.');
const evidence=resolve(values.evidence),dmg=resolve(values.dmg);await mkdir(evidence);
const mount=join(evidence,'mount'),installed=join(evidence,'installed'),data=join(evidence,'isolated-data');
await mkdir(mount);await mkdir(installed);await mkdir(data);
const application=join(installed,'Catalyst Foundry.app');let mounted=false;
try{
 run('/usr/bin/hdiutil',['attach',dmg,'-readonly','-nobrowse','-mountpoint',mount]);mounted=true;
 run('/usr/bin/ditto',[join(mount,'Catalyst Foundry.app'),application]);
 if(!values['unsigned-local']){
  run('/usr/bin/codesign',['--verify','--deep','--strict',application]);
  run('/usr/bin/xcrun',['stapler','validate',dmg]);
  run('/usr/sbin/spctl',['--assess','--type','execute',application]);
 }
 run(process.execPath,['--import','tsx','scripts/macos/verify-runtime.ts',application,arch]);
 const phases=[];
 for(const phase of ['save','reopen']){
  const report=join(evidence,`launch-${phase}.json`),started=Date.now();let output='';
  const outcome=await new Promise((resolveResult,reject)=>{
   const environment={...process.env};delete environment.ELECTRON_RUN_AS_NODE;
   const child=spawn(join(application,'Contents/MacOS/Catalyst Foundry'),[`--foundry-smoke-report=${report}`,`--foundry-smoke-data=${data}`,`--foundry-smoke-phase=${phase}`],{stdio:['ignore','pipe','pipe'],env:environment});
   let timedOut=false;const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');},180_000),force=setTimeout(()=>child.kill('SIGKILL'),185_000);
   const append=chunk=>{output=(output+chunk.toString()).slice(-100_000);};child.stdout.on('data',append);child.stderr.on('data',append);
   child.once('error',error=>{clearTimeout(timer);clearTimeout(force);reject(error);});
   child.once('close',(code,signal)=>{clearTimeout(timer);clearTimeout(force);resolveResult({code,signal,timedOut});});
  });
  await writeFile(join(evidence,`launch-${phase}.log`),output);
  if(outcome.timedOut||outcome.code!==0)throw Error(`Native ${phase} launch failed: ${JSON.stringify(outcome)}`);
  const result=JSON.parse(await readFile(report,'utf8'));
  if(!result.passed||result.platform!=='darwin'||result.architecture!==arch||!result.packaged||!result.loopbackBound||!result.crossOriginBlocked)throw Error(`Native ${phase} report did not pass.`);
  phases.push({phase,exitCode:outcome.code,elapsedMs:Date.now()-started,projectId:result.persistence.id});
 }
 if(phases[0].projectId!==phases[1].projectId)throw Error('Save/reopen project identity changed.');
 await writeFile(join(evidence,'verification-summary.json'),JSON.stringify({passed:true,platform:'darwin',architecture:arch,dmgSha256:await hashFile(dmg),trustChecks:values['unsigned-local']?'unsigned local QA only':'signature, stapled DMG and Gatekeeper passed',phases,manualGpuVerified:false,slicingVerified:false,printerContacted:false,onshapeRequests:0},null,2)+'\n');
 console.log('Isolated native Mac install/save/reopen passed. GPU, native slicing and physical printer checks remain separate.');
}finally{if(mounted)run('/usr/bin/hdiutil',['detach',mount]);}
