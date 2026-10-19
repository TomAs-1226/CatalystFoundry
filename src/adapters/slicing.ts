import type { Job, ProcessSettings, Project } from '../domain/model';
import type { SliceJob, SliceJobSummary,SlicerCapability } from '../../server/slicer';
import type { PreparedSlice } from '../../server/slicing-http';
export type { SliceJob,SliceJobSummary, PreparedSlice, SlicerCapability };
export interface SlicingSetup {capability:SlicerCapability;configured:boolean;profileLabel?:string;configurationVariable:string;instructions:string[];}
export interface ConfiguredSlicingProfile {printer:Job['printer'];material:Job['material'];slicer:Job['slicer'];profileLabel:string;}
export interface BundledSlicing {installed:boolean;version:string|null;selectedProfileId?:string;profiles:{id:string;label:string;printer:Job['printer'];material:Job['material']}[];}
async function request<T>(path:string,body?:unknown,signal?:AbortSignal):Promise<T>{
 const response=await fetch(path,{...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),signal});
 const data=await response.json();if(!response.ok)throw new Error(data.error??`Slicing service returned ${response.status}.`);return data as T;
}
export const getSlicingSetup=(signal?:AbortSignal)=>request<SlicingSetup>('/api/slicing/setup',undefined,signal);
export const getBundledSlicing=()=>request<BundledSlicing>('/api/slicing/bundled');
export const selectBundledSlicing=(id:string,reviewed:boolean)=>request('/api/slicing/bundled/select',{id,reviewed});
/** Returns a recommendation only. Caller must explicitly apply it, invalidating any prior result. */
export const resolveSlicingProfile=(settings:ProcessSettings,signal?:AbortSignal,materialColor?:string)=>request<ConfiguredSlicingProfile>('/api/slicing/profile',{settings,materialColor},signal);
export const prepareLiveSlice=(project:Project,jobId:string,signal?:AbortSignal)=>request<PreparedSlice>('/api/slicing/prepare',{project,jobId},signal);
export const queueLiveSlice=(preparation:PreparedSlice,idempotencyKey:string,signal?:AbortSignal)=>request<SliceJob>('/api/slicing/jobs',{preparationId:preparation.preparationId,manifestHash:preparation.manifestHash,idempotencyKey},signal);
export const getSliceJob=(id:string,signal?:AbortSignal)=>request<SliceJob>(`/api/slicing/jobs/${encodeURIComponent(id)}`,undefined,signal);
export const cancelSliceJob=(id:string,signal?:AbortSignal)=>request<SliceJob>(`/api/slicing/jobs/${encodeURIComponent(id)}/cancel`,{},signal);
