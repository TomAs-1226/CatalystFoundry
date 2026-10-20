import { RemoteSync,registerSyncRoutes,type SyncOptions } from "./sync";
import { PrintingService, registerPrintingRoutes, type ConnectHost } from "./printing";
import express from 'express';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { deserializeProject, serializeProject } from '../src/domain/persistence';
import { createConfiguredSlicing, registerSlicingRoutes } from './slicing-http';
import { createConfiguredOnshapeService, type OnshapeServiceOptions } from './onshape-service';
import { registerOnshapeRoutes } from './onshape-http';
import {CadLibrary,registerCadLibraryRoutes} from './cad-library';
import {PrinterStatusService,registerPrinterStatusRoutes} from './printer-status';
import {registerUpdateRoutes,type UpdateHost} from './desktop-updates';
import {registerPreferences} from './preferences';
export async function createApp(options:{updates?:UpdateHost;sync?:SyncOptions;printing?:ConnectHost;dataDirectory?:string;staticDirectory?:string;onshape?:OnshapeServiceOptions;slicing?:Parameters<typeof createConfiguredSlicing>[1]}={}){
 const directory=options.dataDirectory??path.resolve('.data');await mkdir(directory,{recursive:true});
 const store=path.join(directory,'project.json');const slicingContext=await createConfiguredSlicing(directory,options.slicing);
 const sync=await new RemoteSync(directory,options.sync).load();
 const library=new CadLibrary(directory,sync);
 const onshapeOptions=options.onshape??(process.env.ONSHAPE_ACCESS_TOKEN_FILE?undefined:{transport:sync.transport(),connectionStatus:async()=>{const status=await sync.status();return{available:!!status.signedIn&&!!status.onshapeConnected,reason:status.reason};}});
 const onshape=createConfiguredOnshapeService({...onshapeOptions,onImported:async(parts,selection)=>{const result=await library.saveParts(parts,selection);void library.kick();return result;}});
 const printing=new PrintingService(directory,slicingContext,options.printing,sync);
 const printerStatus=await new PrinterStatusService(directory,options.sync?.vault).load();
 const app=express();app.locals.shutdown=async()=>{library.stop();sync.records.stop();onshape.shutdown();await slicingContext.service.shutdown()};app.disable('x-powered-by');app.use('/api/project',express.json({limit:'100mb'}));app.use(express.json({limit:'35mb'}));
 // Local-only service: no accounts or secrets; same-origin browser mutations only.
 app.use('/api',(req,res,next)=>{res.setHeader('Cache-Control','no-store');const origin=req.headers.origin;if(origin&&origin!==`${req.protocol}://${req.headers.host}`&&!/^http:\/\/(localhost|127\.0\.0\.1):5173$/.test(origin)){res.status(403).json({error:'This local service accepts same-origin requests only.'});return}next()});
 app.get('/api/capabilities',async(_req,res,next)=>{try{res.json({onshape:await onshape.capability(),slicing:await slicingContext.service.getCapability(),handoff:{...await printing.capability(),mode:'bambu-connect-native-review',printerStatus:'unknown'},laser:{available:false,reason:'No laser machine selected.'}})}catch(e){next(e)}});
 registerOnshapeRoutes(app,onshape);
 registerPreferences(app,directory);
 registerUpdateRoutes(app,options.updates,()=>slicingContext.service.listJobs().some(job=>['queued','running'].includes(job.status)));
 registerCadLibraryRoutes(app,library);await library.start();
 registerSyncRoutes(app,sync,()=>{onshape.resetConnection();sync.records.kick();});sync.records.start();void printing.recoverReports().catch(()=>{});
 app.get('/api/project',async(_req,res,next)=>{try{let data:string;try{data=await readFile(store,'utf8')}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT'){res.json({project:null});return}throw e}res.json({project:await deserializeProject(data)})}catch(e){next(e)}});
 let writes=Promise.resolve();
 app.put('/api/project',async(req,res,next)=>{try{const project=await deserializeProject(JSON.stringify(req.body));const contents=serializeProject(project);const write=writes.then(async()=>{const temp=path.join(directory,`.project-${randomUUID()}.tmp`);await writeFile(temp,contents,{mode:0o600});await rename(temp,store)});writes=write.catch(()=>{});await write;res.json({saved:true,id:project.id,updatedAt:project.updatedAt})}catch(e){next(e)}});
 registerSlicingRoutes(app,slicingContext);
 registerPrintingRoutes(app,printing);
 registerPrinterStatusRoutes(app,printerStatus);
 if(options.staticDirectory){app.use(express.static(options.staticDirectory));app.get('/{*path}',(_req,res)=>res.sendFile(path.join(options.staticDirectory!,'index.html')))}
 app.use((error:Error&{status?:number},_req:express.Request,res:express.Response,_next:express.NextFunction)=>{res.status(error.status??400).json({error:error.message||'Local service failed.',...('code' in error?{code:error.code}:{})})});
 return app;
}
