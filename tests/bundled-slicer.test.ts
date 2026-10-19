import { mkdtemp, mkdir, writeFile, readFile, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bundledConfiguration, relocateBundledConfiguration, verifyRuntime } from '../server/bundled-slicer';
import { hashBytes } from '../server/slicing-config';

describe('bundled slicer integrity and explicit review',()=>{
  it('rejects changed DLLs, missing files, manifest changes and path escapes',async()=>{
    const directory=await mkdtemp(join(tmpdir(),'foundry-runtime-'));
    try {
      const entries=[{path:'bambu-studio.exe',bytes:'exe'},{path:'BambuStudio.dll',bytes:'dll'},{path:'catalog.json',bytes:'[]'}];
      for(const entry of entries)await writeFile(join(directory,entry.path),entry.bytes);
      const manifest=JSON.stringify({version:'2.8.2.61',files:entries.map(e=>({path:e.path,sha256:hashBytes(e.bytes)}))});
      await writeFile(join(directory,'runtime-manifest.json'),manifest);
      const hash=await verifyRuntime(directory);
      expect(hash).toBe(hashBytes(manifest));
      await expect(bundledConfiguration(directory,directory,'unknown',false)).rejects.toThrow(/Review/);
      await expect(bundledConfiguration(directory,directory,'unknown',true)).rejects.toThrow(/catalog/);
      await writeFile(join(directory,'BambuStudio.dll'),'changed');
      await expect(verifyRuntime(directory,hash)).rejects.toThrow(/file changed/);
      await writeFile(join(directory,'BambuStudio.dll'),'dll');
      await rm(join(directory,'bambu-studio.exe'));
      await expect(verifyRuntime(directory,hash)).rejects.toThrow();
      await writeFile(join(directory,'runtime-manifest.json'),'{}');
      await expect(verifyRuntime(directory,hash)).rejects.toThrow(/manifest changed/);
      await writeFile(join(directory,'runtime-manifest.json'),JSON.stringify({version:'2.8.2.61',files:[{path:'../outside',sha256:hashBytes('outside')}]}));
      await expect(verifyRuntime(directory)).rejects.toThrow(/mapping/);
    }finally{await rm(directory,{recursive:true,force:true});}
  });
});

it('relocates an identical reviewed runtime and rejects changed mappings or bytes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'foundry-relocate-')),original=join(root,'old-install'),current=join(root,'new-install');
 try{
  await mkdir(original);
  const files={machine:{path:'machine.json',sha256:hashBytes('machine')},filament:{path:'filament.json',sha256:hashBytes('filament')},process:{path:'process.json',sha256:hashBytes('process')}};
  const profile={id:'test-x1',label:'SYNTHETIC TEST PROFILE',printer:{id:'test',model:'Bambu Lab X1 Carbon',nozzleDiameter:.4,plate:'Textured PEI Plate',buildVolume:[256,256,256],tested:false},material:{id:'test',type:'PLA',name:'Test PLA',color:'#ffffff',tested:false},files};
  const entries=[{path:'bambu-studio.exe',bytes:'synthetic exe'},{path:'BambuStudio.dll',bytes:'synthetic dll'},{path:'catalog.json',bytes:JSON.stringify([profile])},...Object.entries(files).map(([kind,file])=>({path:file.path,bytes:kind}))];
  for(const file of entries)await writeFile(join(original,file.path),file.bytes);
  await writeFile(join(original,'runtime-manifest.json'),JSON.stringify({version:'2.8.2.61',files:entries.map(file=>({path:file.path,sha256:hashBytes(file.bytes)}))}));
  const saved=await bundledConfiguration(original,join(root,'old-data'),'test-x1',true);
  await cp(original,current,{recursive:true});await rm(original,{recursive:true});
  const relocated=await relocateBundledConfiguration(saved,current,join(root,'user-data'));
  expect(relocated.runtime?.directory).toBe(current);expect(relocated.machine.path).toBe(join(current,'machine.json'));expect(relocated.workRoot).toBe(join(root,'user-data','slicer-work'));expect(relocated.runtime?.sha256).toBe(saved.runtime?.sha256);
  await expect(relocateBundledConfiguration({...saved,completeProfilesReviewed:false} as never,current,root)).rejects.toThrow(/Review/);
  await expect(relocateBundledConfiguration({...saved,material:{...saved.material,type:'PETG'}},current,root)).rejects.toThrow(/mapping changed/);
  await writeFile(join(current,'BambuStudio.dll'),'tampered');await expect(relocateBundledConfiguration(saved,current,root)).rejects.toThrow(/file changed/);
 }finally{await rm(root,{recursive:true,force:true});}
});
