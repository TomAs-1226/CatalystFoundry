import {BufferAttribute,BufferGeometry} from 'three';
export interface DisplayMesh {geometry:BufferGeometry;edges:BufferGeometry;bytes:number;}
interface Reply {key:string;positions?:Float32Array;normals?:Float32Array;edges?:Float32Array;error?:string;}
/** One serial worker, immutable shared buffers, and a bounded inactive cache. */
export class ViewerMeshCache {
  private worker?:Worker;private disposed=false;
  private entries=new Map<string,Promise<DisplayMesh>>();
  private ready=new Map<string,DisplayMesh>();
  private pending=new Map<string,{resolve:(mesh:DisplayMesh)=>void;reject:(error:Error)=>void}>();
  get(key:string,stl:string):Promise<DisplayMesh>{
    const existing=this.entries.get(key);if(existing)return existing;
    if(this.disposed)return Promise.reject(new Error('Viewer closed.'));
    if(!this.worker){
      this.worker=new Worker(new URL('./viewer-mesh.worker.ts',import.meta.url),{type:'module'});
      this.worker.onmessage=(event:MessageEvent<Reply>)=>{
        const data=event.data,waiting=this.pending.get(data.key);if(!waiting)return;this.pending.delete(data.key);
        if(data.error||!data.positions||!data.normals||!data.edges){this.entries.delete(data.key);waiting.reject(new Error(data.error??'Invalid mesh response.'));return;}
        const geometry=new BufferGeometry().setAttribute('position',new BufferAttribute(data.positions,3)).setAttribute('normal',new BufferAttribute(data.normals,3));
        geometry.computeBoundingBox();geometry.computeBoundingSphere();
        const edges=new BufferGeometry().setAttribute('position',new BufferAttribute(data.edges,3));
        const mesh={geometry,edges,bytes:data.positions.byteLength+data.normals.byteLength+data.edges.byteLength};this.ready.set(data.key,mesh);waiting.resolve(mesh);
      };
      this.worker.onerror=()=>{for(const [key,waiting] of this.pending){waiting.reject(new Error('3D mesh processing failed. Reopen this workspace to retry.'));this.entries.delete(key);}this.pending.clear();this.worker?.terminate();this.worker=undefined;};
    }
    const result=new Promise<DisplayMesh>((resolve,reject)=>this.pending.set(key,{resolve,reject}));this.entries.set(key,result);
    this.worker.postMessage({key,stl});return result;
  }
  /** Call only after old scene objects release their references. Active meshes stay valid. */
  trim(active:Set<string>){
    let bytes=0;for(const [key,mesh] of this.ready)if(!active.has(key))bytes+=mesh.bytes;
    for(const [key,mesh] of this.ready){if(bytes<=64*1024*1024)break;if(active.has(key))continue;bytes-=mesh.bytes;mesh.geometry.dispose();mesh.edges.dispose();this.ready.delete(key);this.entries.delete(key);}
  }
  dispose(){this.disposed=true;this.worker?.terminate();for(const waiting of this.pending.values())waiting.reject(new Error('Viewer closed.'));this.pending.clear();for(const mesh of this.ready.values()){mesh.geometry.dispose();mesh.edges.dispose();}this.ready.clear();this.entries.clear();}
}
