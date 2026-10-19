import {it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {unzipSync,strFromU8} from 'fflate';
import {BufferGeometry,Float32BufferAttribute,Mesh,MeshBasicMaterial,DoubleSide,Raycaster,Vector3} from 'three';
import {prepare3mf} from '../server/slicing-http';
import {parseSTL} from '../src/adapters/geometry';
import {createProject,createJob,type Part} from '../src/domain/model';
it('exports shared manifold vertex indices and preserves both through holes and source bytes',async()=>{
 const geometry=await parseSTL(await readFile('public/fixtures/two-hole-plate.stl'),'mm');expect(geometry.warnings).toEqual([]);const original=geometry.stl;
 const part:Part={id:'public-two-hole',name:'NON-MANUFACTURABLE two-hole fixture',geometry,source:{kind:'fixture'},quantity:1,spareQuantity:0,classification:'make',category:'custom'};
 const project=createProject();project.parts=[part];project.jobs=[createJob([part])];const job=project.jobs[0];job.items[0].position=[128,128,0];
 const xml=strFromU8(unzipSync(await prepare3mf(project,job))['3D/3dmodel.model']);
 const vertices=[...xml.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"/g)].flatMap(m=>m.slice(1).map(Number));
 const triangles=[...xml.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)].map(m=>m.slice(1).map(Number));
 expect(triangles.length).toBe(geometry.vertices!.length/9);expect(vertices.length/3).toBeLessThan(triangles.length*3);
 const edges=new Map<string,number>();for(const t of triangles)for(let i=0;i<3;i++){const key=[t[i],t[(i+1)%3]].sort((a,b)=>a-b).join(',');edges.set(key,(edges.get(key)??0)+1);}expect([...edges.values()].every(count=>count===2)).toBe(true);
 const meshGeometry=new BufferGeometry();meshGeometry.setAttribute('position',new Float32BufferAttribute(vertices,3));meshGeometry.setIndex(triangles.flat());
 const mesh=new Mesh(meshGeometry,new MeshBasicMaterial({side:DoubleSide}));mesh.updateMatrixWorld();const ray=new Raycaster();
 for(const x of [103,153]){ray.set(new Vector3(x,128,20),new Vector3(0,0,-1));expect(ray.intersectObject(mesh)).toHaveLength(0);}
 ray.set(new Vector3(128,128,20),new Vector3(0,0,-1));expect(ray.intersectObject(mesh).length).toBeGreaterThan(0);
 expect(geometry.stl).toBe(original);expect(job.items[0].quantity).toBe(1);meshGeometry.dispose();mesh.material.dispose();
});
