import {useEffect,useId,useRef,useState} from 'react';
import {Palette,Printer,RefreshCw,X} from 'lucide-react';
import {recommendedSlot,snapshotFresh,type PrinterStatus} from '../domain/printer-status';
import './filament-picker.css';
async function request<T>(path:string,body?:unknown):Promise<T>{const response=await fetch('/api/printers'+path,{...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});const value=await response.json();if(!response.ok)throw Error(value.error??'Printer status unavailable');return value;}
export default function FilamentPicker({jobId,color,materialType,printerModel,onColor,disabled=false,allowAutomatic=true}:{jobId:string;color:string;materialType:string;printerModel:string;onColor:(color:string)=>void;disabled?:boolean;allowAutomatic?:boolean}){
 const id=useId(),[status,setStatus]=useState<PrinterStatus>(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[pairOpen,setPairOpen]=useState(false),[choice,setChoice]=useState('manual');
 const [host,setHost]=useState(''),[serial,setSerial]=useState(''),[code,setCode]=useState(''),[name,setName]=useState('Team printer'),[model,setModel]=useState<'X1'|'X2D'>('X1'),[fingerprint,setFingerprint]=useState(''),[trusted,setTrusted]=useState(false);
 const live=useRef(onColor);live.current=onColor;const manual=useRef(false),automatic=useRef<{jobId:string;color:string}|undefined>(undefined),lock=useRef(false),mounted=useRef(true);
 const fresh=snapshotFresh(status?.snapshot)&&!status?.error;
 const compatible=!!status?.connection&&printerModel.includes(status.connection.model);
 async function action<T>(work:()=>Promise<T>,apply:(value:T)=>void){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{const value=await work();if(mounted.current)apply(value);}catch(e){if(mounted.current)setError((e as Error).message);}finally{lock.current=false;if(mounted.current)setBusy(false);}}
 async function refresh(){return request<PrinterStatus>('/refresh',{});}
 useEffect(()=>{mounted.current=true;let cancelled=false;void request<PrinterStatus>('').then(async initial=>{if(cancelled)return;setStatus(initial);if(initial.connection){const next=await refresh();if(!cancelled)setStatus(next);}}).catch(e=>{if(!cancelled)setError((e as Error).message);});
  const timer=setInterval(()=>{if(document.visibilityState==='visible'&&!lock.current)void request<PrinterStatus>('').then(value=>value.connection?refresh():value).then(value=>{if(!cancelled)setStatus(value);}).catch(()=>{});},60_000);
  return()=>{cancelled=true;mounted.current=false;clearInterval(timer);};
 },[]);
 useEffect(()=>{manual.current=false;automatic.current=undefined;setChoice('manual');},[jobId]);
 useEffect(()=>{
  if(disabled||!allowAutomatic||manual.current||!compatible||!fresh)return;const slot=recommendedSlot(status?.snapshot,materialType);if(!slot)return;
  const previous=automatic.current;if(color.toLowerCase()!=='#d9d9d9'&&!(previous?.jobId===jobId&&previous.color.toLowerCase()===color.toLowerCase()))return;
  automatic.current={jobId,color:slot.color};setChoice(slot.id);if(slot.color.toLowerCase()!==color.toLowerCase())live.current(slot.color);
 },[jobId,color,materialType,compatible,fresh,status?.snapshot?.at,disabled,allowAutomatic]);
 const selected=status?.snapshot?.slots.find(slot=>slot.id===choice);
 return <>
 <button className="btn ghost filament-trigger" popoverTarget={id} title="Filament color and printer connection"><span className="filament-swatch" style={{background:color}}/><span>{selected?.label??'Filament'}</span></button>
 <div id={id} popover="auto" className="filament-panel" aria-label="Filament and printer">
  <div className="drawer-heading"><strong>Filament</strong><button className="iconbtn" aria-label="Close filament" popoverTarget={id} popoverTargetAction="hide"><X size={16}/></button></div>
  <div className="filament-body">
   <label className="filament-manual"><Palette size={16}/><span>Choose a color</span><input type="color" disabled={disabled} aria-label="Filament preview color" value={/^#[a-f\d]{6}$/i.test(color)?color:'#d9d9d9'} onChange={event=>{manual.current=true;automatic.current=undefined;setChoice('manual');live.current(event.target.value);}}/></label>
   <p className="smalltext">{materialType} · The selected color is included in the sliced file. Confirm the physical spool when sending.</p>
   {status?.connection?<>
    <div className="filament-connection"><Printer size={15}/><strong>{status.connection.name}</strong><button className="iconbtn" disabled={busy} aria-label="Refresh AMS colors" onClick={()=>void action(refresh,setStatus)}><RefreshCw size={14}/></button></div>
    <p className="smalltext">{status.connection.model} · {status.connection.host} · {fresh?'AMS checked recently':'AMS status unavailable or stale'}</p>
    {status.error&&<p className="notice" role="status">{status.error} Choose a color manually or retry.</p>}
    {!compatible&&<p className="notice">The paired printer differs from this plate’s profile. Select a matching print profile before using AMS colors.</p>}
    <div className="filament-slots" role="group" aria-label="Reported AMS colors">{status.snapshot?.slots.map(slot=><button key={slot.id} className={choice===slot.id?'selected':''} aria-pressed={choice===slot.id} disabled={disabled||!fresh||!compatible||slot.type.toUpperCase()!==materialType.toUpperCase()} title={slot.type.toUpperCase()!==materialType.toUpperCase()?'Select a matching material profile first':slot.colors.length>1?'Multicolor spool; preview uses the first reported color':slot.color} onClick={()=>{if(!snapshotFresh(status?.snapshot)||status?.error){setError('AMS status is stale. Refresh before choosing a slot.');return;}manual.current=false;automatic.current={jobId,color:slot.color};setChoice(slot.id);if(color!==slot.color)live.current(slot.color);}}><span className="filament-swatch" style={{background:slot.colors.length>1?`linear-gradient(90deg,${slot.colors.join(',')})`:slot.color}}/><span>{slot.label}<small>{slot.type}{slot.active?' · active':''}</small></span></button>)}</div>
    {fresh&&!status.snapshot?.slots.length&&<p className="smalltext">No readable AMS spools reported. Use the manual color above.</p>}
    <p className="smalltext">AMS choice sets the preview and file color. Verify the tray mapping in Bambu Connect before Print.</p>
    <button className="linkbutton" disabled={busy} onClick={()=>void action(()=>request<PrinterStatus>('/disconnect',{}),next=>{setStatus(next);setChoice('manual');automatic.current=undefined;})}>Forget this pairing</button>
   </>:<p className="smalltext">No printer paired. You can prepare and choose a color without one.</p>}
   <button className="btn" disabled={!status?.available} onClick={()=>setPairOpen(value=>!value)}><Printer size={14}/>{status?.connection?'Pair another printer':'Connect printer for AMS colors'}</button>
   {!status?.available&&<p className="smalltext">Encrypted printer pairing is available in the Windows desktop app.</p>}
   {pairOpen&&<form className="filament-pairing" onSubmit={event=>{event.preventDefault();void action(()=>request<PrinterStatus>('/connect',{host,serial,accessCode:code,name,model,fingerprint,trustCertificate:trusted}),value=>{setStatus(value);setCode('');setPairOpen(false);manual.current=false;});}}>
    <label className="field">Name<input value={name} maxLength={80} onChange={event=>setName(event.target.value)}/></label>
    <label className="field">Model<select value={model} onChange={event=>setModel(event.target.value as 'X1'|'X2D')}><option value="X1">X1 family</option><option value="X2D">X2D</option></select></label>
    <label className="field">Printer IP<input value={host} placeholder="192.168.1.50" autoComplete="off" onChange={event=>{setHost(event.target.value.trim());setFingerprint('');setTrusted(false);}} required/></label>
    <label className="field">Serial number<input value={serial} autoComplete="off" onChange={event=>setSerial(event.target.value.trim())} required/></label>
    <label className="field">LAN access code<input type="password" value={code} minLength={8} maxLength={8} autoComplete="off" onChange={event=>setCode(event.target.value)} required/></label>
    <p className="smalltext">Read the IP, serial and access code from your printer. Foundry reads status only; it does not change printer settings.</p>
    {!fingerprint?<button type="button" className="btn" disabled={busy||!host} onClick={()=>void action(()=>request<{fingerprint:string}>('/probe',{host}),value=>setFingerprint(value.fingerprint))}>Check printer certificate</button>:<><code className="filament-fingerprint">{fingerprint}</code><label className="checkline"><input type="checkbox" checked={trusted} onChange={event=>setTrusted(event.target.checked)}/>I checked the printer address and serial. Trust this certificate for this pairing.</label><button className="btn primary" disabled={busy||!trusted}>Read AMS & save pairing</button></>}
   </form>}
   {error&&<p className="inline-error" role="alert">{error}</p>}
   <details><summary>Bambu cloud</summary><p className="smalltext">Cloud printer login and tray mapping stay in Bambu Connect. Connect’s import handoff does not expose AMS colors to Foundry; use a manual color here, or pair a reachable LAN status endpoint. Firmware may limit local status access; Foundry does not change security settings.</p></details>
  </div>
 </div></>;
}


