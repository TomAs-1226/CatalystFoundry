import {useEffect,useState} from 'react';
import {Download,ExternalLink,LoaderCircle,RefreshCw} from 'lucide-react';
export interface ConnectSetup {available:boolean;reason:string;version?:string;canInstall?:boolean;canOpen?:boolean;loginStatus?:'unknown';installation?:{phase:string;message:string;bytes?:number;total?:number;};}
export default function BambuConnectSetup({onChange}:{onChange?:(setup:ConnectSetup)=>void}){
 const [setup,setSetup]=useState<ConnectSetup>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const installing=['downloading','installing'].includes(setup?.installation?.phase??'');
 async function refresh(signal?:AbortSignal){const response=await fetch('/api/printing/setup',{signal});const value=await response.json();if(!response.ok)throw Error(value.error??'Connect setup is unavailable.');setSetup(value);onChange?.(value);return value;}
 useEffect(()=>{const controller=new AbortController();void refresh(controller.signal).catch(error=>{if(!controller.signal.aborted)setError(error.message);});return()=>controller.abort();},[]);
 useEffect(()=>{if(!installing)return;const controller=new AbortController();const timer=setTimeout(()=>void refresh(controller.signal).catch(error=>{if(!controller.signal.aborted)setError(error.message);}),1500);return()=>{clearTimeout(timer);controller.abort();};},[installing,setup]);
 async function action(kind:'install'|'open'){if(busy)return;setBusy(true);setError('');try{const response=await fetch('/api/printing/connect/'+kind,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(kind==='install'?{confirmInstall:true}:{})});const value=await response.json();if(!response.ok)throw Error(value.error??'Connect could not open.');setSetup(value);onChange?.(value);}catch(error){setError((error as Error).message);}finally{setBusy(false);}}
 return <section className="connect-setup" aria-label="Bambu Connect setup">
  <p className="smalltext">{setup?.available?`Official companion installed${setup.version?' · '+setup.version:''}.`:'Set up the official companion once for this Windows user.'} Cloud login and LAN discovery happen inside Bambu Connect.</p>
  {!setup&&<p role="status"><LoaderCircle size={13} className="spin"/> Checking Connect…</p>}
  {error&&<p className="notice error" role="alert">{error}</p>}
  {setup?.installation?.message&&<p className={setup.installation.phase==='error'?'notice error':'smalltext'} role="status">{setup.installation.message}</p>}
  {installing&&<progress aria-label="Official Connect installation progress" max={setup?.installation?.total??1} value={setup?.installation?.phase==='downloading'?setup.installation.total?setup.installation.bytes:undefined:undefined}/>}
  <div className="buttonrow">
   {setup&&!setup.available&&setup.canInstall&&<button className="btn primary" disabled={busy||installing} onClick={()=>void action('install')}><Download size={14}/>{installing?'Setting up Connect…':'Install & open Bambu Connect'}</button>}
   {setup?.available&&setup.canOpen&&<button className="btn" disabled={busy||installing} onClick={()=>void action('open')}><ExternalLink size={14}/>{busy?'Opening…':'Open Connect · sign in or pair'}</button>}
   <button className="btn" disabled={busy||installing} onClick={()=>void refresh().catch(error=>setError(error.message))}><RefreshCw size={13}/>Recheck</button>
  </div>
  {setup&&!setup.available&&<p className="smalltext">{setup.reason} The included setup downloads Bambu’s pinned, publisher-verified Windows installer.</p>}
  <p className="smalltext">Cloud: sign in with your Bambu account. LAN-only: use Discover and the printer’s pairing information. Foundry keeps team jobs shared; it does not collect or share Bambu passwords, and it cannot read Connect’s login status.</p>
  <a className="linkbutton" href="https://wiki.bambulab.com/en/software/bambu-connect" target="_blank" rel="noreferrer">Official login and LAN setup guide</a>
 </section>;
}
