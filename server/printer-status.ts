import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Express} from 'express';
import {z} from 'zod';
import type {SessionVault} from './sync';
import {probeLanPrinter,readLanSnapshot,validateLanHost,type LanCredentials} from './bambu-status-client';
import type {PrinterConnection,PrinterStatus,PrinterSnapshot} from '../src/domain/printer-status';
const host=z.string().max(15).refine(value=>{try{validateLanHost(value);return true;}catch{return false;}},'Use a private IPv4 printer address.');
const pairing=z.object({host,name:z.string().trim().min(1).max(80),model:z.enum(['X1','X2D']),serial:z.string().regex(/^[a-z\d]{8,32}$/i),accessCode:z.string().regex(/^\S{8}$/),fingerprint:z.string().regex(/^[a-f\d]{64}$/i),trustCertificate:z.literal(true)}).strict();
export class PrinterStatusService {
 private connection?:PrinterConnection;private accessCode?:string;private snapshot?:PrinterSnapshot;private error?:string;private inFlight?:Promise<PrinterStatus>;private lastAttempt=0;private revision=0;private writes:Promise<unknown>=Promise.resolve();
 constructor(private directory:string,private vault?:SessionVault,private reader:(v:LanCredentials)=>Promise<PrinterSnapshot>=readLanSnapshot,private probe:(host:string)=>Promise<string>=probeLanPrinter){}
 async load(){if(!this.vault)return this;try{const {id,...stored}=JSON.parse(this.vault.decrypt(await readFile(join(this.directory,'printer-status.vault'),'utf8')));z.string().uuid().parse(id);const valid=pairing.parse({...stored,trustCertificate:true});this.connection={id,name:valid.name,model:valid.model,host:valid.host,serial:valid.serial,fingerprint:valid.fingerprint.toLowerCase()};this.accessCode=valid.accessCode;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')this.error='Saved printer pairing could not be read. Pair it again.';}return this;}
 status():PrinterStatus{return {available:!!this.vault,connection:this.connection,snapshot:this.snapshot,error:this.error};}
 async certificate(value:unknown){if(!this.vault)throw Error('Printer pairing requires the Windows desktop app’s encrypted storage.');const request=z.object({host}).strict().parse(value);return {fingerprint:await this.probe(request.host)};}
 pair(value:unknown){const task=this.writes.then(()=>this.performPair(value));this.writes=task.catch(()=>{});return task;}
 private async performPair(value:unknown){if(!this.vault)throw Error('Encrypted printer storage is unavailable.');const valid=pairing.parse(value);if(this.inFlight)throw Error('Wait for the current printer status check.');
  const snapshot=await this.reader(valid);const id=randomUUID(),connection:PrinterConnection={id,name:valid.name,model:valid.model,host:valid.host,serial:valid.serial,fingerprint:valid.fingerprint.toLowerCase()};
  await mkdir(this.directory,{recursive:true});const temp=join(this.directory,`printer-${randomUUID()}.tmp`);await writeFile(temp,this.vault.encrypt(JSON.stringify({...connection,accessCode:valid.accessCode})),{mode:0o600});await rename(temp,join(this.directory,'printer-status.vault'));this.revision++;this.connection=connection;this.accessCode=valid.accessCode;this.snapshot=snapshot;this.error=undefined;this.lastAttempt=Date.now();return this.status();
 }
 async refresh(){if(!this.connection||!this.accessCode)throw Error('Pair a printer first.');if(this.inFlight)return this.inFlight;if(Date.now()-this.lastAttempt<15_000)return this.status();this.lastAttempt=Date.now();const revision=this.revision,credentials={...this.connection,accessCode:this.accessCode};
  this.inFlight=Promise.resolve().then(()=>this.reader(credentials)).then(snapshot=>{if(revision===this.revision){this.snapshot=snapshot;this.error=undefined;}}).catch(e=>{if(revision===this.revision)this.error=(e as Error).message;}).then(()=>this.status()).finally(()=>{this.inFlight=undefined;});return this.inFlight;
 }
 forget(){const task=this.writes.then(()=>this.performForget());this.writes=task.catch(()=>{});return task;}
 private async performForget(){this.revision++;this.connection=undefined;this.accessCode=undefined;this.snapshot=undefined;this.error=undefined;const {unlink}=await import('node:fs/promises');await unlink(join(this.directory,'printer-status.vault')).catch(e=>{if(e.code!=='ENOENT')throw e;});return this.status();}
}
export function registerPrinterStatusRoutes(app:Express,service:PrinterStatusService){
 app.get('/api/printers',(_req,res)=>res.json(service.status()));
 for(const [route,method] of [['probe','certificate'],['connect','pair'],['refresh','refresh'],['disconnect','forget']] as const)app.post('/api/printers/'+route,async(req,res,next)=>{try{res.json(await service[method](req.body));}catch(e){next(e);}});
}
