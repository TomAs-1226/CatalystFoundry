import {useEffect,useRef,useState} from 'react';
import {connectLocal,getSyncStatus,localSyncRequest,type SyncStatus} from '../adapters/sync';
import type {SyncClient} from './SyncWorkspace';
import type {Part} from '../domain/model';
import SharedCadLibrary from './SharedCadLibrary';
const client:SyncClient={request:localSyncRequest,status:getSyncStatus,connect:connectLocal,logout:()=>localSyncRequest('/logout','POST',{})};
export default function SharedCadIntake({onImport,workOrder}:{onImport:(parts:Part[],options?:{organize?:boolean;workOrder?:string})=>void|boolean;workOrder:string}){
 const [status,setStatus]=useState<SyncStatus>(),[cachedAccount,setCachedAccount]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);const live=useRef(true),controller=useRef<AbortController|undefined>(undefined);
 useEffect(()=>{live.current=true;void localSyncRequest<{localAccount:boolean}>('/library').then(value=>{if(live.current)setCachedAccount(value.localAccount);}).catch(()=>{});void getSyncStatus().then(value=>{if(live.current)setStatus(value);}).catch(error=>{if(live.current)setError((error as Error).message);});return()=>{live.current=false;controller.current?.abort();};},[]);
 async function connect(){if(busy)return;setBusy(true);setError('');controller.current=new AbortController();try{const next=await connectLocal('github',controller.current.signal);if(live.current)setStatus(next);}catch(error){if(live.current)setError((error as Error).message);}finally{if(live.current)setBusy(false);}}
 if(status?.signedIn||cachedAccount)return <SharedCadLibrary key={`${status?.url}:${status?.user?.id}`} client={client} status={status??{configured:true,signedIn:false,url:'',reason:'Using local CAD cache.'}} localLibrary allowManualShare={false} workOrder={workOrder} onUseParts={(parts,order)=>onImport(parts,{organize:true,workOrder:order})}/>;
 return <section className="shared-cad-library"><h3>Your team’s robot parts</h3><p>Sign in to load the cloud library automatically. Foundry saves CAD on this laptop for offline preparation; teammates do not need their own Onshape connection.</p>{error&&<p className="sync-error" role="alert">{error}</p>}{!status&&!error?<p role="status">Checking team sign-in…</p>:<button className="cat-btn cat-btn--primary" disabled={busy||!status?.configured} onClick={()=>void connect()}>{busy?'Waiting for GitHub sign-in…':'Sign in to team parts'}</button>}</section>;
}
