import {STLLoader} from 'three/addons/loaders/STLLoader.js';
import {toCreasedNormals} from 'three/addons/utils/BufferGeometryUtils.js';
import {EdgesGeometry} from 'three';

/** Display-only processing. Source vertices, holes and manufacturing bytes stay exact. */
self.onmessage=(event:MessageEvent<{key:string;stl:string}>)=>{
  const {key,stl}=event.data;
  try{
    const geometry=new STLLoader().parse(stl),position=geometry.getAttribute('position');
    if(!position||position.count<3||!position.array.every(Number.isFinite))throw new Error('Invalid mesh coordinates.');
    toCreasedNormals(geometry,Math.PI/6);
    const edges=new EdgesGeometry(geometry,36);
    const result={key,positions:new Float32Array(position.array),normals:new Float32Array(geometry.getAttribute('normal').array),edges:new Float32Array(edges.getAttribute('position').array)};
    self.postMessage(result,{transfer:[result.positions.buffer,result.normals.buffer,result.edges.buffer]});geometry.dispose();edges.dispose();
  }catch(error){self.postMessage({key,error:(error as Error).message});}
};
