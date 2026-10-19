import {useEffect,useRef,useState} from 'react';
import type {Project} from '../domain/model';
import {ProjectAutosave} from './project-autosave';
import {workspaceSnapshot,type WorkspaceSnapshot} from './use-workspace-snapshot';
export function useProjectAutosave(project:Project,snapshot:WorkspaceSnapshot|undefined,enabled:boolean){
 const [state,setState]=useState<{message:string;error?:string}>({message:''});
 const saveRef=useRef<ProjectAutosave|undefined>(undefined);
 if(!saveRef.current)saveRef.current=new ProjectAutosave(async json=>{
  const response=await fetch('/api/project',{method:'PUT',headers:{'Content-Type':'application/json'},body:json});
  if(!response.ok){let reason='Local save failed. Export a portable project or retry Save progress.';try{reason=(await response.json()).error??reason;}catch{}throw Error(reason);}
 },(state,error)=>setState({message:state==='saving'?'Saving on this laptop…':state==='saved'?'Saved on this laptop':'Save failed · retry Save progress',error:error?.message}));
 useEffect(()=>{
  if(!enabled||!snapshot)return;
  const timer=setTimeout(()=>void saveRef.current!.save(snapshot.json).catch(()=>{}),650);
  return()=>clearTimeout(timer);
 },[snapshot,enabled]);
 return {...state,save:async(current:Project)=>{const value=current===project&&snapshot?snapshot:await workspaceSnapshot(current);await saveRef.current!.save(value.json);}};
}
