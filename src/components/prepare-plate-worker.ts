import type {Job,Project,Part,JobItem,Vec3} from '../domain/model';
import type {preparePlateModel} from '../domain/prepare-plate';
function request<T>(message:unknown):Promise<T>{
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./plate-preparation.worker.ts',import.meta.url),{type:'module'});
    const finish=()=>{clearTimeout(timeout);worker.terminate();};
    const timeout=setTimeout(()=>{finish();reject(new Error('Automatic preparation took too long. Split this plate or use manual placement.'));},120000);
    worker.onmessage=event=>{finish();if(event.data.error)reject(new Error(event.data.error));else resolve(event.data.result);};
    worker.onerror=()=>{finish();reject(new Error('Plate preparation could not run. Reopen Foundry or use manual placement.'));};
    worker.postMessage(message);
  });
}
export const preparePlateWorker=(project:Project,job:Job,arrange:boolean,orient:boolean)=>request<Awaited<ReturnType<typeof preparePlateModel>>>({project,job,arrange,orient});
export const layFlatWorker=(part:Part,item:JobItem,volume:Vec3)=>request<Vec3>({part,item,volume});
