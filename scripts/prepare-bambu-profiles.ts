/** Resolve matching upstream profiles for either native runtime, without changing vendor bytes. */
import {mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {resolveProfile,type ProfileDocument} from '../server/profile-resolver';
import {hashBytes,validateFullProfile,validateConfiguredProfiles,type SlicingFileConfig} from '../server/slicing-config';
export async function prepareBambuProfiles(profiles:string,output:string){
 const trees:Record<string,Map<string,ProfileDocument>>={};
 for(const kind of ['machine','filament','process']){
  const tree=trees[kind]=new Map();
  for(const name of await readdir(join(profiles,kind))){
   if(!name.endsWith('.json'))continue;
   const doc=JSON.parse(await readFile(join(profiles,kind,name),'utf8'));
   if(!doc.name)continue;if(tree.has(doc.name))throw Error(`Ambiguous ${kind}: ${doc.name}`);tree.set(doc.name,doc);
  }
 }
 const catalog=[];
 for(const [model,family] of [['Bambu Lab P1S','X1C'],['Bambu Lab X1','X1C'],['Bambu Lab X2D','X2D'],['Bambu Lab X1 Carbon','X1C'],['Bambu Lab A1','A1'],['Bambu Lab A1 mini','A1M']] as const){
  for(const material of ['PLA','PETG']){
   const names={machine:`${model} 0.4 nozzle`,filament:`Generic ${material} @BBL ${family}`,process:`0.20mm Standard @BBL ${family}`};
   if(family==='X2D')names.filament=`Generic ${material} @BBL X2D 0.4 nozzle`;
   if(!trees.filament.has(names.filament)&&family==='X1C')names.filament=`Generic ${material}`;
   const id=`${model.replace(/[^a-z0-9]/gi,'-').toLowerCase()}-${material.toLowerCase()}-04`;
   const files:Record<string,{path:string;sha256:string}>={},documents:Record<string,ProfileDocument>={};
   for(const kind of ['machine','filament','process'] as const){
    const doc=resolveProfile(names[kind],name=>trees[kind].get(name));validateFullProfile(kind,doc);documents[kind]=doc;
    const bytes=JSON.stringify(doc,null,2)+'\n',file=`foundry-profiles/${id}/${kind}.json`;
    await mkdir(join(output,'foundry-profiles',id),{recursive:true});await writeFile(join(output,file),bytes);
    files[kind]={path:file,sha256:hashBytes(bytes)};
   }
   const area=(documents.machine.printable_area as string[]).map(point=>point.split('x').map(Number));
   const buildVolume:[number,number,number]=[Math.max(...area.map(p=>p[0])),Math.max(...area.map(p=>p[1])),Number(documents.machine.printable_height)];
   const printer={id,model,nozzleDiameter:.4,plate:'Textured PEI Plate',buildVolume,tested:false as const,...(family==='X2D'?{nozzleCount:2,activeNozzle:'primary' as const}:{})};
   const mappedMaterial={id:`generic-${material.toLowerCase()}`,name:`Generic ${material}`,type:material,color:'#e94560',tested:false as const};
   validateConfiguredProfiles({printer,material:mappedMaterial,profileLabel:id} as SlicingFileConfig,documents.machine,documents.filament);
   catalog.push({id,label:`${model} · 0.4 mm · ${material}`,printer,material:mappedMaterial,files,upstream:names});
  }
 }
 await writeFile(join(output,'catalog.json'),JSON.stringify(catalog,null,2)+'\n');return catalog;
}
