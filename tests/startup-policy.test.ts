import {expect,it} from 'vitest';
import {createRequire} from 'node:module';
const {waitForPresentation}=createRequire(import.meta.url)('../electron/startup-policy.cjs');
it('keeps the minimum presentation but does not wait forever for a stalled compositor',async()=>{
 let time=0,finished=0;const options={presentedAt:0,minimumMs:1400,now:()=>time,delay:async(ms:number)=>{time+=ms;},finish:async()=>{finished++;}};
 expect(await waitForPresentation({...options,complete:async()=>time>=1400})).toEqual({animationCompleted:true,animationForced:false});expect(time).toBe(1400);expect(finished).toBe(0);
 time=0;expect(await waitForPresentation({...options,complete:async()=>false})).toEqual({animationCompleted:true,animationForced:true});expect(time).toBe(1650);expect(finished).toBe(1);
 time=10000;await waitForPresentation({...options,complete:async()=>true});expect(time).toBe(10000);
 await expect(waitForPresentation({...options,minimumMs:Infinity,complete:async()=>true})).rejects.toThrow(/timing/);
});
