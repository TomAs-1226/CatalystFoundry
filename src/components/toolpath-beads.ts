import {BufferAttribute,InstancedBufferAttribute,InstancedBufferGeometry,InstancedInterleavedBuffer,InterleavedBufferAttribute,Mesh,MeshLambertMaterial,Vector3,Box3,Sphere} from 'three';
import type {PathBuffer} from './toolpath-buffers';

/** Three visible extrusion faces, six triangles. No per-segment matrix/quaternion. */
export function createToolpathBeads(buffer:PathBuffer,color:number|string,width:number,height:number){
  const geometry=new InstancedBufferGeometry();
  // Longitudinal X is 0..1, lateral Y is -0.5..0.5, Z is 0 (top) or -1 (bottom).
  const positions=[0,-.5,0,1,-.5,0,1,.5,0,0,.5,0, 0,-.5,-1,1,-.5,-1, 0,.5,-1,1,.5,-1];
  geometry.setAttribute('position',new BufferAttribute(new Float32Array(positions),3));
  geometry.setIndex([0,1,2,0,2,3, 4,5,1,4,1,0, 3,2,7,3,7,6]);geometry.computeVertexNormals();
  const ends=new InstancedInterleavedBuffer(buffer.positions,6);
  geometry.setAttribute('pathFrom',new InterleavedBufferAttribute(ends,3,0));geometry.setAttribute('pathTo',new InterleavedBufferAttribute(ends,3,3));
  geometry.setAttribute('pathWidth',new InstancedBufferAttribute(buffer.widths,1));geometry.setAttribute('pathHeight',new InstancedBufferAttribute(buffer.heights,1));
  geometry.instanceCount=buffer.positions.length/6;
  const material=new MeshLambertMaterial({color});
  material.onBeforeCompile=shader=>{
    shader.uniforms.defaultBeadWidth={value:width};shader.uniforms.defaultBeadHeight={value:height};
    shader.vertexShader=`attribute vec3 pathFrom;attribute vec3 pathTo;attribute float pathWidth;attribute float pathHeight;uniform float defaultBeadWidth;uniform float defaultBeadHeight;\n${shader.vertexShader}`
      .replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>
        vec3 pathDirection=normalize(pathTo-pathFrom+vec3(0.0000001,0.0,0.0));
        vec3 pathSide=normalize(vec3(-pathDirection.y,pathDirection.x,0.0)+vec3(0.0,0.0000001,0.0));
        vec3 pathUp=normalize(cross(pathDirection,pathSide));
        objectNormal=pathDirection*objectNormal.x+pathSide*objectNormal.y+pathUp*objectNormal.z;`)
      .replace('#include <begin_vertex>',`float beadWidth=clamp(pathWidth>0.0?pathWidth:defaultBeadWidth,0.05,3.0);
        float beadHeight=clamp(pathHeight>0.0?pathHeight:defaultBeadHeight,0.02,2.0);
        vec3 transformed=mix(pathFrom,pathTo,position.x)+pathSide*position.y*beadWidth+pathUp*position.z*beadHeight;`);
  };
  material.customProgramCacheKey=()=> 'foundry-beads-six-faces-v1';
  // Explicit bounds avoid Three walking instance transforms; endpoint floats are reused.
  const bounds=new Box3(),point=new Vector3();if(buffer.bounds){bounds.min.fromArray(buffer.bounds.min);bounds.max.fromArray(buffer.bounds.max);}else for(let i=0;i<buffer.positions.length;i+=3)bounds.expandByPoint(point.fromArray(buffer.positions,i));
  bounds.expandByScalar(3);geometry.boundingBox=bounds;geometry.boundingSphere=bounds.getBoundingSphere(new Sphere());
  const mesh=new Mesh(geometry,material);mesh.raycast=()=>{};
  return mesh;
}
