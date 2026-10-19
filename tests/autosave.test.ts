import {expect,it} from 'vitest';
import {ProjectAutosave} from '../src/components/project-autosave';

it('serializes slow saves, drops superseded waiting snapshots, and leaves the latest exact bytes on disk',async()=>{
 const writes:string[]=[],releases:(()=>void)[]=[],states:string[]=[];
 const saver=new ProjectAutosave(json=>{writes.push(json);return new Promise(resolve=>releases.push(resolve));},state=>states.push(state));
 const first=saver.save('first'),second=saver.save('second'),third=saver.save('latest');
 expect(writes).toEqual(['first']);releases.shift()!();await new Promise(resolve=>setTimeout(resolve,0));expect(writes).toEqual(['first','latest']);releases.shift()!();await Promise.all([first,second,third]);
 expect(states.at(-1)).toBe('saved');await saver.save('latest');expect(writes).toHaveLength(2);
});
it('reports failed writes and lets Save progress retry the identical unsaved snapshot',async()=>{
 let attempts=0;const states:string[]=[];const saver=new ProjectAutosave(async()=>{if(++attempts===1)throw Error('disk full');},(state,error)=>states.push(error?.message??state));
 await expect(saver.save('exact draft')).rejects.toThrow('disk full');expect(states.at(-1)).toBe('disk full');await saver.save('exact draft');expect(attempts).toBe(2);expect(states.at(-1)).toBe('saved');
});
