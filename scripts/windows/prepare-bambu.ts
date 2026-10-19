/** Build-time only. Input must be the hash-verified official portable ZIP extraction. */
import { cp, mkdir, readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { resolveProfile, type ProfileDocument } from '../../server/profile-resolver';
import { hashBytes, validateFullProfile, validateConfiguredProfiles, type SlicingFileConfig } from '../../server/slicing-config';
const input = resolve(process.argv[2] ?? '../../downloads/bambu');
const output = resolve('vendor/bambu');
await mkdir(output, { recursive: true });
await cp(input, output, { recursive: true, filter: path => !/\.pdb$/i.test(path) && !relative(input,path).split(/[\\/]/).includes('include') });
const profiles = join(output, 'resources/profiles/BBL');
const trees: Record<string, Map<string, ProfileDocument>> = {};
for (const kind of ['machine','filament','process']) {
  const tree = trees[kind] = new Map();
  for (const name of await readdir(join(profiles,kind))) {
    if (!name.endsWith('.json')) continue;
    const doc = JSON.parse(await readFile(join(profiles,kind,name),'utf8'));
    if (!doc.name) continue;
    if (tree.has(doc.name)) throw new Error(`Ambiguous ${kind}: ${doc.name}`);
    tree.set(doc.name,doc);
  }
}
const catalog = [];
for (const [model, family, volume] of [
  ['Bambu Lab P1S','X1C',[256,256,256]],
  ['Bambu Lab X1','X1C',[256,256,256]],
  ['Bambu Lab X2D','X2D',[256,256,256]],
  ['Bambu Lab X1 Carbon','X1C',[256,256,256]],
  ['Bambu Lab A1','A1',[256,256,256]],
  ['Bambu Lab A1 mini','A1M',[180,180,180]],
] as const) {
  for (const material of ['PLA','PETG']) {
    const names = { machine:`${model} 0.4 nozzle`, filament:`Generic ${material} @BBL ${family}`, process:`0.20mm Standard @BBL ${family}` };
    if(family==='X2D')names.filament=`Generic ${material} @BBL X2D 0.4 nozzle`;
    // X1C/P1S filament names in the upstream tree are the generic system profile.
    if (!trees.filament.has(names.filament) && family === 'X1C') names.filament = `Generic ${material}`;
    const id = `${model.replace(/[^a-z0-9]/gi,'-').toLowerCase()}-${material.toLowerCase()}-04`;
    const files: Record<string,{path:string;sha256:string}> = {};
    const documents: Record<string,ProfileDocument> = {};
    for (const kind of ['machine','filament','process'] as const) {
      const doc = resolveProfile(names[kind], name => trees[kind].get(name));
      validateFullProfile(kind,doc); documents[kind] = doc;
      const bytes = JSON.stringify(doc,null,2)+'\n';
      const file = `foundry-profiles/${id}/${kind}.json`;
      await mkdir(join(output,'foundry-profiles',id),{recursive:true});
      await writeFile(join(output,file),bytes);
      files[kind] = { path:file, sha256:hashBytes(bytes) };
    }
    const area = (documents.machine.printable_area as string[]).map(point=>point.split('x').map(Number));
    const actualVolume:[number,number,number] = [Math.max(...area.map(p=>p[0])),Math.max(...area.map(p=>p[1])),Number(documents.machine.printable_height)];
    const printer = { id, model, nozzleDiameter:0.4, plate:'Textured PEI Plate', buildVolume:actualVolume, tested:false as const, ...(family==='X2D'?{nozzleCount:2,activeNozzle:'primary' as const}:{}) };
    const mappedMaterial = { id:`generic-${material.toLowerCase()}`, name:`Generic ${material}`, type:material, color:'#e94560', tested:false as const };
    validateConfiguredProfiles({printer,material:mappedMaterial,profileLabel:id} as SlicingFileConfig,documents.machine,documents.filament);
    catalog.push({id,label:`${model} · 0.4 mm · ${material}`,printer,material:mappedMaterial,files,upstream:names});
  }
}
await writeFile(join(output,'catalog.json'),JSON.stringify(catalog,null,2)+'\n');
const files: {path:string;sha256:string}[] = [];
async function inventory(directory:string) {
  for (const name of (await readdir(directory)).sort()) {
    const file = join(directory,name);
    if ((await stat(file)).isDirectory()) await inventory(file);
    else if (name !== 'runtime-manifest.json') files.push({path:relative(output,file).replaceAll('\\','/'),sha256:hashBytes(await readFile(file))});
  }
}
await inventory(output);
await writeFile(join(output,'runtime-manifest.json'),JSON.stringify({version:'2.8.2.61',archiveSha256:'3faaa194a90a2e7defa39a6a63f5a654b8cdb762c6a98556cf771fba582229f5',files},null,2)+'\n');
console.log(`Prepared official Bambu Studio 2.8.2.61: ${files.length} pinned runtime files, ${catalog.length} resolved profile mappings.`);
