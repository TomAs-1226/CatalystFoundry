import type { AssemblyMembership, Classification, Part, PartCategory, SourceOccurrence, Vec3 } from '../domain/model';
import { geometrySHA256, parseSTL } from './geometry';

export const ONSHAPE_API_VERSION = 'v17';
export const liveOnshapeStatus = { available: false, mode: 'disconnected' as const, reason: 'Authorised server-side Onshape access has not been configured. The catalog below contains demonstration fixtures.' };
import {OnshapeError,parseOnshapeUrl} from '../domain/onshape-link';
export {OnshapeError,parseOnshapeUrl} from '../domain/onshape-link';
export type {OnshapeLink} from '../domain/onshape-link';

export interface AssemblyInstance {
  id: string; name: string; type: 'Part' | 'Assembly' | 'Feature' | 'Unknown'; documentId: string; elementId: string;
  documentVersion?: string; documentMicroversion?: string; configuration?: string; fullConfiguration?: string;
  partId?: string; suppressed?: boolean; isStandardContent?: boolean; status?: string; errorStatus?: string;
  /** Manufacturing decisions come from explicit team metadata, never the shape/colour. */
  classification?: Classification; available?: boolean;
}
export interface AssemblyNode { documentId: string; elementId: string; documentVersion?: string; documentMicroversion?: string; configuration?: string; fullConfiguration?: string; instances: AssemblyInstance[]; }
export interface AssemblyOccurrence { path: string[]; transform: number[]; hidden?: boolean; }
export interface AssemblyDefinition { rootAssembly: AssemblyNode & { occurrences: AssemblyOccurrence[] }; subAssemblies: AssemblyNode[]; parts?: unknown[]; }
export interface ResolvedAssemblyPart {
  key: string; partId: string; name: string; documentId: string; versionId?: string; microversionId?: string; elementId: string;
  configuration: string; quantity: number; occurrences: SourceOccurrence[]; classification: Classification; available: boolean; linkedDocumentId?: string;
  assemblyMemberships:AssemblyMembership[];standardContent?:boolean;
}
const identity = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
/** Onshape root occurrences already contain absolute transforms in metres. Do not multiply ancestor matrices. */
export function resolveAssemblyParts(definition: AssemblyDefinition, options: { excludePurchased?: boolean; assemblyScope?:string[] } = {}): ResolvedAssemblyPart[] {
  const groups = new Map<string, ResolvedAssemblyPart>();
  const seenPaths = new Set<string>();
  for (const occurrence of definition.rootAssembly.occurrences) {
    if (!occurrence.path.length) continue;
    const pathKey = JSON.stringify(occurrence.path);
    if (seenPaths.has(pathKey)) throw new OnshapeError('DUPLICATE_OCCURRENCE', `Assembly contains duplicate occurrence path ${occurrence.path.join('/')}.`);
    seenPaths.add(pathKey);
    let node: AssemblyNode = definition.rootAssembly, leaf: AssemblyInstance | undefined;
    let suppressed = false;
    const assemblyNames:string[]=[];
    for (let depth = 0; depth < occurrence.path.length; depth++) {
      const instance = node.instances.find(i => i.id === occurrence.path[depth]);
      if (!instance) throw new OnshapeError('MISSING_INSTANCE', `Cannot resolve occurrence ${occurrence.path.join('/')}; its assembly definition is incomplete.`);
      if (instance.suppressed) { suppressed = true; break; }
      leaf = instance;
      if (depth < occurrence.path.length - 1) {
        if(instance.type!=='Assembly')throw new OnshapeError('INVALID_ASSEMBLY_PATH','A nested occurrence must traverse an assembly.');
        assemblyNames.push(instance.name.replace(/\s*<\d+>$/, ''));
        const sub = definition.subAssemblies.find(s => s.documentId === instance.documentId && s.elementId === instance.elementId
          && (!instance.documentVersion || s.documentVersion === instance.documentVersion)
          && (!instance.documentMicroversion || s.documentMicroversion === instance.documentMicroversion)
          && (s.fullConfiguration ?? s.configuration ?? 'default') === (instance.fullConfiguration ?? instance.configuration ?? 'default'));
        if (!sub) throw new OnshapeError('UNAVAILABLE_LINK', `Linked/nested assembly ${instance.name} is unavailable. Resolve access before importing its occurrences.`);
        node = sub;
      }
    }
    if (suppressed || !leaf || leaf.type !== 'Part') continue;
    if(options.assemblyScope?.length&&!options.assemblyScope.every((id,index)=>occurrence.path[index]===id))continue;
    if (!leaf.partId) throw new OnshapeError('MISSING_PART_ID', `Occurrence ${leaf.name} has no part identifier. Review this assembly.`);
    const classification = leaf.classification ?? 'review';
    if (options.excludePurchased && classification === 'buy') continue;
    if (occurrence.transform.length !== 16 || occurrence.transform.some(n => !Number.isFinite(n)) || occurrence.transform[12] !== 0 || occurrence.transform[13] !== 0 || occurrence.transform[14] !== 0 || occurrence.transform[15] !== 1) throw new OnshapeError('INVALID_TRANSFORM', `Occurrence ${leaf.name} has an invalid installed transform.`);
    const configuration = leaf.fullConfiguration ?? leaf.configuration ?? 'default';
    const key = JSON.stringify([leaf.documentId, leaf.documentVersion ?? leaf.documentMicroversion, leaf.elementId, leaf.partId, configuration]);
    let group = groups.get(key);
    if (!group) {
      group = { key, partId: leaf.partId, name: leaf.name.replace(/\s*<\d+>$/, ''), documentId: leaf.documentId, elementId: leaf.elementId,
        versionId: leaf.documentVersion, microversionId: leaf.documentMicroversion, configuration, quantity: 0, occurrences: [], assemblyMemberships:[], standardContent:leaf.isStandardContent===true, classification,
        available: !!(leaf.documentVersion || leaf.documentMicroversion) && leaf.available !== false && !leaf.status && (!leaf.errorStatus || leaf.errorStatus === 'OK'),
        linkedDocumentId: leaf.documentId !== definition.rootAssembly.documentId ? leaf.documentId : undefined };
      groups.set(key, group);
    }
    group.available = group.available && !!(leaf.documentVersion || leaf.documentMicroversion) && leaf.available !== false && !leaf.status && (!leaf.errorStatus || leaf.errorStatus === 'OK');
    if (group.classification !== classification) group.classification = 'review';
    group.standardContent=group.standardContent===true&&leaf.isStandardContent===true;
    group.quantity++; group.occurrences.push({ path: [...occurrence.path], transform: [...occurrence.transform] });
    for(let depth=1;depth<occurrence.path.length;depth++){
      const path=occurrence.path.slice(0,depth);let membership=group.assemblyMemberships.find(entry=>JSON.stringify(entry.path)===JSON.stringify(path));
      if(!membership){membership={path,names:assemblyNames.slice(0,depth),quantity:0};group.assemblyMemberships.push(membership);}membership.quantity++;
    }
  }
  if(options.assemblyScope?.length&&![...groups.values()].some(group=>group.assemblyMemberships.some(entry=>JSON.stringify(entry.path)===JSON.stringify(options.assemblyScope))))throw new OnshapeError('UNKNOWN_ASSEMBLY_SCOPE','That subsystem is unavailable in this immutable assembly configuration.');
  return [...groups.values()];
}

