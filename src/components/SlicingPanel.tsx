import { useEffect, useMemo, useRef, useState,useId } from 'react';
import { Layers3, LoaderCircle, RefreshCw, Download,Settings2,X } from 'lucide-react';
import type { Job, Project } from '../domain/model';
import { fingerprint } from '../domain/invariants';
import { preflightIssues, type PreflightIssue } from '../domain/preparation';
import {
  cancelSliceJob, getSlicingSetup, getBundledSlicing, selectBundledSlicing,
  prepareLiveSlice, queueLiveSlice, resolveSlicingProfile,
  type BundledSlicing, type ConfiguredSlicingProfile, type SliceJob,type SlicingSetup,
} from '../adapters/slicing';
import { prepareConfirmedSlice } from './slice-preparation';
import { shouldAutoSlice, sliceActive } from './slice-monitor';
import PrintHandoffPanel from './PrintHandoffPanel';
import { download } from './ui';
import './slicing-panel.css';

interface Props {
  project: Project;
  job: Job;
  slice?:SliceJob;
  sessionMessage:string;
  onSlice:(slice:SliceJob)=>Promise<void>;
  onDeliver:()=>Promise<void>;
  onUseProfile: (profile: ConfiguredSlicingProfile) => Project | false;
  onPrepare: (arrange: boolean,orient?:boolean) => Promise<Project>;
  getCurrent: () => {project:Project;job:Job};
  onSupportStyle: (style: string) => void;
  onSetting:(key:string,value:number|string|boolean|undefined)=>void;
  supportReason?: string;
  onInspect: () => void;
  onFix: (issue: PreflightIssue) => void;
  onError: (error: unknown) => void;
  onActivityChange?:(active:boolean)=>void;
}

