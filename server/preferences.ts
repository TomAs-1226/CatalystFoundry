import type {Express} from 'express';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
const schema=z.object({viewerQuality:z.enum(['auto','quality','economy'])}).strict();
export function registerPreferences(app:Express,directory:string){
 const file=join(directory,'preferences.json');let pending=Promise.resolve();
 app.get('/api/preferences',async(_req,res,next)=>{try{let value;try{value=schema.parse(JSON.parse(await readFile(file,'utf8')));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;value={viewerQuality:'auto'};}res.json(value);}catch(error){next(error);}});
 app.put('/api/preferences',async(req,res,next)=>{try{const value=schema.parse(req.body);const write=pending.then(async()=>{const temp=join(directory,`.preferences-${randomUUID()}.tmp`);await writeFile(temp,JSON.stringify(value),{mode:0o600});await rename(temp,file);});pending=write.catch(()=>{});await write;res.json(value);}catch(error){next(error);}});
}
