import {useEffect,useState} from 'react';
import type {UpdateStatus} from '../../server/desktop-updates';
export function AppUpdates({canRestart,onSave}:{canRestart:boolean;onSave:()=>Promise<boolean>}){
 const [status,setStatus]=useState<UpdateStatus>(),[error,setError]=useState(''),[working,setWorking]=useState(false);
 const read=async()=>{const response=await fetch('/api/desktop/updates');if(!response.ok)throw Error('Update status is unavailable.');setStatus(await response.json());};
 useEffect(()=>{let live=true;const refresh=()=>void fetch('/api/desktop/updates').then(r=>r.json()).then(value=>{if(live)setStatus(value);}).catch(error=>{if(live)setError(error.message);});refresh();const timer=setInterval(refresh,1500);return()=>{live=false;clearInterval(timer);};},[]);
 const action=async(kind:'check'|'download'|'install')=>{
  setWorking(true);setError('');
  try{
   if(kind==='install'&&(!canRestart||!await onSave()))throw Error('Save the current project before restarting. Resolve any save error and retry.');
   const response=await fetch('/api/desktop/updates/'+kind,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(kind==='install'?{confirmRestart:true}:{})});
   const value=await response.json();if(!response.ok)throw Error(value.error??'Update action failed.');setStatus(value);
  }catch(error){setError((error as Error).message);await read().catch(()=>{});}finally{setWorking(false);}
 };
 const active=working||['checking','downloading','installing'].includes(status?.phase??'');
 return <section className="app-updates">
  <p>Foundry {status?.currentVersion??'desktop'} · internal channel</p>
  <p role="status">{status?.message??'Reading update status…'}</p>
  {status?.phase==='downloading'&&<progress aria-label="Update download" max={100} value={status.progress??0}/>}
  {(error||status?.phase==='error')&&<p className="notice error" role="alert">{error||status?.message}</p>}
  <div className="updates-actions">
   <button className="btn" disabled={!status?.available||active} onClick={()=>void action('check')}>Check for updates</button>
   {status?.phase==='available'&&<button className="btn primary" disabled={active} onClick={()=>void action('download')}>Download {status.version}</button>}
   {status?.phase==='ready'&&<button className="btn primary" disabled={active||!canRestart} onClick={()=>void action('install')}>Save & restart to update</button>}
  </div>
  {!canRestart&&<p>Finish or cancel slicing and wait for the current action before restarting.</p>}
  <p className="smalltext">Updates are downloaded from the app’s public repository and checked with Foundry’s release verification key. A restart saves this laptop’s project first.</p>
  <a href={status?.repository??'https://github.com/TomAs-1226/CatalystFoundry'} target="_blank" rel="noreferrer">App source and release notes</a>
 </section>;
}