/** Kept mounted across plate/paths. Service jobs continue independently of navigation. */
export default function SlicingPanel(props: Props) {
  const { project, job } = props;
  const [setup, setSetup] = useState<SlicingSetup>();
  const [bundled, setBundled] = useState<BundledSlicing>();
  const [profileId, setProfileId] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [setupError, setSetupError] = useState('');
  const {slice}=props;const setSlice=props.onSlice;
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [hash, setHash] = useState('');
  const [autoUpdate, setAutoUpdate] = useState(false);
  const [profileOpen, setProfileOpen] = useState(true);
  const [autoArrange,setAutoArrange]=useState(true);
  const [autoOrient,setAutoOrient]=useState(true);
  const drawer=useRef<HTMLDivElement>(null),drawerId=useId();
  const openSettings=()=>drawer.current?.showPopover();
  const lock = useRef(false);
  const attempted = useRef<string | undefined>(undefined);
  const live = useRef(props); live.current = props;
  const mounted = useRef(true);
  const running = sliceActive(slice);
  useEffect(()=>{props.onActivityChange?.(working||running);},[working,running,props.onActivityChange]);
  useEffect(()=>()=>props.onActivityChange?.(false),[props.onActivityChange]);
  const current = !!hash && hash === slice?.manifestHash;
  const blockers = useMemo(() => preflightIssues(project, job).filter(issue => issue.page === 'prepare' && issue.severity === 'error'), [project, job]);

  useEffect(()=>{if(!lock.current){setReviewed(false);setProfileOpen(true);}},[JSON.stringify(job.printer),JSON.stringify(job.material)]);
  async function refreshSetup() {
    try {
      const [next, bundle] = await Promise.all([getSlicingSetup(), getBundledSlicing()]);
      if (!mounted.current) return;
      setSetup(next); setBundled(bundle); setSetupError('');
      setProfileOpen(!bundle.selectedProfileId&&!next.configured);
      setProfileId(previous=>previous||bundle.selectedProfileId||(next.configured?'external':''));
      // A new plate starts with the saved mapping; the per-plate printer check
      // remains unchecked. This also gives AMS color defaults a real material.
      const current=live.current.getCurrent();
      if(next.configured&&current.job.slicer.id==='external-import'){
        const profile=await resolveSlicingProfile(current.job.settings,undefined,current.job.material.color);
        if(mounted.current&&live.current.getCurrent().job.id===current.job.id&&live.current.getCurrent().job.slicer.id==='external-import')live.current.onUseProfile(profile);
      }
    } catch (error) {
      if (mounted.current) setSetupError(`Cannot reach the local slicer: ${(error as Error).message}. Recheck setup or restart Foundry.`);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void refreshSetup();
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    let ignore = false;
    setHash('');
    void fingerprint(project, job).then(value => { if (!ignore) setHash(value); })
      .catch(() => { if (!ignore) setHash(''); });
    return () => { ignore = true; };
  }, [project, job]);
  async function start(automatic = false) {
    if (lock.current || running) return;
    lock.current = true; setWorking(true); setConnectionError('');
    if (!automatic) setAutoUpdate(true);
    setMessage('Preparing plate geometry and printer settings…');
    try {
      const targetId=live.current.getCurrent().job.id;
      const ensureCurrent=()=>{if(!mounted.current||live.current.getCurrent().job.id!==targetId)throw new Error('The active plate changed. Slice the selected plate again.');};
      if(!reviewed)throw new Error('Confirm printer, nozzle, plate and material before slicing.');
      let chosen=bundled?.profiles.find(profile=>profile.id===profileId);
      if(profileId==='external'){
        const external=await resolveSlicingProfile(live.current.getCurrent().job.settings,undefined,live.current.getCurrent().job.material.color);ensureCurrent();
        chosen={id:'external',label:external.profileLabel,printer:external.printer,material:external.material};
      }
      if(!chosen)throw new Error('Choose a printer and material profile.');
      attempted.current=await fingerprint(live.current.getCurrent().project,live.current.getCurrent().job);
      if(profileId!=='external'&&bundled?.selectedProfileId!==profileId){
        setMessage('Checking the selected printer and material files…');
        await selectBundledSlicing(profileId,true);ensureCurrent();
        setBundled(previous=>previous?{...previous,selectedProfileId:profileId}:previous);
        setSetup(await getSlicingSetup());ensureCurrent();
      }
      const queued=await prepareConfirmedSlice({confirmed:reviewed,selection:chosen,targetId,arrange:autoArrange,attemptKey:`foundry-${crypto.randomUUID()}`,
        current:()=>live.current.getCurrent(),checkActive:ensureCurrent,apply:profile=>live.current.onUseProfile(profile),
        preparePlate:arrange=>live.current.onPrepare(arrange,autoOrient),resolveProfile:settings=>resolveSlicingProfile(settings,undefined,live.current.getCurrent().job.material.color),prepare:prepareLiveSlice,queue:queueLiveSlice,
        stage:setMessage,manifest:value=>{attempted.current=value;}});
      if (mounted.current && live.current.job.id === targetId) {
        await setSlice(queued); setProfileOpen(false); setMessage('Slicing on this laptop. Layers attach automatically when ready.');
      }
    } catch (error) {
      if (mounted.current) { setMessage(`Slicing stopped: ${(error as Error).message} Retry Slice plate after correcting it.`); attempted.current=await fingerprint(live.current.getCurrent().project,live.current.getCurrent().job).catch(()=>attempted.current); if (!automatic) live.current.onError(error); }
    } finally { lock.current = false; if (mounted.current) setWorking(false); }
  }
  const unresolved=blockers.filter(issue=>!autoArrange||!/^fit-|^overlap-|^position-/.test(issue.id));
  const ready=(!!bundled?.installed||!!setup?.configured)&&!!profileId&&reviewed&&unresolved.length===0;
  useEffect(() => {
    if (!shouldAutoSlice(autoUpdate, hash, attempted.current, working, running, ready)) return;
    const timer = setTimeout(() => { void start(true); }, 1000);
    return () => clearTimeout(timer);
  }, [autoUpdate, hash, working, running, ready, autoArrange,autoOrient]);

  async function showResult(result: SliceJob) {
    if (lock.current || !result.result) return;
    lock.current = true; setWorking(true);
    try {
      if(!mounted.current)return;
      await live.current.onDeliver();
      if (mounted.current) setMessage(result.result.previewSupported === false
        ? 'Layers are an incomplete preview. Finish command review in Bambu Connect; Foundry approval is blocked.'
        : 'Layers updated. Inspect them before approval.');
    } catch (error) { if (mounted.current) { setMessage((error as Error).message); live.current.onError(error); } }
    finally { lock.current = false; if (mounted.current) setWorking(false); }
  }
  async function cancel() {
    if (!slice) return;
    setAutoUpdate(false);
    try {
      const cancelled = await cancelSliceJob(slice.id);
      if (mounted.current) { setSlice(cancelled); setMessage('Slicing cancelled. Use Slice plate to try again.'); }
    } catch (error) { if (mounted.current) live.current.onError(error); }
  }
  function nativeProject() {
    const artifact = slice?.result?.slicerProject;
    if (artifact) download(Uint8Array.from(atob(artifact.data), c => c.charCodeAt(0)).buffer, artifact.name, 'model/3mf');
  }
  const selected=bundled?.profiles.find(profile=>profile.id===profileId);
  return <section className="slice-workflow" aria-label="Local Bambu slicing">
    <div className="slice-workflow__bar">
      <button className="slice-workflow__printer" title={selected?`${selected.label} · ${selected.printer.nozzleDiameter} mm · ${selected.printer.plate}`:setup?.profileLabel} onClick={()=>{setProfileOpen(true);openSettings();}}>
        <strong>{selected?.label||setup?.profileLabel||'Choose printer & material'}</strong><span>{selected?`${selected.printer.nozzleDiameter} mm · ${selected.printer.plate}`:'Bambu Studio included'}</span>
      </button>
      <button className="btn" popoverTarget={drawerId}><Settings2 size={14}/>Settings</button>
      <label className="checkline" title="Confirm the printer, nozzle, plate and filament shown here"><input type="checkbox" checked={reviewed} disabled={working||running} onChange={event=>setReviewed(event.target.checked)}/>Printer checked</label>
      {running?<button className="btn" onClick={cancel}>Cancel</button>:<button className="btn primary" disabled={working||!ready} onClick={()=>{props.onInspect();void start();}}>{working?<LoaderCircle size={14} className="spin"/>:<Layers3 size={14}/>}Slice plate</button>}
      {slice?.status==='succeeded'&&<button className="btn" disabled={!current||working} onClick={()=>{props.onInspect();void showResult(slice);}}>Show layers</button>}
      {slice?.status==='succeeded'&&slice.result?.slicerProject&&<button className="btn" onClick={openSettings}>Review & send</button>}
    </div>
    {(working||running)&&<progress value={slice&&running?slice.progress:undefined} max={100} aria-label="Slicing progress"/>}
    <div className="slice-workflow__status" role="status">
      <span>{connectionError||setupError||slice?.error||props.sessionMessage||message||(!reviewed?'Check the printer mapping, then Slice plate.':autoArrange?'Ready · automatic preparation on':'Ready · manual placement')}</span>
      {unresolved.length>0&&<button className="linkbutton" onClick={openSettings}>{unresolved.length} checks</button>}
      {slice&&!current&&hash&&<span className="inline-error">Outdated result · {autoUpdate?'waiting to update':'slice again'}</span>}
    </div>
    <div ref={drawer} id={drawerId} popover="auto" className="slice-settings-drawer" role="dialog" aria-label="Slicing settings">
      <div className="drawer-heading"><strong>Slicing settings</strong><button className="iconbtn" aria-label="Close slicing settings" popoverTarget={drawerId} popoverTargetAction="hide"><X size={16}/></button></div>
      <div className="slice-settings-body">
        <details open={profileOpen} onToggle={event=>setProfileOpen(event.currentTarget.open)}><summary>Printer & material</summary>
          <label className="field">Profile<select aria-label="Bundled printer and material" value={profileId} disabled={working||running} onChange={event=>{setProfileId(event.target.value);setReviewed(false);}}><option value="">Choose a profile…</option>{setup?.configured&&<option value="external">Configured · {setup.profileLabel}</option>}{bundled?.profiles.map(profile=><option key={profile.id} value={profile.id}>{profile.label}</option>)}</select></label>
          <p className="smalltext">{selected?`${selected.printer.nozzleDiameter} mm nozzle · ${selected.printer.plate}`:setup?.profileLabel}. Last-used profile is remembered; confirm it for each plate.</p>
        </details>
        <label className="field">Supports<select aria-label="Support style" disabled={working||running} value={!job.settings.supports?'off':job.settings['bambu.support_type']!==undefined?'native':job.settings.supportStyle??'normal'} onChange={event=>props.onSupportStyle(event.target.value)}>{job.settings['bambu.support_type']!==undefined&&<option value="native">Advanced native override</option>}<option value="auto">Automatic recommendation</option><option value="tree">Tree</option><option value="normal">Normal</option><option value="off">Off</option></select></label>
        {props.supportReason&&<p className="smalltext">{props.supportReason}</p>}
        <label className="checkline"><input type="checkbox" checked={autoArrange} disabled={working||running} onChange={event=>setAutoArrange(event.target.checked)}/>Arrange before slicing</label>
        <label className="checkline"><input type="checkbox" checked={autoOrient} disabled={working||running||!autoArrange} onChange={event=>setAutoOrient(event.target.checked)}/>Lay flat automatic parts</label>
        <label className="checkline"><input type="checkbox" checked={job.settings.infillMode!=='manual'} disabled={working||running} onChange={event=>props.onSetting('infillMode',event.target.checked?'auto':'manual')}/>Smart infill pattern · keep my density and walls</label>
        <p className="smalltext">Auto prepare chooses the pattern. Choosing a specific infill pattern in Advanced switches to manual.</p>
        <p className="smalltext">Manual rotations and picked faces stay fixed. Inspect orientation and supports for the part's use.</p>
        <button className="btn" disabled={working||running||!job.items.length} onClick={()=>{void props.onPrepare(true,autoOrient).catch(props.onError);}}>Prepare plate now</button>
        <label className="checkline"><input type="checkbox" checked={autoUpdate} onChange={event=>setAutoUpdate(event.target.checked)}/>Update after edits</label>
        <button className="btn" onClick={()=>{drawer.current?.hidePopover();props.onFix({id:'slice-settings',severity:'warning',message:'Edit print settings',detail:'',field:'Layer height',page:'prepare'});}}>Advanced Bambu settings</button>
        {unresolved.length>0&&<div className="slice-workflow__checks"><strong>Before slicing</strong>{unresolved.map(issue=><button key={issue.id} className="linkbutton" onClick={()=>{drawer.current?.hidePopover();props.onFix(issue);}}>{issue.message} <span>Fix</span></button>)}</div>}
        {setup&&!setup.capability.available&&<p className="inline-error">{setup.capability.reason}</p>}
        {slice?.status==='succeeded'&&slice.result?.slicerProject&&<details open className="slice-workflow__details"><summary>Review & send in Bambu Connect</summary><PrintHandoffPanel project={project} job={job} slice={slice} current={current} onError={props.onError}/></details>}
        <details className="slice-workflow__details"><summary>Advanced & downloads</summary>
          <p className="smalltext">Bambu Studio {bundled?.version??setup?.capability.version} slices offline. Machine profiles need team qualification; X2D uses one filament and its primary nozzle.</p>
          <button className="linkbutton" onClick={()=>void refreshSetup()}><RefreshCw size={12}/>Recheck setup</button>
          {setup&&<ol className="setup-steps">{setup.instructions.map((instruction,index)=><li key={index}>{instruction}</li>)}</ol>}
          {slice?.result?.previewSupported===false&&<div className="notice error">The geometry preview cannot validate all machine commands. Foundry approval stays blocked; review the native result.<ul>{slice.result.previewIssues?.map((issue,index)=><li key={index}>{issue}</li>)}</ul></div>}
          {slice?.result?.slicerProject&&<button className="btn" onClick={nativeProject}><Download size={13}/>Download native project</button>}
          {slice&&<details><summary>Slicer logs</summary><pre className="slicer-logs">{slice.logs.join('\n')}</pre></details>}
        </details>
      </div>
    </div>
  </section>;
}
