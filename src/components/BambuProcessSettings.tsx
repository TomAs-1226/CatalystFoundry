import {useEffect,useState} from 'react';
import {ChevronRight} from 'lucide-react';
import type {ProcessSettings} from '../domain/model';
import {bambuOptions,bambuOptionsVersion,displayNativeValue,nativeAliases,processSettingKey} from '../domain/bambu-settings';
import './bambu-process-settings.css';
export default function BambuProcessSettings({settings,baseSettings,profileKey,onChange,disabled=false}:{settings:ProcessSettings;baseSettings:ProcessSettings;profileKey?:string;onChange:(key:string,value:number|string|boolean|undefined)=>void;disabled?:boolean}){
  const [query,setQuery]=useState(''),[base,setBase]=useState<Record<string,unknown>>({}),[error,setError]=useState('');
  useEffect(()=>{const controller=new AbortController();void fetch('/api/slicing/process-options',{signal:controller.signal}).then(async response=>{const value=await response.json();if(!response.ok)throw Error(value.error??'Choose a printer profile first.');setBase(value.base);setError('');}).catch(error=>{if(!controller.signal.aborted)setError(error.message);});return()=>controller.abort();},[profileKey]);
  const groups=['Quality','Strength','Speed','Support','Other'],search=query.trim().toLowerCase();
  return <div className="bambu-process-settings">
    <p className="smalltext">{bambuOptionsVersion} · {bambuOptions.length} process controls. Machine and filament profiles stay selected separately.</p>
    <label className="field">Find a setting<input type="search" placeholder="Walls, infill, support, brim…" value={query} onChange={event=>setQuery(event.target.value)} aria-label="Find Bambu setting"/></label>
    {error&&<p className="smalltext" role="status">{error} Unspecified values use native defaults.</p>}
    {groups.map(group=>{const fields=bambuOptions.filter(field=>(['Quality','Strength','Speed','Support'].includes(field.category)?field.category:'Other')===group&&(!search||`${field.label} ${field.key} ${field.description}`.toLowerCase().includes(search)));if(!fields.length)return null;
      return <details key={group+':'+!!search} open={!!search} className="bambu-setting-group"><summary><ChevronRight size={14} aria-hidden="true"/><strong>{group}</strong><span>{fields.length}</span></summary><div>{fields.map(field=>{
        const key=processSettingKey(field),value=displayNativeValue(field,settings,base),raw=value===undefined?'':String(value).replace(/%$/,''),override=settings[key]!==undefined&&(key.startsWith('bambu.')||settings[key]!==baseSettings[key]),boolean=/^coBools?$/.test(field.type),percentage=/OrPercent/.test(field.type),options=field.type==='coEnum'?field.options:undefined,label=/^overhang_\d_4_speed$/.test(field.key)?`Overhang speed · ${field.label}`:field.label;
        const change=(text:string)=>onChange(key,text===''?(nativeAliases[field.key]?baseSettings[key]:undefined):boolean?text==='1':options||percentage?text:Number(text));
        return <label className="bambu-setting-field" key={field.key} title={field.description}><span>{label}{field.unit&&<small>{field.unit}</small>}</span>
          <div>{options?<select disabled={disabled} aria-label={`${label} (${field.key})`} value={String(value??'')} onChange={event=>change(event.target.value)}><option value="">Native default</option>{options.map((option,index)=><option key={option} value={option}>{field.optionLabels?.[index]??option}</option>)}</select>
          :boolean?<select disabled={disabled} aria-label={`${label} (${field.key})`} value={value===undefined?'':value===true||value==='1'?'1':'0'} onChange={event=>change(event.target.value)}><option value="">Native default</option><option value="1">On</option><option value="0">Off</option></select>
          :<input disabled={disabled} aria-label={`${label} (${field.key})`} type={percentage?'text':'number'} inputMode="decimal" step={/^coInts?$/.test(field.type)?1:'any'} min={field.key==='wall_loops'?1:field.min} max={field.key==='wall_loops'?20:field.key==='brim_width'?50:field.max} placeholder="Native default" value={percentage?String(value??''):raw} onChange={event=>change(event.target.value)}/>}
          {override&&<button type="button" className="linkbutton" disabled={disabled} aria-label={`Reset ${label}`} onClick={event=>{event.preventDefault();onChange(key,nativeAliases[field.key]?baseSettings[key]:undefined);}}>Reset</button>}</div>
        </label>;
      })}</div></details>;
    })}
    {search&&!bambuOptions.some(f=>`${f.label} ${f.key} ${f.description}`.toLowerCase().includes(search))&&<p className="smalltext">No matching setting.</p>}
    <p className="smalltext">Native defaults are inherited from the selected profile. Advanced edits replace those values and require a new slice. Per-object painting, multi-filament assignments and custom scripts are not edited here.</p>
  </div>;
}
