import type {OnshapeTransport} from '../src/adapters/onshape';

/** Short-lived, connection-local immutable metadata only. Never cache errors,
 * mutable document/version lists, tokens or translation polling responses. */
export function immutableOnshapeCache(upstream:OnshapeTransport, now=Date.now) {
 const entries=new Map<string,{value:unknown;expires:number;bytes:number}>();
 let size=0, generation=0;
 return {
  clear(){generation++;entries.clear();size=0;},
  transport:{async request<T>(method:'GET'|'POST'|'DELETE',path:string,options?:{body?:unknown;signal?:AbortSignal;binary?:boolean}){
   options?.signal?.throwIfAborted();
   const eligible=method==='GET'&&!options?.binary&&/\/v\/[a-f\d]{24}(?:\/|\?)/i.test(path);
   const cached=eligible?entries.get(path):undefined;
   if(cached&&cached.expires>now())return structuredClone(cached.value) as T;
   if(cached){entries.delete(path);size-=cached.bytes;}
   const started=generation;
   const result=await upstream.request<T>(method,path,options);
   options?.signal?.throwIfAborted();
   if(eligible&&started===generation){
    const bytes=Buffer.byteLength(JSON.stringify(result));
    if(bytes<=4*1024*1024){
     const previous=entries.get(path);if(previous)size-=previous.bytes;
     entries.set(path,{value:structuredClone(result),expires:now()+120000,bytes});size+=bytes;
     while(entries.size>256||size>16*1024*1024){const key=entries.keys().next().value!;size-=entries.get(key)!.bytes;entries.delete(key);}
    }
   }
   return result;
  }} satisfies OnshapeTransport,
 };
}
