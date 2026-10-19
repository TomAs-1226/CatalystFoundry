import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { base64ToBytes, geometrySHA256, MAX_STL_BYTES, parseSTL, validateDimensions } from '../src/adapters/geometry';
const mesh=readFileSync(new URL('../public/fixtures/bracket.stl',import.meta.url));
const tetrahedron = `solid test
facet normal 0 0 1
outer loop
vertex 0 0 0
vertex 1 0 0
vertex 0 2 0
endloop
endfacet
facet normal 0 1 0
outer loop
vertex 0 0 0
vertex 0 0 3
vertex 1 0 0
endloop
endfacet
facet normal 1 0 0
outer loop
vertex 0 0 0
vertex 0 2 0
vertex 0 0 3
endloop
endfacet
facet normal 1 1 1
outer loop
vertex 1 0 0
vertex 0 0 3
vertex 0 2 0
endloop
endfacet
endsolid test`;
describe('geometry import',()=>{
 it('parses real ASCII STL with dimensions and exact original preservation',async()=>{
  const asset=await parseSTL(mesh,'mm',{name:'bracket.stl',expectedDimensions:[72,48,8]});
  expect(asset.dimensions).toEqual([72,48,8]);expect(asset.warnings).toEqual([]);expect(asset.units).toBe('mm');
  expect(asset.hash).toBe(await geometrySHA256(asset.stl));expect(base64ToBytes(asset.original!.data)).toEqual(new Uint8Array(mesh));
  expect(asset.original).toMatchObject({name:'bracket.stl',units:'mm',encoding:'base64'});expect(asset.original!.hash).toBe(await geometrySHA256(new Uint8Array(mesh)));
 });
 it('converts explicitly declared inches and detects a 25.4 unit mistake',async()=>{
  const inch=await parseSTL(tetrahedron,'in');expect(inch.dimensions).toEqual([25.4,50.8,76.19999999999999]);
  await expect(parseSTL(tetrahedron,'mm',{expectedDimensions:[25.4,50.8,76.2]})).rejects.toMatchObject({code:'UNIT_MISMATCH'});
  await expect(parseSTL(tetrahedron,'unknown' as 'mm')).rejects.toMatchObject({code:'UNITS_REQUIRED'});
 });
 it('parses binary STL whose header begins with solid without mistaking it for ASCII',async()=>{
  const vertices=(await parseSTL(tetrahedron,'mm')).vertices!;const bytes=new Uint8Array(84+50*4);bytes.set(new TextEncoder().encode('solid deceptive binary'));
  const view=new DataView(bytes.buffer);view.setUint32(80,4,true);
  for(let t=0;t<4;t++)for(let p=0;p<9;p++)view.setFloat32(84+t*50+12+p*4,vertices[t*9+p],true);
  const asset=await parseSTL(bytes,'mm');expect(asset.dimensions).toEqual([1,2,3]);expect(base64ToBytes(asset.original!.data)).toEqual(bytes);
 });
 it('rejects empty, malformed, non-finite, truncated, degenerate and oversized inputs',async()=>{
  await expect(parseSTL('','mm')).rejects.toMatchObject({code:'EMPTY'});
  await expect(parseSTL('not STL','mm')).rejects.toMatchObject({code:'INVALID_STL'});
  await expect(parseSTL(tetrahedron.replace('vertex 1 0 0','vertex NaN 0 0'),'mm')).rejects.toMatchObject({code:'INVALID_STL'});
  await expect(parseSTL(new Uint8Array([255,0,128]),'mm')).rejects.toMatchObject({code:'INVALID_STL'});
  await expect(parseSTL(tetrahedron.replace('vertex 1 0 0','vertex 0 0 0'),'mm')).rejects.toMatchObject({code:'DEGENERATE_TRIANGLE'});
  await expect(parseSTL(new Uint8Array(MAX_STL_BYTES+1),'mm')).rejects.toMatchObject({code:'TOO_LARGE'});
 });
 it('warns about open edges without repairing the mesh or merging solids',async()=>{
  const three=tetrahedron.replace(/facet normal 1 1 1[\s\S]*?endfacet\n/,'');const asset=await parseSTL(three,'mm');
  expect(asset.vertices).toHaveLength(27);expect(asset.warnings?.[0]).toContain('No repairs');
 });
 it('validates explicit positive CAD dimensions rather than auto fitting',()=>{
  expect(()=>validateDimensions([72,48,8],[72,48,8])).not.toThrow();
  expect(()=>validateDimensions([72,48,10],[72,48,8])).toThrow('do not match CAD');
  expect(()=>validateDimensions([1,1,1],[0,1,1])).toThrow('positive finite');
 });
 for(const [name,dimensions] of [['bracket-v19',[72,48,10]],['spacer',[18,18,12]],['pulley',[48,48,12]],['enclosure',[60,42,24]]] as const)it(`validates the real ${name} fixture mesh`,async()=>{
  const asset=await parseSTL(readFileSync(new URL(`../public/fixtures/${name}.stl`,import.meta.url)),'mm');expect(asset.dimensions).toEqual(dimensions);expect(asset.warnings).toEqual([]);
 });
});
