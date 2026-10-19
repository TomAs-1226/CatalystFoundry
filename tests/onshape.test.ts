import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { clearFixtureGeometryCache, comparePartRevisions, createLocalPart, DocumentedOnshapeAdapter, fixtureCatalog, fixtureDefaultSelection, fixtureUrl, getFixturePartOptions, importFixtureParts, liveOnshapeStatus, parseOnshapeUrl, resolveAssemblyParts, type AssemblyDefinition, type ImportProgress, type OnshapeTransport } from '../src/adapters/onshape';
const fetcher=vi.fn(async(input: string|URL|Request)=>new Response(readFileSync(new URL(`../public${input.toString()}`,import.meta.url)))) as unknown as typeof fetch;
const options={fetcher,delayMs:0};
beforeEach(()=>{clearFixtureGeometryCache();vi.clearAllMocks()});
describe('Onshape fixture workflow',()=>{
 it('counts repeated nested leaf occurrences instead of unique part definitions',()=>{
  const parts=getFixturePartOptions(fixtureDefaultSelection);
  expect(parts.find(p=>p.id==='bracket')?.quantity).toBe(2);expect(parts.find(p=>p.id==='spacer')?.quantity).toBe(4);
  const spacers=parts.find(p=>p.id==='spacer')!;expect(spacers.occurrences.map(o=>o.path)).toEqual([['left','spacer-a'],['left','spacer-b'],['right','spacer-a'],['right','spacer-b']]);
  expect(spacers.occurrences[2].transform[3]).toBe(.25); // absolute metres, not compounded
  expect(parts.find(p=>p.id==='bearing')?.quantity).toBe(8);
 });
 it('preserves immutable version, configuration, names, transforms and spare quantities',async()=>{
  const parts=await importFixtureParts({...fixtureDefaultSelection,spares:{spacer:3}},options);
  expect(parts).toHaveLength(4);const spacer=parts.find(p=>p.category==='spacer')!;
  expect(spacer.quantity).toBe(4);expect(spacer.spareQuantity).toBe(3);expect(spacer.source).toMatchObject({kind:'fixture',configuration:'Robot=Competition',versionId:fixtureDefaultSelection.versionId,partId:'JHS',installedTransformUnits:'m'});
  expect(spacer.source.url).toContain('/v/');expect(spacer.geometry.original).toBeDefined();
  const practice=getFixturePartOptions({...fixtureDefaultSelection,configuration:'Robot=Practice'});expect(practice.find(p=>p.id==='pulley')?.quantity).toBe(1);
  const studio=getFixturePartOptions({...fixtureDefaultSelection,elementId:fixtureCatalog[0].elements[1].id});expect(studio.filter(p=>p.classification==='make').map(p=>p.quantity)).toEqual([1,1,1,1]);
 });
 it('separately identifies unavailable linked and explicit purchased parts',async()=>{
  const parts=getFixturePartOptions(fixtureDefaultSelection);expect(parts.find(p=>p.id==='linked-mount')).toMatchObject({available:false,classification:'review',linkedDocumentId:expect.any(String)});
  await expect(importFixtureParts({...fixtureDefaultSelection,partIds:['linked-mount']},options)).rejects.toMatchObject({code:'UNAVAILABLE_LINK'});
  await expect(importFixtureParts({...fixtureDefaultSelection,partIds:['bearing']},options)).rejects.toMatchObject({code:'NO_MANUFACTURED_PARTS'});
  await expect(importFixtureParts({...fixtureDefaultSelection,partIds:['bearing'],excludePurchased:false},options)).rejects.toMatchObject({code:'UNAVAILABLE_LINK'});
 });
 it('supports cancellation and retry without returning a partial batch',async()=>{
  const signal=new AbortController();const progress:ImportProgress[]=[];
  await expect(importFixtureParts(fixtureDefaultSelection,{...options,delayMs:20,signal:signal.signal,onProgress:p=>{progress.push(p);if(p.phase==='translating')signal.abort()}})).rejects.toMatchObject({name:'AbortError'});
  expect(progress.at(-1)?.phase).toBe('cancelled');expect(await importFixtureParts({...fixtureDefaultSelection,partIds:['bracket']},options)).toHaveLength(1);
 });
 it('caches only exact immutable version/config geometry and reports progress',async()=>{
  const onProgress=vi.fn();const selection={...fixtureDefaultSelection,partIds:['bracket']};
  const first=await importFixtureParts(selection,{...options,onProgress});await importFixtureParts(selection,{...options,onProgress});
  expect(fetcher).toHaveBeenCalledTimes(1);expect(onProgress.mock.calls.some(([p])=>p.phase==='cached')).toBe(true);
  const next=await importFixtureParts({...selection,versionId:fixtureCatalog[0].versions[1].id},options);expect(fetcher).toHaveBeenCalledTimes(2);
  expect(first[0].geometry.hash).not.toBe(next[0].geometry.hash);expect(comparePartRevisions(first,next)[0].changes).toContain('Exported geometry changed');
  expect(first[0].geometry.dimensions).toEqual([72,48,8]); // old source never replaced
 });
 it('rejects duplicate selections, unknown fixtures, invalid spares and download failures',async()=>{
  await expect(importFixtureParts({...fixtureDefaultSelection,partIds:['bracket','bracket']},options)).rejects.toMatchObject({code:'DUPLICATE_SELECTION'});
  await expect(importFixtureParts({...fixtureDefaultSelection,configuration:'invented'},options)).rejects.toMatchObject({code:'UNKNOWN_FIXTURE'});
  await expect(importFixtureParts({...fixtureDefaultSelection,partIds:['bracket'],spares:{bracket:1.5}},options)).rejects.toMatchObject({code:'INVALID_QUANTITY'});
  await expect(importFixtureParts({...fixtureDefaultSelection,partIds:['bracket']},{...options,fetcher:async()=>new Response('bad',{status:503})})).rejects.toMatchObject({code:'DOWNLOAD_FAILED'});
 });
 it('imports real local STL as review-required while preserving exact bytes and declared units',async()=>{
  const part=await createLocalPart(readFileSync(new URL('../public/fixtures/spacer.stl',import.meta.url)),'mm','spacer.stl');expect(part.classification).toBe('review');expect(part.source.kind).toBe('local');expect(part.geometry.dimensions).toEqual([18,18,12]);
  await expect(createLocalPart('x','mm','part.step')).rejects.toMatchObject({code:'UNSUPPORTED_FORMAT'});
 });
});
describe('documented Onshape boundary',()=>{
 it('strictly parses fixture, configured immutable and workspace links without fetching arbitrary hosts',()=>{
  expect(parseOnshapeUrl(fixtureUrl)).toMatchObject({documentId:fixtureDefaultSelection.documentId,immutable:true,versionId:fixtureDefaultSelection.versionId,configuration:'Robot=Competition'});
  expect(parseOnshapeUrl(fixtureUrl.replace('/v/','/w/')).immutable).toBe(false);
  for(const bad of ['http://cad.onshape.com'+new URL(fixtureUrl).pathname,fixtureUrl.replace('cad.onshape.com','evil.test'),fixtureUrl.replace('cad.onshape.com','cad.onshape.com.evil.test'),'https://cad.onshape.com/documents/not-an-id']) expect(()=>parseOnshapeUrl(bad)).toThrow();
 });
 it('reports live unavailable with no configured server transport',()=>{
  const live=new DocumentedOnshapeAdapter();expect(live.available).toBe(false);expect(liveOnshapeStatus.available).toBe(false);expect(()=>live.listDocuments()).toThrow('not been configured');
 });
 it('uses verified v17 read endpoints and URL-encodes configurations',async()=>{
  const calls:unknown[][]=[];const transport:OnshapeTransport={request:async(...args)=>{calls.push(args);return {} as never}};
  const live=new DocumentedOnshapeAdapter(transport);await live.getAssembly({...fixtureDefaultSelection,configuration:'length=25 mm;side=left'});
  expect(calls[0][1]).toContain('/api/v17/assemblies/d/');expect(calls[0][1]).toContain('/v/');expect(calls[0][1]).toContain('configuration=length%3D25%20mm%3Bside%3Dleft');
 });
 it('polls real API-shaped async states and downloads only the completed external artifact',async()=>{
  const request=vi.fn(async(method:string,path:string)=>{
   if(path.endsWith('translationformats'))return [{name:'STL',validDestinationFormat:true},{name:'3MF',validDestinationFormat:false}];
   if(method==='POST')return {id:'translation-1',requestState:'ACTIVE'};
   if(path.endsWith('/translations/translation-1'))return {id:'translation-1',requestState:'DONE',resultExternalDataIds:['file-1'],resultDocumentId:'doc-1'};
   if(path.includes('/externaldata/'))return new Uint8Array([1,2,3]).buffer;throw Error('Unexpected request');
  });
  const live=new DocumentedOnshapeAdapter({request:request as OnshapeTransport['request']});
  const data=await live.translatePart({...fixtureDefaultSelection,partId:'JHD'},{formatName:'STL',unit:'inch',pollIntervalMs:0});
  expect(new Uint8Array(data)).toEqual(new Uint8Array([1,2,3]));expect(request.mock.calls.map(c=>c[1])).toContain('/api/v17/documents/d/doc-1/externaldata/file-1');
 });
 it('propagates translation failure and cancels the documented remote request',async()=>{
  const signal=new AbortController();const request=vi.fn(async(method:string,path:string)=>{
   if(path.endsWith('translationformats'))return [{name:'STL',validDestinationFormat:true}];
   if(method==='POST')return {id:'translation-2',requestState:'ACTIVE'};return {};
  });const live=new DocumentedOnshapeAdapter({request:request as OnshapeTransport['request']});
  await expect(live.translatePart({...fixtureDefaultSelection,partId:'JHD'},{formatName:'STL',unit:'inch',signal:signal.signal,onProgress:()=>signal.abort(),pollIntervalMs:1})).rejects.toMatchObject({name:'AbortError'});
  expect(request).toHaveBeenCalledWith('DELETE','/api/v17/translations/translation-2',undefined);
  const failed=new DocumentedOnshapeAdapter({request:async(_method,path)=>path.endsWith('translationformats')?[{name:'STL',validDestinationFormat:true}] as never:{id:'bad',requestState:'FAILED',failureReason:'Linked version unavailable'} as never});
  await expect(failed.translatePart({...fixtureDefaultSelection,partId:'JHD'},{formatName:'STL',unit:'inch'})).rejects.toThrow('Linked version unavailable');
 });
 it('rejects duplicate occurrences and skips suppressed nested ancestors',()=>{
  const instance={id:'one',name:'Part',type:'Part' as const,documentId:'d',elementId:'e',partId:'p'};const occurrence={path:['one'],transform:[1,0,0,.25,0,1,0,0,0,0,1,0,0,0,0,1]};
  const assembly:AssemblyDefinition={rootAssembly:{documentId:'d',elementId:'root',instances:[{...instance,suppressed:true}],occurrences:[occurrence]},subAssemblies:[]};
  expect(resolveAssemblyParts(assembly)).toEqual([]);assembly.rootAssembly.instances[0].suppressed=false;assembly.rootAssembly.occurrences.push(occurrence);expect(()=>resolveAssemblyParts(assembly)).toThrow('duplicate occurrence');
 });
});

