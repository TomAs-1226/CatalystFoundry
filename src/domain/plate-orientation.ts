import {Euler,Matrix4,Quaternion,Vector3} from 'three';
import {parseSTL} from '../adapters/geometry';
import type {Job,JobItem,Part,Project,Vec3} from './model';
import {rotatedDimensions} from './invariants';

const radians=(v:number)=>v*Math.PI/180;
function angles(q:Quaternion):Vec3 {const e=new Euler().setFromQuaternion(q,'XYZ');return [e.x,e.y,e.z].map(v=>Math.abs(v)<1e-10?0:Math.round(v*180/Math.PI*1e6)/1e6) as Vec3;}
/** The picked face normal is already in world/plate coordinates. */
export function faceDownOrientation(current:Vec3,normal:Vec3):Vec3 {
  if([...current,...normal].some(v=>!Number.isFinite(v))||Math.hypot(...normal)<1e-8)throw new Error('Choose a valid solid face.');
  const rotation=new Quaternion().setFromEuler(new Euler(...current.map(radians) as Vec3,'XYZ'));
  return angles(new Quaternion().setFromUnitVectors(new Vector3(...normal).normalize(),new Vector3(0,0,-1)).multiply(rotation));
}

/** Bounded mesh contact/height/overhang ranking. Never changes source geometry. */
export async function layFlatOrientation(part:Part,item:JobItem,volume:Vec3):Promise<Vec3> {
  const vertices=part.geometry.vertices??(await parseSTL(part.geometry.stl,'mm')).vertices!;
  if(vertices.length/9>250_000)throw new Error('Split or reduce the mesh before automatic orientation.');
  const faces=new Map<string,{normal:Vec3;area:number}>();
  for(let i=0;i<vertices.length;i+=9){
    const ux=vertices[i+3]-vertices[i],uy=vertices[i+4]-vertices[i+1],uz=vertices[i+5]-vertices[i+2];
    const vx=vertices[i+6]-vertices[i],vy=vertices[i+7]-vertices[i+1],vz=vertices[i+8]-vertices[i+2];
    const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,length=Math.hypot(nx,ny,nz);if(length<1e-8)continue;
    const normal:Vec3=[nx/length,ny/length,nz/length],key=normal.map(v=>Math.round(v*100)).join(',');
    const prior=faces.get(key);if(prior)prior.area+=length/2;else faces.set(key,{normal,area:length/2});
  }
  const normals:Vec3[]=[[0,0,-1],[0,-1,0],[-1,0,0],[0,0,1],[0,1,0],[1,0,0],...Array.from(faces.values()).sort((a,b)=>b.area-a.area).slice(0,12).map(f=>f.normal)];
  let best:{orientation:Vec3;score:number}|undefined;const seen=new Set<string>();
  for(const normal of normals){
    const orientation=faceDownOrientation([0,0,0],normal),key=orientation.join(',');if(seen.has(key))continue;seen.add(key);
    const dims=rotatedDimensions(part.geometry.dimensions,orientation);if(dims.some((v,i)=>v>volume[i]- (i<2?10:0)))continue;
    const m=new Matrix4().makeRotationFromEuler(new Euler(...orientation.map(radians) as Vec3,'XYZ')).elements;
    const z=new Float64Array(vertices.length/3);let bottom=Infinity,top=-Infinity;
    for(let i=0;i<vertices.length;i+=3){const height=m[2]*vertices[i]+m[6]*vertices[i+1]+m[10]*vertices[i+2];z[i/3]=height;bottom=Math.min(bottom,height);top=Math.max(top,height);}
    let contact=0,overhang=0;
    for(let i=0;i<vertices.length;i+=9){
      const ux=vertices[i+3]-vertices[i],uy=vertices[i+4]-vertices[i+1],uz=vertices[i+5]-vertices[i+2],vx=vertices[i+6]-vertices[i],vy=vertices[i+7]-vertices[i+1],vz=vertices[i+8]-vertices[i+2];
      const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,length=Math.hypot(nx,ny,nz),down=m[2]*nx+m[6]*ny+m[10]*nz;
      const low=Math.min(z[i/3],z[i/3+1],z[i/3+2]),high=Math.max(z[i/3],z[i/3+1],z[i/3+2]);
      if(high<=bottom+.05)contact+=length/2;else if(down<-.707*length)overhang+=Math.abs(down)/2*Math.max(0,low-bottom);
    }
    if(contact<.1)continue;
    const score=(top-bottom)+overhang*.002-Math.sqrt(contact)*.25;
    if(!best||score<best.score-1e-6)best={orientation,score};
  }
  if(!best)throw new Error(`${part.name}: no stable face fits this plate. Use Place on face or rotate manually.`);
  return best.orientation;
}
export async function orientPlate(project:Project,job:Job):Promise<JobItem[]> {
  const items:JobItem[]=[];
  for(const item of job.items){
    const part=project.parts.find(p=>p.id===item.partId);if(!part)throw new Error('An included part is missing.');
    const manual=item.orientationMode==='manual'||(!item.orientationMode&&item.orientation.some(v=>Math.abs(v)>.00001));
    items.push(manual?structuredClone(item):{...structuredClone(item),orientation:await layFlatOrientation(part,item,job.printer.buildVolume),orientationMode:'automatic'});
  }
  return items;
}
