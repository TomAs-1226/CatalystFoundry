/** Replays public native artifacts through the App-owned session; no UI or printers. */
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {unzipSync,strFromU8} from 'fflate';
import {deserializeProject,serializeProject} from '../../src/domain/persistence';
import {attachToolpath,approveJob,reviewToolpath,isToolpathCurrent,isApprovalCurrent,fingerprint,sha256} from '../../src/domain/invariants';
import {SliceSession,type SliceSessionState} from '../../src/components/slice-session';
import type {SliceJob} from '../../src/adapters/slicing';
const input=resolve(process.argv[2]??'../../evidence/approval-process-native'),out=resolve(process.argv[3]??'../../evidence/review-connect-native-session');await mkdir(out,{recursive:true});
const prior=JSON.parse(await readFile(join(input,'summary.json'),'utf8')),reports=[];
for(const record of prior.reports){
 const folder=(record.model==='Bambu Lab X2D'?'bambu-lab-x2d-pla-04':'bambu-lab-x1-pla-04')+'-'+record.kind;
 const project=await deserializeProject(await readFile(join(input,folder,'NON-MANUFACTURABLE.project.json'),'utf8')),job=project.jobs[0];
 if(project.parts.some(p=>p.source.kind!=='fixture'))throw Error('Public fixtures only');delete job.toolpath;delete job.approval;delete job.operatorChecks;
 const bytes=await readFile(join(input,folder,'NON-MANUFACTURABLE.3mf')),archive=unzipSync(bytes),entry=Object.keys(archive).find(key=>/plate_\d+\.gcode$/i.test(key));if(!entry||await sha256(bytes)!==record.nativeProjectHash)throw Error('Public native artifact mismatch');const gcode=strFromU8(archive[entry]);if(await sha256(gcode)!==record.toolpathHash)throw Error('Native G-code hash changed');
 const slice:SliceJob={id:'public-session-'+folder,manifestHash:await fingerprint(project,job),idempotencyKey:'SOFTWARE ONLY',requestHash:'a'.repeat(64),status:'succeeded',progress:100,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),logs:[],result:{gcode,toolpathHash:record.toolpathHash,slicerVersion:record.slicerVersion,preparationVersion:record.preparationVersion,nozzleOffset:record.nozzleOffset,projectHash:record.nativeProjectHash,slicerProject:{name:'NON-MANUFACTURABLE.3mf',hash:record.nativeProjectHash,data:bytes.toString('base64'),encoding:'base64',format:'3mf'},previewSupported:true,demonstration:false}};
 let state:SliceSessionState={phase:'idle',message:''},previews=0;
 const session=new SliceSession({current:()=>({project,job}),busy:()=>false,list:async hash=>hash===slice.manifestHash?[slice]:[],read:async()=>slice,changed:next=>{state=next;},attach:async result=>{await attachToolpath(project,job,result.result!.gcode,{name:'NON-MANUFACTURABLE session replay',source:'bambu',preparationVersion:record.preparationVersion,nozzleOffset:record.nozzleOffset,mappingConfirmed:true,slicerProject:result.result!.slicerProject});return true;},preview:()=>{previews++;}});
 try{
  // The workspace panel is absent. Restoration is owned by the root session.
  await session.restore();if(state.phase!=='ready'||previews!==1||!await isToolpathCurrent(project,job))throw Error('Review-page recovery did not commit exact native output: '+state.message);
  await reviewToolpath(project,job,'Software fixture reviewer');await approveJob(project,job,'Software fixture reviewer');if(job.approval?.demonstrationOnly!==true)throw Error('Fixture became manufacturable');
  const reopened=await deserializeProject(serializeProject(project));if(!await isApprovalCurrent(reopened,reopened.jobs[0]))throw Error('Current review did not survive portable reopen');
  job.settings.walls++;await session.restore();if(state.phase!=='outdated'||await isApprovalCurrent(project,job))throw Error('Old ready/approval state survived edit');
  reports.push({model:record.model,kind:record.kind,nativeProjectHash:record.nativeProjectHash,toolpathHash:record.toolpathHash,layerAttachmentCommitted:true,reviewRecovery:true,approvalDemonstrationOnly:true,portableReopenCurrent:true,editShowsOutdated:true,printerContacted:false,onshapeRequests:0});
 }finally{session.dispose();}
}
await writeFile(join(out,'summary.json'),JSON.stringify({passed:true,at:new Date().toISOString(),scope:'Six existing actual native public fixture artifacts replayed through the new App-owned session with the workspace panel absent. No fresh native slicing in this check, actual UI automation, Onshape or printer contact.',reports},null,2)+'\n');console.log(JSON.stringify({passed:true,nativeArtifacts:reports.length,reviewRecovery:true,onshapeRequests:0,printerContacted:false}));
