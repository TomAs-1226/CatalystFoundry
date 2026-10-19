import {expect,it,vi} from 'vitest';
import {immutableOnshapeCache} from '../server/onshape-cache';
it('reuses exact immutable metadata without sharing mutable results, versions, configurations or connections',async()=>{
 let now=0;const request=vi.fn(async()=>({parts:['original']}));
 const cache=immutableOnshapeCache({request:request as never},()=>now);
 const path='/api/v17/parts/d/'+'a'.repeat(24)+'/v/'+'b'.repeat(24)+'/e/'+'c'.repeat(24)+'?configuration=left';
 const first=await cache.transport.request<{parts:string[]}>('GET',path);first.parts.push('modified');
 expect(await cache.transport.request('GET',path)).toEqual({parts:['original']});expect(request).toHaveBeenCalledTimes(1);
 await cache.transport.request('GET',path.replace('left','right'));expect(request).toHaveBeenCalledTimes(2);
 await cache.transport.request('GET','/api/v17/documents');await cache.transport.request('GET','/api/v17/documents');expect(request).toHaveBeenCalledTimes(4);
 now=120001;await cache.transport.request('GET',path);expect(request).toHaveBeenCalledTimes(5);
 cache.clear();await cache.transport.request('GET',path);expect(request).toHaveBeenCalledTimes(6);
});
it('does not cache failures or complete an aborted metadata request',async()=>{
 const request=vi.fn(async()=>{throw new Error('Access revoked');});const cache=immutableOnshapeCache({request:request as never});
 const path='/api/v17/documents/d/'+'a'.repeat(24)+'/v/'+'b'.repeat(24)+'/elements';
 await expect(cache.transport.request('GET',path)).rejects.toThrow('Access revoked');await expect(cache.transport.request('GET',path)).rejects.toThrow('Access revoked');expect(request).toHaveBeenCalledTimes(2);
 const signal=AbortSignal.abort();await expect(cache.transport.request('GET',path,{signal})).rejects.toThrow();expect(request).toHaveBeenCalledTimes(2);
});
