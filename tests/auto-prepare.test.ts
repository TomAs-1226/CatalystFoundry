import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { arrangePlate, recommendSupports } from '../src/domain/auto-prepare';
import { createProject, type Part } from '../src/domain/model';
import { parseSTL } from '../src/adapters/geometry';
import { fitWarnings, fingerprint, invalidateChangedJobs } from '../src/domain/index';
import { resolveProcessSettings } from '../server/slicing-config';
import { syntheticProcess } from './fixtures/slicing-profile-fixtures';

async function fixture(name='support-test') {
  const p=createProject(),j=p.jobs[0];
  const part:Part={id:'part',name:'Fixture',geometry:await parseSTL(await readFile(`public/fixtures/${name}.stl`,'utf8'),'mm'),source:{kind:'fixture',documentId:'test',versionId:'test',elementId:'test',configuration:'default'},quantity:1,spareQuantity:0,classification:'make',category:'custom'};
  p.parts=[part];j.items=[{partId:part.id,quantity:1,spareQuantity:0,orientation:[0,0,0],position:[999,999,99]}];return{p,j,part};
}
it('places all required and backup grids on the floor, centered with clearance and no changed rotation or source bytes',async()=>{
  const {p,j,part}=await fixture();j.items[0].quantity=3;j.items[0].spareQuantity=1;
  const other=structuredClone(part);other.id='other';p.parts.push(other);j.items.push({...structuredClone(j.items[0]),partId:other.id,quantity:2,spareQuantity:0,orientation:[0,0,90]});
  const original=structuredClone(p);j.items=arrangePlate(p,j);
  expect(fitWarnings(p,j)).toEqual([]);expect(j.items.every(item=>item.position[2]===0)).toBe(true);
  expect(j.items.map(item=>[item.quantity,item.spareQuantity,item.orientation])).toEqual(original.jobs[0].items.map(item=>[item.quantity,item.spareQuantity,item.orientation]));
  expect(p.parts).toEqual(original.parts);expect(arrangePlate(p,j)).toEqual(j.items);
});
it('fails atomically when the selected orientation/quantity cannot fit and never rescales geometry',async()=>{
  const {p,j}=await fixture();j.items[0].quantity=1000;const before=structuredClone(p);
  expect(()=>arrangePlate(p,j)).toThrow(/one plate/);expect(p).toEqual(before);
  j.items[0].quantity=1;j.printer.buildVolume[2]=1;expect(()=>arrangePlate(p,j)).toThrow(/taller/);
});
it('identifies broad roofs, suggests normal support, and maps both actual native support styles and angles',async()=>{
  const {p,j}=await fixture();const recommendation=await recommendSupports(p,j);
  expect(recommendation.style).toBe('normal');expect(recommendation.overhangArea).toBeGreaterThanOrEqual(225);
  j.settings.supports=true;j.settings.supportStyle='auto';j.settings.supportResolvedStyle=recommendation.style;
  expect(resolveProcessSettings(syntheticProcess,j.settings)).toMatchObject({enable_support:'1',support_type:'normal(auto)',support_threshold_angle:'45'});
  j.settings.supportStyle='tree';j.settings.supportThreshold=50;
  expect(resolveProcessSettings(syntheticProcess,j.settings)).toMatchObject({support_type:'tree(auto)',support_threshold_angle:'50'});
  j.settings.supports=false;expect(resolveProcessSettings(syntheticProcess,j.settings).enable_support).toBe('0');
});
it('suggests tree for smaller overhangs and reevaluates the selected manufacturing rotation',async()=>{
  const {p,j,part}=await fixture();
  part.geometry.vertices=part.geometry.vertices!.map(value=>value*.4);
  const small=await recommendSupports(p,j);expect(small.style).toBe('tree');
  j.items[0].orientation=[90,0,0];const flat=await recommendSupports(p,j);expect(flat.overhangArea).toBeLessThan(small.overhangArea);
});
it('binds support changes and placement changes to a different exact manifest and revokes approval',async()=>{
  const {p,j}=await fixture();const before=structuredClone(p),hash=await fingerprint(p,j);
  j.items=arrangePlate(p,j);j.settings.supportStyle='tree';
  expect(await fingerprint(p,j)).not.toBe(hash);expect(invalidateChangedJobs(before,p)).toEqual([j.id]);expect(j.approval).toBeUndefined();
});