const DOC = 'cafe00000000000000000001', VERSION = 'cafe00000000000000000018', NEXT_VERSION = 'cafe00000000000000000019';
const ASSEMBLY = 'cafe000000000000000000a1', STUDIO = 'cafe000000000000000000b1', LINKED_DOC = 'cafe00000000000000000002';
export const fixtureCatalog = [{ id: DOC, name: '2026 Competition Robot', mode: 'fixture' as const,
  description: 'Demonstration CAD · intake module and electronics',
  versions: [{ id: VERSION, name: 'V18 · Design freeze', revision: 'V18' }, { id: NEXT_VERSION, name: 'V19 · Mount reinforcement', revision: 'V19' }],
  elements: [{ id: ASSEMBLY, name: 'Intake assembly', type: 'assembly' as const }, { id: STUDIO, name: 'Manufactured parts', type: 'partstudio' as const }],
  configurations: [{ id: 'Robot=Competition', name: 'Competition robot' }, { id: 'Robot=Practice', name: 'Practice robot' }], newerVersion: NEXT_VERSION }];
export function listFixtureDocuments() { return structuredClone(fixtureCatalog); }
export interface FixtureSelection { documentId: string; versionId: string; elementId: string; configuration: string; partIds?: string[]; spares?: Record<string, number>; excludePurchased?: boolean; }
export const fixtureDefaultSelection: FixtureSelection = { documentId: DOC, versionId: VERSION, elementId: ASSEMBLY, configuration: 'Robot=Competition', excludePurchased: true };
export const fixtureUrl = `https://cad.onshape.com/documents/${DOC}/v/${VERSION}/e/${ASSEMBLY}?configuration=Robot%3DCompetition`;
interface FixtureMetadata { id: string; partId: string; name: string; dimensions: Vec3; category: PartCategory; classification: Classification; file?: string; materialHint?: string; colorHint?: string; available: boolean; }
const fixtureMetadata: FixtureMetadata[] = [
  { id: 'bracket', partId: 'JHD', name: 'Intake mounting bracket', dimensions: [72,48,8], category: 'bracket', classification: 'make', file: 'bracket.stl', materialHint: 'CAD: ABS', colorHint: '#ef8b77', available: true },
  { id: 'pulley', partId: 'JHP', name: 'Idler pulley · 48 mm', dimensions: [48,48,12], category: 'pulley', classification: 'make', file: 'pulley.stl', materialHint: 'CAD: nylon', colorHint: '#ddd9d2', available: true },
  { id: 'spacer', partId: 'JHS', name: 'Shaft spacer · 12 mm', dimensions: [18,18,12], category: 'spacer', classification: 'make', file: 'spacer.stl', materialHint: 'CAD: acetal', colorHint: '#b8c0c7', available: true },
  { id: 'enclosure', partId: 'JHE', name: 'Sensor enclosure', dimensions: [60,42,24], category: 'enclosure', classification: 'make', file: 'enclosure.stl', colorHint: '#84949b', available: true },
  { id: 'bearing', partId: 'STD', name: '608 bearing · purchased', dimensions: [22,22,7], category: 'custom', classification: 'buy', available: false },
  { id: 'linked-mount', partId: 'LNK', name: 'Linked camera mount · access required', dimensions: [32,28,6], category: 'custom', classification: 'review', available: false },
];
function validateFixtureSelection(selection: FixtureSelection) {
  if (selection.documentId !== DOC || ![VERSION,NEXT_VERSION].includes(selection.versionId) || ![ASSEMBLY,STUDIO].includes(selection.elementId) || !fixtureCatalog[0].configurations.some(c => c.id === selection.configuration)) throw new OnshapeError('UNKNOWN_FIXTURE', 'This document, immutable version, element or configuration is not in the demonstration catalog. Live Onshape is disconnected.');
}
function fixtureAssembly(selection: FixtureSelection): AssemblyDefinition {
  const instance = (id: string, fixtureId: string, extra: Partial<AssemblyInstance> = {}): AssemblyInstance => {
    const m = fixtureMetadata.find(p => p.id === fixtureId)!;
    return { id, name: m.name, type: 'Part', documentId: fixtureId === 'linked-mount' ? LINKED_DOC : DOC, elementId: STUDIO,
      documentVersion: fixtureId === 'linked-mount' ? 'cafe00000000000000000007' : selection.versionId, configuration: selection.configuration,
      partId: m.partId, classification: m.classification, available: m.available, ...extra };
  };
  const SUB = 'cafe000000000000000000a2';
  const sub: AssemblyNode = { documentId: DOC, documentVersion: selection.versionId, elementId: SUB, configuration: selection.configuration,
    instances: [instance('mount','bracket'),instance('idler','pulley'),instance('spacer-a','spacer'),instance('spacer-b','spacer'),instance('bearing-a','bearing'),instance('bearing-b','bearing'),instance('bearing-c','bearing'),instance('bearing-d','bearing')] };
  const root: AssemblyDefinition['rootAssembly'] = { documentId: DOC, documentVersion: selection.versionId, elementId: ASSEMBLY, configuration: selection.configuration,
    instances: [{ id: 'left', name: 'Left intake', type: 'Assembly', documentId: DOC, elementId: SUB, documentVersion: selection.versionId, configuration: selection.configuration },
      { id: 'right', name: 'Right intake', type: 'Assembly', documentId: DOC, elementId: SUB, documentVersion: selection.versionId, configuration: selection.configuration },
      instance('sensor-box','enclosure'), instance('camera','linked-mount'), instance('unused-bracket','bracket',{ suppressed: true })], occurrences: [] };
  const transform = (x: number, y: number, z = 0) => { const matrix = [...identity]; matrix[3] = x; matrix[7] = y; matrix[11] = z; return matrix; };
  for (const [side,x] of [['left',0.05],['right',0.25]] as const) {
    root.occurrences.push({ path: [side], transform: transform(x,0) });
    for (const [index,part] of sub.instances.entries()) {
      if (selection.configuration === 'Robot=Practice' && side === 'right' && part.id === 'idler') continue;
      root.occurrences.push({ path: [side,part.id], transform: transform(x,index * 0.025,0.03) });
    }
  }
  root.occurrences.push({ path: ['sensor-box'], transform: transform(0.15,0.2) }, { path: ['camera'], transform: transform(0.2,0.25) }, { path: ['unused-bracket'], transform: transform(0,0) });
  return { rootAssembly: root, subAssemblies: [sub] };
}
export interface FixturePartOption extends FixtureMetadata { assemblyMemberships?:AssemblyMembership[]; quantity: number; suppressed: boolean; linkedDocumentId?: string; occurrences: SourceOccurrence[]; }
export function getFixturePartOptions(selection: FixtureSelection): FixturePartOption[] {
  validateFixtureSelection(selection);
  const groups = selection.elementId === ASSEMBLY ? resolveAssemblyParts(fixtureAssembly(selection)) : [];
  return fixtureMetadata.map(meta => {
    const occurrence = groups.find(g => g.partId === meta.partId);
    const dimensions: Vec3 = meta.id === 'bracket' && selection.versionId === NEXT_VERSION ? [72,48,10] : [...meta.dimensions];
    return { ...meta, dimensions, file: meta.id === 'bracket' && selection.versionId === NEXT_VERSION ? 'bracket-v19.stl' : meta.file,
      quantity: selection.elementId === ASSEMBLY ? occurrence?.quantity ?? 0 : 1,
      occurrences: occurrence?.occurrences ?? [], assemblyMemberships:occurrence?.assemblyMemberships, suppressed: false, linkedDocumentId: occurrence?.linkedDocumentId };
  });
}
export const listFixtureParts = getFixturePartOptions;
import type {ImportProgress} from '../domain/import-progress';
export type {ImportProgress} from '../domain/import-progress';
export interface FixtureImportOptions { signal?: AbortSignal; onProgress?: (progress: ImportProgress) => void; fetcher?: typeof fetch; delayMs?: number; }
const geometryCache = new Map<string, Part['geometry']>();
export function clearFixtureGeometryCache() { geometryCache.clear(); }
const abortError = () => new DOMException('Geometry import cancelled. No project changes were applied.', 'AbortError');
function throwIfAborted(signal?: AbortSignal) { if (signal?.aborted) throw abortError(); }
async function pause(ms: number, signal?: AbortSignal) {
  throwIfAborted(signal); if (!ms) return;
  await new Promise<void>((resolve,reject) => { const end = () => { signal?.removeEventListener('abort',cancel); resolve(); }; const timer = setTimeout(end,ms); const cancel = () => { clearTimeout(timer); signal?.removeEventListener('abort',cancel); reject(abortError()); }; signal?.addEventListener('abort',cancel,{once:true}); });
}
/** Atomic batch transfer: callers add returned parts only when the whole promise succeeds. Cache is geometry-only and version/config keyed. */
export async function importFixtureParts(selection: FixtureSelection, options: FixtureImportOptions = {}): Promise<Part[]> {
  let progress = 0;
  const report = (phase: ImportProgress['phase'], percent: number, message: string, partId?: string) => { progress = percent; options.onProgress?.({ phase,percent,message,partId }); };
  try {
    const available = getFixturePartOptions(selection);
    const ids = selection.partIds ?? available.filter(p => p.classification === 'make' && p.available && p.quantity > 0).map(p => p.id);
    if (!ids.length) throw new OnshapeError('NO_SELECTION','Select at least one part to import.');
    if (new Set(ids).size !== ids.length) throw new OnshapeError('DUPLICATE_SELECTION','A part was selected twice. Set its quantity instead.');
    const parts: Part[] = [];
    report('queued',0,'Fixture export queued · live Onshape is disconnected');
    for (const [index,id] of ids.entries()) {
      throwIfAborted(options.signal);
      const meta = available.find(p => p.id === id);
      if (!meta || meta.quantity < 1) throw new OnshapeError('UNKNOWN_PART',`Part ${id} is unavailable in this configuration.`);
      if (selection.excludePurchased !== false && meta.classification === 'buy') continue;
      if (!meta.available || !meta.file) throw new OnshapeError('UNAVAILABLE_LINK',`${meta.name} has no accessible geometry. Configure authorised linked-document access or explicitly exclude it.`);
      const spareQuantity = selection.spares?.[id] ?? 0;
      if (!Number.isInteger(spareQuantity) || spareQuantity < 0 || spareQuantity > 1000) throw new OnshapeError('INVALID_QUANTITY','Spare quantities must be whole numbers from 0 through 1000.');
      const cacheKey = JSON.stringify([selection.documentId,selection.versionId,selection.elementId,selection.configuration,id]);
      let geometry = geometryCache.get(cacheKey);
      if (!geometry) {
        report('translating',Math.round(index / ids.length * 90),`Translating ${meta.name} · fixture`,id);
        await pause(options.delayMs ?? 180,options.signal);
        report('downloading',Math.round((index + 0.4) / ids.length * 90),`Transferring ${meta.name} · STL, declared mm`,id);
        const response = await (options.fetcher ?? fetch)(`/fixtures/${meta.file}`,{signal:options.signal});
        if (!response.ok) throw new OnshapeError('DOWNLOAD_FAILED',`Geometry transfer returned HTTP ${response.status}. Retry the fixture import.`);
        const bytes = await response.arrayBuffer(); throwIfAborted(options.signal);
        report('validating',Math.round((index + 0.7) / ids.length * 90),`Checking dimensions and geometry hash for ${meta.name}`,id);
        geometry = await parseSTL(bytes,'mm',{ name:meta.file, expectedDimensions:meta.dimensions });
        throwIfAborted(options.signal); geometryCache.set(cacheKey,structuredClone(geometry));
      } else report('cached',Math.round((index + 0.8) / ids.length * 90),`Using cached immutable geometry for ${meta.name}`,id);
      parts.push({ id: `${selection.documentId}:${selection.versionId}:${selection.elementId}:${selection.configuration}:${id}`, name:meta.name,
        geometry:structuredClone(geometry), quantity:meta.quantity, spareQuantity, category:meta.category, classification:meta.classification,
        materialHint:meta.materialHint,colorHint:meta.colorHint, notes:'Demonstration fixture. CAD material and colour are hints; select filament explicitly.',
        source:{kind:'fixture',documentId:meta.linkedDocumentId ?? selection.documentId,documentName:fixtureCatalog[0].name,
          originDocumentId:selection.documentId, elementId:STUDIO, elementName:'Manufactured parts', elementType:'partstudio',partId:meta.partId,
          versionId:selection.versionId,versionName:fixtureCatalog[0].versions.find(v => v.id === selection.versionId)!.name,
          configuration:selection.configuration,revision:selection.versionId === VERSION ? 'V18':'V19',
          url:`https://cad.onshape.com/documents/${meta.linkedDocumentId ?? selection.documentId}/v/${selection.versionId}/e/${STUDIO}?configuration=${encodeURIComponent(selection.configuration)}`,
          assemblyMemberships:structuredClone(meta.assemblyMemberships),originElementName:'Intake assembly',occurrences:structuredClone(meta.occurrences),installedTransformUnits:'m',linkedDocumentId:meta.linkedDocumentId,available:true} });
    }
    if (!parts.length) throw new OnshapeError('NO_MANUFACTURED_PARTS','All selected parts were explicitly excluded as purchased.');
    throwIfAborted(options.signal); report('done',100,`${parts.length} distinct parts transferred · repeated occurrences preserved`); return parts;
  } catch(error) { report(error instanceof DOMException && error.name === 'AbortError' ? 'cancelled':'failed',progress,error instanceof Error ? error.message : 'Geometry import failed.'); throw error; }
}
export async function createLocalPart(input: string | ArrayBuffer | Uint8Array, units: 'mm'|'in', name: string): Promise<Part> {
  if (!/\.stl$/i.test(name)) throw new OnshapeError('UNSUPPORTED_FORMAT','Local geometry import supports ASCII and binary .stl only.');
  const geometry = await parseSTL(input,units,{name});
  return {id:`local:${crypto.randomUUID()}`,name:name.replace(/\.stl$/i,''),geometry,source:{kind:'local',revision:geometry.hash.slice(0,12),available:true},quantity:1,spareQuantity:0,category:'custom',classification:'review',notes:'Local STL import; make/buy classification and intended use require review.'};
}
export interface RevisionChange { partId: string; name: string; changes: string[]; previousHash?: string; proposedHash?: string; }
/** Report only. Applying a revision is an explicit new job/replacement action owned by domain approval logic. */
export function comparePartRevisions(previous: Part[], proposed: Part[]): RevisionChange[] {
  const sourceKey = (part: Part) => JSON.stringify([part.source.documentId,part.source.elementId,part.source.partId ?? part.name,part.source.configuration]);
  const changes: RevisionChange[] = [];
  for (const old of previous) {
    const next = proposed.find(p => sourceKey(p) === sourceKey(old)); const detail: string[] = [];
    if (!next) detail.push('Part removed or unavailable in the proposed revision');
    else { if (old.geometry.hash !== next.geometry.hash) detail.push('Exported geometry changed'); if (old.source.versionId !== next.source.versionId) detail.push(`Source version ${old.source.revision ?? old.source.versionId} → ${next.source.revision ?? next.source.versionId}`); if (old.quantity !== next.quantity) detail.push(`Assembly quantity ${old.quantity} → ${next.quantity}`); }
    if (detail.length) changes.push({partId:old.id,name:old.name,changes:detail,previousHash:old.geometry.hash,proposedHash:next?.geometry.hash});
  }
  for (const next of proposed) if (!previous.some(p => sourceKey(p) === sourceKey(next))) changes.push({partId:next.id,name:next.name,changes:['Part added in the proposed revision'],proposedHash:next.geometry.hash});
  return changes;
}

