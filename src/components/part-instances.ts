import {InstancedMesh,MeshStandardMaterial,Matrix4,Box3,Sphere,Vector3,type BufferGeometry} from 'three';
/** Copies share one exact mesh and one draw call; only transforms are stored. */
export function partInstances(geometry:BufferGeometry,frame:{matrix:Matrix4;bounds:Box3},positions:readonly(readonly number[])[],color:string){
 const mesh=new InstancedMesh(geometry,new MeshStandardMaterial({color,roughness:.82,metalness:0}),positions.length);
 const bounds=new Box3();
 positions.forEach((position,index)=>{const matrix=frame.matrix.clone();matrix.elements[12]+=position[0];matrix.elements[13]+=position[1];matrix.elements[14]+=position[2];mesh.setMatrixAt(index,matrix);bounds.union(frame.bounds.clone().translate(new Vector3(position[0],position[1],position[2])));});
 mesh.instanceMatrix.needsUpdate=true;mesh.boundingBox=bounds;mesh.boundingSphere=bounds.getBoundingSphere(new Sphere());mesh.userData.displayBounds=bounds;mesh.userData.sharedGeometry=true;mesh.castShadow=true;mesh.receiveShadow=true;
 return mesh;
}
