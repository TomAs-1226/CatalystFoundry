import {localSyncRequest,type Preferences} from "../adapters/sync";
import { useEffect, useRef, useState } from 'react';
import type { Job, Project } from '../domain/model';
import type { SliceJob } from '../adapters/slicing';
import type { PrintHandoff } from '../../server/printing';
import BambuConnectSetup,{type ConnectSetup} from './BambuConnectSetup';
export default function PrintHandoffPanel({project,job,slice,current,onError}:{project:Project;job:Job;slice:SliceJob;current:boolean;onError:(e:unknown)=>void}){
 const [setup,setSetup]=useState<ConnectSetup>(),[mode,setMode]=useState<'lan'|'connect'>('lan'),[review,setReview]=useState(false),[busy,setBusy]=useState(false),[receipt,setReceipt]=useState<PrintHandoff>();
 const lock=useRef(false);
 useEffect(()=>{void localSyncRequest<Preferences>('/preferences').then(p=>setMode(p.data.defaultConnectionMode)).catch(()=>{});},[]);
 useEffect(()=>{setReview(false);setReceipt(undefined);},[slice.id,current,job.printer.model]);
 async function send(){if(lock.current||!review||!current)return;lock.current=true;setBusy(true);
  try{const response=await fetch('/api/printing/handoff',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project,jobId:job.id,sliceId:slice.id,manifestHash:slice.manifestHash,mode,reviewInConnect:true})});const data=await response.json();if(!response.ok)throw new Error(data.error??'Could not open Connect.');setReceipt(data);}
  catch(e){onError(e);}finally{lock.current=false;setBusy(false);}
 }
 return <section className="print-handoff" aria-label="Send print to Bambu">
  <h3>Print with Bambu Connect</h3>
  <p className="smalltext">{job.printer.model} · Native review and final Print happen in Connect. Foundry cannot confirm a printer accepted or started this job.</p>
  <details open={!setup?.available}><summary>Printer connection and account</summary><BambuConnectSetup onChange={setSetup}/></details>
  <label className="field">Connection<select aria-label="Bambu print connection" value={mode} onChange={e=>{setMode(e.target.value as 'lan'|'connect');setReview(false);}}><option value="lan">LAN-only via Bambu Connect</option><option value="connect">Bambu cloud via Bambu Connect</option></select></label>
  <p className="smalltext">{mode==='lan'?'Choose your LAN printer in Connect. LAN-only operation needs no Bambu account.':'Sign in and choose your cloud printer inside Connect.'} This selection records your intended mode; Connect controls the actual connection.</p>
  <label className="checkline"><input type="checkbox" checked={review} onChange={e=>setReview(e.target.checked)}/>I will verify the exact printer, plate, nozzle, filament, native toolpath and physical conditions in Connect before pressing Print.</label>
  <button className="btn primary fullwidth" disabled={!setup?.available||!review||!current||busy||!!receipt} onClick={()=>void send()}>{busy?'Opening native review…':'Open exact job in Bambu Connect'}</button>
  {receipt&&<p className="smalltext" role="status">{receipt.status==='opened-for-review'?'Opened for native review. Printer status: unknown.':receipt.status==='opening'?'A previous handoff may have opened. Check Connect; this job will not reopen automatically.':`Connect could not open: ${receipt.error}. Download the native file to open it manually.`} {receipt.reservationId?'Shared copies remain reserved; record manufacturing observations in Team sync. ':''}Duplicate requests do not open this job twice.</p>}
 </section>;
}
