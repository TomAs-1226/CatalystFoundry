import type {Express} from 'express';
import {z} from 'zod';
export interface UpdateStatus {available:boolean;currentVersion?:string;version?:string;phase:string;message:string;progress?:number;repository?:string;channel?:string;checkedAt?:string;}
export interface UpdateHost {status:()=>UpdateStatus;check:()=>Promise<UpdateStatus>;download:()=>Promise<UpdateStatus>;install:()=>Promise<UpdateStatus>;}
const empty=z.object({}).strict(),confirmation=z.object({confirmRestart:z.literal(true)}).strict();
export function registerUpdateRoutes(app:Express,host:UpdateHost|undefined,active:()=>boolean){
 app.get('/api/desktop/updates',(_req,res)=>res.json(host?.status()??{available:false,phase:'unavailable',message:'Automatic updates are unavailable in this build. Install a new native package to update.'}));
 for(const action of ['check','download','install'] as const)app.post('/api/desktop/updates/'+action,async(req,res,next)=>{
  try{
   (action==='install'?confirmation:empty).parse(req.body??{});
   if(!host)throw Error('Desktop updates are unavailable in this build.');
   if(action==='install'&&active())throw Error('Wait for slicing to finish or cancel it before restarting Foundry.');
   res.json(await host[action]());
  }catch(error){next(error);}
 });
}
