import {useEffect,useRef,useState} from 'react';
import {getSliceJob} from '../adapters/slicing';
import type {SliceJob,SliceJobSummary} from '../adapters/slicing';
import type {Job,Project} from '../domain/model';
import {SliceSession,type SliceSessionState} from './slice-session';
export function useSliceSession(options:{project:Project;job:Job;manifestHash:string;busy:boolean;current:()=>{project:Project;job:Job};locked:()=>boolean;attach:(slice:SliceJob)=>Promise<void|boolean>;preview:(slice:SliceJob)=>void}){
 const live=useRef(options);live.current=options;
 const [state,setState]=useState<SliceSessionState>({phase:'idle',message:''});
 const ref=useRef<SliceSession|undefined>(undefined);
 // Root owns this effect. Workspace panels only subscribe to its state.
 useEffect(()=>{const session=new SliceSession({current:()=>live.current.current(),busy:()=>live.current.locked(),read:getSliceJob,list:async(hash,signal)=>{const response=await fetch(`/api/slicing/jobs?summary=true&manifestHash=${hash}`,{signal});const data=await response.json();if(!response.ok)throw Error(data.error??'Local slice status unavailable');return (data as {jobs:SliceJobSummary[]}).jobs;},attach:slice=>live.current.attach(slice),preview:slice=>live.current.preview(slice),changed:setState});ref.current=session;void session.restore();return()=>{session.dispose();ref.current=undefined;};},[]);
 useEffect(()=>{ref.current?.context();if(options.manifestHash)void ref.current?.restore();},[options.project.id,options.job.id,options.manifestHash]);
 useEffect(()=>{if(!options.busy&&state.phase==='waiting'){const timer=setTimeout(()=>void ref.current?.resume(),150);return()=>clearTimeout(timer);}},[options.busy,state.phase,state.slice?.id]);
 return {...state,accept:(slice:SliceJob)=>ref.current?.accept(slice)??Promise.resolve(),retry:()=>ref.current?.retry()??Promise.resolve()};
}
