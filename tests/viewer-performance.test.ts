import {expect,it} from 'vitest';
import {build} from 'esbuild';
import {Worker} from 'node:worker_threads';
import {readFile} from 'node:fs/promises';
import {BoxGeometry,Vector3,Matrix4} from 'three';
import {partInstances} from '../src/components/part-instances';
import {STLLoader} from 'three/addons/loaders/STLLoader.js';
import {manufacturingFrame,manufacturingGeometry} from '../src/components/viewer-geometry';
import {frameScheduler,viewerPixelRatio} from '../src/components/viewer-scheduler';
import {createToolpathBeads} from '../src/components/toolpath-beads';
import {buildPathBuffers,pathDrawRanges} from '../src/components/toolpath-buffers';

it('batches repeated copies with exact per-copy rotation, floor contact, and bounds',()=>{
 const source=new BoxGeometry(13,29,7).toNonIndexed();source.translate(70,-40,90);const frame=manufacturingFrame(source,[21,37,68]),positions=Array.from({length:100},(_,i)=>[i*20,60,0]),mesh=partInstances(source,frame,positions,'#376E9A');
 expect(mesh.count).toBe(100);expect(mesh.geometry).toBe(source);const matrix=new Matrix4(),expected=new Vector3(),actual=new Vector3(),attribute=source.getAttribute('position');
 for(const index of [0,49,99]){mesh.getMatrixAt(index,matrix);for(let vertex=0;vertex<attribute.count;vertex++){expected.fromBufferAttribute(attribute,vertex).applyMatrix4(frame.matrix).add(new Vector3(...positions[index]));actual.fromBufferAttribute(attribute,vertex).applyMatrix4(matrix);expect(actual.distanceTo(expected)).toBeLessThan(.0002);}}
 expect(mesh.boundingBox!.min.z).toBe(0);mesh.dispose();mesh.material.dispose();source.dispose();
});

it('coalesces control/pointer/effect redraws to one frame and never schedules an idle loop',()=>{
  const callbacks=new Map<number,FrameRequestCallback>();let next=0,draws=0;
  const scheduler=frameScheduler(()=>draws++,callback=>{callbacks.set(++next,callback);return next;},id=>callbacks.delete(id));
  for(let i=0;i<100;i++)scheduler.render();expect(callbacks.size).toBe(1);callbacks.get(1)!(0);callbacks.delete(1);expect(draws).toBe(1);expect(callbacks.size).toBe(0);
  scheduler.render();expect(callbacks.size).toBe(1);scheduler.dispose();expect(callbacks.size).toBe(0);scheduler.render();expect(callbacks.size).toBe(0);
  for(const [w,h] of [[1920,1080],[3840,2160],[1024,768]])for(const moving of [true,false])expect(w*h*viewerPixelRatio(w,h,2,moving)**2).toBeLessThanOrEqual((moving?1e6:2e6)+.01);
});

it('uses the exact same oriented vertices and floor contact while sharing source buffers',()=>{
  const source=new BoxGeometry(13,29,7).toNonIndexed();source.translate(70,-40,90);const before=[...source.getAttribute('position').array];
  for(const angles of [[0,0,0],[90,0,0],[21,37,68]] as const){
    const frame=manufacturingFrame(source,angles),old=manufacturingGeometry(source,angles),a=source.getAttribute('position'),b=old.getAttribute('position');
    for(let i=0;i<a.count;i++){const actual=new Vector3().fromBufferAttribute(a,i).applyMatrix4(frame.matrix);expect(actual.distanceTo(new Vector3().fromBufferAttribute(b,i))).toBeLessThan(.00002);}
    expect(frame.bounds.min.z).toBe(0);old.dispose();
  }
  expect([...source.getAttribute('position').array]).toEqual(before);source.dispose();
});

it('executes the actual mesh worker off-thread and returns unchanged source positions and hole boundaries',async()=>{
  const bundled=await build({entryPoints:['src/components/viewer-mesh.worker.ts'],bundle:true,write:false,format:'cjs',platform:'browser'});
  const worker=new Worker(`const {parentPort}=require('node:worker_threads');global.self={postMessage:(value,options)=>parentPort.postMessage(value,options?.transfer)};${bundled.outputFiles[0].text};parentPort.on('message',data=>self.onmessage({data}));`,{eval:true});
  try{
    const stl=await readFile('public/fixtures/two-hole-plate.stl','utf8'),expected=new STLLoader().parse(stl);
    const result:any=await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);worker.postMessage({key:'immutable-fixture',stl});});
    expect(result.key).toBe('immutable-fixture');expect(result.positions).toEqual(expected.getAttribute('position').array);expect(result.normals.length).toBe(result.positions.length);expect(result.edges.length).toBeGreaterThan(0);expect([...result.normals].every(Number.isFinite)).toBe(true);
    expected.dispose();
  }finally{await worker.terminate();}
});

it('reuses native endpoint/width/height arrays for six-triangle beads and scrubs without rebuilding',()=>{
  const [buffer]=buildPathBuffers({segments:[{from:[10,20,.2],to:[20,20,.2],width:.5,height:.2,feature:'wall',layer:0},{from:[20,20,.4],to:[20,30,.4],width:.45,height:.2,feature:'wall',layer:1}]});
  const original=[...buffer.positions],mesh=createToolpathBeads(buffer,'#376E9A',.42,.2),geometry=mesh.geometry;
  expect(geometry.index!.count/3).toBe(6);expect(geometry.instanceCount).toBe(2);
  expect((geometry.getAttribute('pathFrom') as any).data.array).toBe(buffer.positions);expect(geometry.getAttribute('pathWidth').array).toBe(buffer.widths);expect(geometry.getAttribute('pathHeight').array).toBe(buffer.heights);
  const shader:any={vertexShader:'#include <beginnormal_vertex>\n#include <begin_vertex>',uniforms:{}};mesh.material.onBeforeCompile(shader,null as any);expect(shader.vertexShader).toContain('mix(pathFrom,pathTo,position.x)');expect(shader.uniforms.defaultBeadWidth.value).toBe(.42);
  const ranges=pathDrawRanges(buffer,0);geometry.instanceCount=(ranges.context.count+ranges.active.count)/2;expect(geometry.instanceCount).toBe(1);expect([...buffer.positions]).toEqual(original);geometry.dispose();mesh.material.dispose();
});