import { createOAuthOnshapeTransport } from '../server/onshape';
describe('server-only OAuth transport',()=>{
 it('reports disconnected without a token and never makes a network request',async()=>{
  const fetcher=vi.fn();const transport=createOAuthOnshapeTransport({getAccessToken:async()=>undefined,fetcher});
  await expect(transport.request('GET','/api/v17/documents')).rejects.toMatchObject({status:503});expect(fetcher).not.toHaveBeenCalled();
 });
 it('rejects arbitrary paths and unreviewed export hosts',async()=>{
  const transport=createOAuthOnshapeTransport({getAccessToken:async()=>'test-token',fetcher:async()=>new Response(null,{status:307,headers:{location:'https://unknown.example/export'}})});
  await expect(transport.request('GET','https://evil.test/api')).rejects.toThrow('relative documented');
  await expect(transport.request('GET','/api/v17/parts/example/stl',{binary:true})).rejects.toThrow('unreviewed artifact host');
 });
 it('never forwards OAuth authorisation to explicitly reviewed external artifact hosts',async()=>{
  const calls:RequestInit[]=[];const transport=createOAuthOnshapeTransport({getAccessToken:async()=>'test-token',artifactHosts:['artifact.example'],fetcher:async(_url,init)=>{calls.push(init!);return calls.length===1?new Response(null,{status:307,headers:{location:'https://artifact.example/export'}}):new Response('stl-bytes')}});
  const bytes=await transport.request<ArrayBuffer>('GET','/api/v17/parts/example/stl',{binary:true});expect(new TextDecoder().decode(bytes)).toBe('stl-bytes');
  expect(calls[0].headers).toMatchObject({Authorization:'Bearer test-token'});expect(calls[1].headers).not.toHaveProperty('Authorization');
 });
});