/** Implement transport only on a trusted server. The adapter never handles browser credentials or arbitrary URLs. */
export interface OnshapeTransport { request<T>(method: 'GET'|'POST'|'DELETE', path: string, options?: {body?: unknown;signal?: AbortSignal;binary?:boolean}): Promise<T>; }
export interface ImmutablePartRef { documentId:string;versionId:string;elementId:string;partId:string;configuration:string;linkDocumentId?:string; }
export interface TranslatorFormat { name:string;validDestinationFormat:boolean;fileExtensions?:string[]; }
export interface Translation {id:string;requestState:'ACTIVE'|'DONE'|'FAILED';failureReason?:string;resultDocumentId?:string;documentId?:string;resultExternalDataIds?:string[];}
const escape = encodeURIComponent;
export class DocumentedOnshapeAdapter {
  constructor(private transport?: OnshapeTransport) {}
  get available() { return !!this.transport; }
  private request<T>(method:'GET'|'POST'|'DELETE', path:string, options?:{body?:unknown;signal?:AbortSignal;binary?:boolean}) { if (!this.transport) throw new OnshapeError('NOT_CONFIGURED',liveOnshapeStatus.reason); return this.transport.request<T>(method,`/api/${ONSHAPE_API_VERSION}${path}`,options); }
  listDocuments(query='',offset=0) { return this.request<unknown>('GET',`/documents?q=${escape(query)}&offset=${offset}&limit=20`); }
  listVersions(documentId:string,offset=0) { return this.request<unknown>('GET',`/documents/d/${escape(documentId)}/versions?offset=${offset}&limit=20`); }
  listElements(documentId:string,versionId:string,signal?:AbortSignal) { return this.request<unknown>('GET',`/documents/d/${escape(documentId)}/v/${escape(versionId)}/elements`,{signal}); }
  getConfigurations(documentId:string,versionId:string,elementId:string) { return this.request<unknown>('GET',`/elements/d/${escape(documentId)}/v/${escape(versionId)}/e/${escape(elementId)}/configuration`); }
  getAssembly(ref: Omit<ImmutablePartRef,'partId'>,signal?:AbortSignal) { return this.request<AssemblyDefinition>('GET',`/assemblies/d/${escape(ref.documentId)}/v/${escape(ref.versionId)}/e/${escape(ref.elementId)}?configuration=${escape(ref.configuration)}&excludeSuppressed=false&includeNonSolids=false${ref.linkDocumentId ? `&linkDocumentId=${escape(ref.linkDocumentId)}`:''}`,{signal}); }
  getPartStudioParts(ref: Omit<ImmutablePartRef,'partId'>,signal?:AbortSignal) { return this.request<unknown>('GET',`/parts/d/${escape(ref.documentId)}/v/${escape(ref.versionId)}/e/${escape(ref.elementId)}?configuration=${escape(ref.configuration)}&withThumbnails=true${ref.linkDocumentId ? `&linkDocumentId=${escape(ref.linkDocumentId)}`:''}`,{signal}); }
  getPartBoundingBox(ref:ImmutablePartRef,signal?:AbortSignal) { return this.request<{lowX:number;lowY:number;lowZ:number;highX:number;highY:number;highZ:number}>('GET',`/parts/d/${escape(ref.documentId)}/v/${escape(ref.versionId)}/e/${escape(ref.elementId)}/partid/${escape(ref.partId)}/boundingboxes?configuration=${escape(ref.configuration)}&includeHidden=true${ref.linkDocumentId ? `&linkDocumentId=${escape(ref.linkDocumentId)}`:''}`,{signal}); }
  async supportedGeometryFormats(signal?:AbortSignal) { const formats=await this.request<TranslatorFormat[]>('GET','/translations/translationformats',{signal}); return formats.filter(f=>f.validDestinationFormat && f.name.toUpperCase()==='STL'); }
  /** Sync per-part endpoint explicitly uses the documented inch export value, then converts deliberately to mm and checks dimensions. */
  async exportPartStl(ref:ImmutablePartRef,expectedDimensions:Vec3,signal?:AbortSignal) {
    if (!/^[a-f\d]{24}$/i.test(ref.versionId)) throw new OnshapeError('IMMUTABLE_VERSION_REQUIRED','Choose an immutable Onshape version before exporting.');
    const bytes=await this.request<ArrayBuffer>('GET',`/parts/d/${escape(ref.documentId)}/v/${escape(ref.versionId)}/e/${escape(ref.elementId)}/partid/${escape(ref.partId)}/stl?mode=text&units=inch&scale=1&configuration=${escape(ref.configuration)}${ref.linkDocumentId ? `&linkDocumentId=${escape(ref.linkDocumentId)}`:''}`,{signal,binary:true});
    return parseSTL(bytes,'in',{name:`${ref.partId}.stl`,expectedDimensions});
  }
  /** Generic async translation; format is checked against current capabilities, unit is explicit and verified on eventual mesh import. */
  async translatePart(ref:ImmutablePartRef,options:{formatName:string;unit:string;signal?:AbortSignal;onProgress?:(state:Translation)=>void;pollIntervalMs?:number;maxPolls?:number}) {
    if (!/^[a-f\d]{24}$/i.test(ref.versionId)) throw new OnshapeError('IMMUTABLE_VERSION_REQUIRED','Choose an immutable Onshape version before translating.');
    const formats=await this.supportedGeometryFormats(options.signal);
    const format=formats.find(f=>f.name===options.formatName);
    if (!format) throw new OnshapeError('UNSUPPORTED_FORMAT','Selected STL destination is not reported by the live translator. Geometry-only 3MF is not a slicer project.');
    if (!options.unit) throw new OnshapeError('UNITS_REQUIRED','Async translation units must be configured explicitly and checked against expected dimensions.');
    let translation: Translation | undefined;
    try {
      translation=await this.request<Translation>('POST',`/partstudios/d/${escape(ref.documentId)}/v/${escape(ref.versionId)}/e/${escape(ref.elementId)}/translations`,{signal:options.signal,body:{formatName:format.name,partIds:ref.partId,configuration:ref.configuration,unit:options.unit,stlMode:'TEXT',storeInDocument:false,grouping:true,resolution:'fine',...(ref.linkDocumentId ? {linkDocumentId:ref.linkDocumentId}:{})}});
      for(let poll=0;poll<(options.maxPolls ?? 120);poll++) {
        throwIfAborted(options.signal); options.onProgress?.(translation);
        if(translation.requestState==='FAILED') throw new OnshapeError('TRANSLATION_FAILED',translation.failureReason || 'Onshape translation failed. Review source availability and export settings.');
        if(translation.requestState==='DONE') {
          if(translation.resultExternalDataIds?.length!==1) throw new OnshapeError('UNEXPECTED_EXPORT','Expected one external STL file. Multi-file archives require explicit mapping and are not merged.');
          const documentId=translation.resultDocumentId ?? translation.documentId ?? ref.documentId;
          return await this.request<ArrayBuffer>('GET',`/documents/d/${escape(documentId)}/externaldata/${escape(translation.resultExternalDataIds[0])}`,{binary:true,signal:options.signal});
        }
        await pause(Math.min(15_000,(options.pollIntervalMs ?? 1500)*Math.pow(1.15,poll)),options.signal);
        translation=await this.request<Translation>('GET',`/translations/${escape(translation.id)}`,{signal:options.signal});
      }
      throw new OnshapeError('TRANSLATION_TIMEOUT','Translation did not finish within the polling window. Retry or check its status in Onshape.');
    } catch(error) {
      if(options.signal?.aborted && translation) { try { await this.request('DELETE',`/translations/${escape(translation.id)}`); } catch { /* Local cancellation still succeeds; remote request may complete and should be cleaned up by server policy. */ } }
      throw error;
    }
  }
}
export async function fixtureSourceFingerprint(selection:FixtureSelection) { return geometrySHA256(JSON.stringify([selection.documentId,selection.versionId,selection.elementId,selection.configuration])); }
