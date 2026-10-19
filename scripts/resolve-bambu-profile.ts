/** Offline helper; resolves data only, never launches a slicer or connects to a printer. */
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {resolveProfile,type ProfileDocument} from '../server/profile-resolver';
import {validateFullProfile,hashBytes} from '../server/slicing-config';
const [directory,kind,name,output]=process.argv.slice(2);
if(!directory||!['machine','filament','process'].includes(kind)||!name||!output)throw new Error('Usage: npx tsx scripts/resolve-bambu-profile.ts <one vendor/release profile directory> <machine|filament|process> "exact profile name" <output.json>');
const documents=new Map<string,ProfileDocument>();
for(const filename of await readdir(join(resolve(directory),kind))){if(!filename.endsWith('.json'))continue;const doc=JSON.parse(await readFile(join(resolve(directory),kind,filename),'utf8')) as ProfileDocument;if(typeof doc.name!=='string')continue;if(documents.has(doc.name))throw new Error(`Ambiguous profile/template name: ${doc.name}`);documents.set(doc.name,doc);}
const document=resolveProfile(name,n=>documents.get(n));validateFullProfile(kind as 'machine'|'filament'|'process',document);
const bytes=JSON.stringify(document,null,2)+'\n';await mkdir(resolve(output,'..'),{recursive:true});await writeFile(resolve(output),bytes,{mode:0o600});console.log(JSON.stringify({output:resolve(output),sha256:hashBytes(bytes),name,warning:'Resolved software profile only. No physical qualification or printer verification performed.'},null,2));
