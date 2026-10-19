import {SphereGeometry,EdgesGeometry,type BufferGeometry} from 'three';
import {writeFile} from 'node:fs/promises';
import {manufacturingGeometry} from '../../src/components/viewer-geometry';

// Headless CPU/allocation measurement only; no GPU or laptop FPS claim.
const copies=100,source=new SphereGeometry(20,32,16).toNonIndexed();
function bytes(geometry:BufferGeometry){return Object.values(geometry.attributes).reduce((sum,attribute)=>sum+attribute.array.byteLength,0)+(geometry.index?.array.byteLength??0);}
function sample(shared:boolean){const started=performance.now();let allocated=0;const owned:BufferGeometry[]=[];
 for(let index=0;index<(shared?1:copies);index++){const mesh=manufacturingGeometry(source,[21,37,68]),edges=new EdgesGeometry(mesh,36);allocated+=bytes(mesh)+bytes(edges);owned.push(mesh,edges);}
 const elapsedMs=performance.now()-started;owned.forEach(geometry=>geometry.dispose());return{elapsedMs,allocatedGeometryBytes:allocated,uniqueMeshBuffers:shared?1:copies};
}
sample(false);sample(true);
const median=(values:number[])=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
const before=Array.from({length:5},()=>sample(false)),after=Array.from({length:5},()=>sample(true));
const result={fixture:'Synthetic 100 repeated 960-triangle spheres; identical orientation, exact geometry retained',platform:process.platform,architecture:process.arch,node:process.version,copies,trianglesPerCopy:source.getAttribute('position').count/3,before:{...before[0],elapsedMs:median(before.map(s=>s.elapsedMs))},after:{...after[0],elapsedMs:median(after.map(s=>s.elapsedMs))},gpuRendering:'untested',lowEndLaptopFPS:'untested'};
source.dispose();if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(result,null,2)+'\n');process.stdout.write(JSON.stringify(result,null,2)+'\n');
