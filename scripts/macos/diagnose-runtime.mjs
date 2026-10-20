import {readFile,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const root=resolve('vendor/bambu-macos-'+process.argv[2]);
const manifest=JSON.parse(await readFile(join(root,'runtime-manifest.json'),'utf8')),expected=new Set(manifest.files.map(f=>f.path)),actual=new Set();
async function visit(dir,prefix=''){for(const entry of await readdir(dir,{withFileTypes:true})){const name=prefix+entry.name;if(entry.isDirectory())await visit(join(dir,entry.name),name+'/');else if(name!=='runtime-manifest.json')actual.add(name);}}
await visit(root);console.log(JSON.stringify({scope:'Vendor runtime relative paths only; diagnostic does not modify or exempt files.',added:[...actual].filter(f=>!expected.has(f)),missing:[...expected].filter(f=>!actual.has(f))}));
