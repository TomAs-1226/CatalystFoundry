import * as THREE from 'three';
import {createToolpathBeads} from '../../src/components/toolpath-beads';
import {buildPathBuffers} from '../../src/components/toolpath-buffers';

/** Standalone synthetic renderer test, never loads or operates the Foundry UI. */
async function verify(){
  const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(1280,720);renderer.setPixelRatio(1);renderer.setClearColor(0,0);renderer.outputColorSpace=THREE.SRGBColorSpace;document.body.appendChild(renderer.domElement);
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(34,1280/720,.1,20000);camera.up.set(0,0,1);camera.position.set(400,-400,350);camera.lookAt(128,128,25);scene.add(new THREE.HemisphereLight(0xffffff,0x5b6168,.85),new THREE.DirectionalLight(0xffffff,2.4));
  const count=250000,[buffer]=buildPathBuffers({segments:Array.from({length:count},(_,i)=>{const x=i%250,y=Math.floor(i/250)%250,z=(Math.floor(i/62500)+1)*.2;return{from:[x,y,z] as const,to:[x+.7,y+.2,z] as const,feature:'wall' as const,layer:Math.floor(i/62500),width:.42,height:.2};})});
  const context=renderer.getContext(),results=[],target=new THREE.WebGLRenderTarget(1280,720),syncPixel=new Uint8Array(4);renderer.setRenderTarget(target);
  for(const version of ['before','after']){
    let mesh:THREE.Mesh;
    const started=performance.now();
    if(version==='after')mesh=createToolpathBeads(buffer,'#376E9A',.42,.2);
    else{
      const old=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({color:'#376E9A',roughness:.72,metalness:0}),count),transform=new THREE.Object3D(),direction=new THREE.Vector3(),axis=new THREE.Vector3(1,0,0);
      for(let i=0;i<count;i++){const p=buffer.positions,n=i*6;direction.set(p[n+3]-p[n],p[n+4]-p[n+1],p[n+5]-p[n+2]);const length=direction.length();transform.position.set((p[n]+p[n+3])/2,(p[n+1]+p[n+4])/2,(p[n+2]+p[n+5])/2-.1);transform.quaternion.setFromUnitVectors(axis,direction.normalize());transform.scale.set(length,.42,.2);transform.updateMatrix();old.setMatrixAt(i,transform.matrix);}old.instanceMatrix.needsUpdate=true;old.frustumCulled=false;mesh=old;
    }
    const setupMs=performance.now()-started;scene.add(mesh);renderer.compile(scene,camera);renderer.render(scene,camera);context.finish();
    const samples=[];for(let i=0;i<8;i++){camera.position.x=400+i;camera.lookAt(128,128,25);const t=performance.now();renderer.render(scene,camera);renderer.readRenderTargetPixels(target,640,360,1,1,syncPixel);samples.push(performance.now()-t);}
    const pixels=new Uint8Array(1280*720*4);renderer.readRenderTargetPixels(target,0,0,1280,720,pixels);let visiblePixels=0,occupiedPixels=0;for(let i=0;i<pixels.length;i+=4){if(pixels[i]+pixels[i+1]+pixels[i+2]>20)visiblePixels++;if(pixels[i+3])occupiedPixels++;}
    if(context.getError()!==context.NO_ERROR)throw new Error('WebGL error in '+version);
    if(renderer.info.programs?.some(program=>(program as any).diagnostics?.runnable===false))throw new Error('Shader compilation failed in '+version);
    results.push({version,setupMs,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,visiblePixels,occupiedPixels,synchronizedRenderMs:samples,medianMs:[...samples].sort((a,b)=>a-b)[4]});scene.remove(mesh);mesh.geometry.dispose();(mesh.material as THREE.Material).dispose();if(mesh instanceof THREE.InstancedMesh)mesh.dispose();
  }
  const debug=context.getExtension('WEBGL_debug_renderer_info');const report={passed:results[1].triangles===1500000&&results[1].drawCalls===1&&results.every(result=>result.visiblePixels>1000),scope:'Hidden standalone synthetic WebGL renderer; not the Foundry UI or an interactive FPS test. 250000 segments,1280x720,DPR1,offscreen target and synchronized pixel readback wall time. Timings are informational, not low-end laptop FPS.',renderer:debug?context.getParameter(debug.UNMASKED_RENDERER_WEBGL):context.getParameter(context.RENDERER),results};target.dispose();renderer.dispose();return report;
}
(window as any).rendererVerification=verify();
