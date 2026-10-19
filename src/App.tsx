import {arrangePlate} from './domain/auto-prepare';
import {faceDownOrientation} from './domain/plate-orientation';
import {preparePlateWorker,layFlatWorker} from './components/prepare-plate-worker';
import PlateTools from './components/PlateTools';
import {addRobotDrafts} from './domain/robot-plan';
import type {RobotImportOptions} from './components/GuidedOnshapeIntake';
import SyncWorkspace,{type SyncClient} from "./components/SyncWorkspace";
import {localSyncRequest,getSyncStatus,connectLocal} from "./adapters/sync";
import "./components/sync-workspace.css";
import { workspaceGroups, workspaceCatalog } from "./domain/part-catalog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  Bell,
  Box,
  Boxes,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  ExternalLink,
  FileBox,
  FolderOpen,
  Hexagon,
  History,
  Layers3,
  Link,
  LoaderCircle,
  Plus,
  RotateCcw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Triangle,
  Unplug,
  Upload,
  X,
  AlertTriangle,
  PackageCheck,
  Printer,
  Trash2,
} from "lucide-react";
import {
  createProject,
  createJob,
  createId,
  defaultPrinter,
  type Job,
  type JobItem,
  type OperatorChecks,
  type Part,
  type PartCategory,
  type ProcessSettings,
  type Project,
  type Vec3,
} from "./domain/model";
import {
  approveJob,
  assignJob,
  attachToolpath,
  deserializeProject,
  exportJobPackage,
  fingerprint,
  fitWarnings,
  invalidateJob,
  invalidateChangedJobs,
  isApprovalCurrent,
  isToolpathCurrent,
  isFixtureJob,
  profileQualificationCurrent,
  qualifyProfile,
  manufacturingManifest,
  reviewToolpath,
  serializeProject,
  settingOverrides,
  stableStringify,
  operatorTransition,
  revokeToolpathMapping,
} from "./domain/index";
import {
  fixtureDefaultSelection,
  fixtureCatalog,
  importFixtureParts,
  comparePartRevisions,
  type RevisionChange,
} from "./adapters/onshape";
import { recoverProject } from "./adapters/project-recovery";
import { parseGcode, type ToolpathFeature } from "./adapters/toolpaths";
import StartupScreen from "./components/StartupScreen";
import FilamentPicker from './components/FilamentPicker';
import {waitForStartupPresentation} from "./components/startup-design";
import WorkspaceViewer from "./components/WorkspaceViewer";
import BambuProcessSettings from './components/BambuProcessSettings';
import SourceDialog from "./components/SourceDialog";
import SharedCadIntake from "./components/SharedCadIntake";
import ManufacturingQueue from "./components/ManufacturingQueue";
import SlicingPanel from "./components/SlicingPanel";
import {useSliceSession} from './components/use-slice-session';
import PrintHandoffPanel from './components/PrintHandoffPanel';
import BambuConnectSetup from './components/BambuConnectSetup';
import { useToolpathPreview } from "./components/use-toolpath-preview";
import {useWorkspaceSnapshot} from './components/use-workspace-snapshot';
import {useProjectAutosave} from './components/use-project-autosave';
import {AppUpdates} from './components/AppUpdates';
import type { SliceJob } from "./adapters/slicing";
import {
  PreparationAssistant,
  PreflightPanel,
} from "./components/PreparationPanels";
import {
  preflightIssues,
  preparationStatus,
  quantityReconciliation,
  recommendedProfile,
  type PreflightIssue,
} from "./domain/preparation";
import {
  Field,
  Modal,
  PartThumbnail,
  download,
  formatDate,
  shortHash,
} from "./components/ui";

type Page = "sync" |
  "source" | "prepare" | "toolpaths" | "review" | "export" | "queue" | "help";
const categoryLabels: Record<PartCategory, string> = {
  bracket: "Functional bracket",
  enclosure: "Electronics enclosure",
  spacer: "Precision spacer",
  pulley: "Pulley or roller",
  custom: "Custom component",
};
const checksLabels: Record<keyof OperatorChecks, string> = {
  machine: "Selected machine matches the package",
  material: "Loaded material matches the mapping",
  nozzle: "Installed nozzle matches the profile",
  plate: "Build plate matches the profile",
  clearBed: "Bed is clear and ready",
};
const blankChecks: OperatorChecks = {
  machine: false,
  material: false,
  nozzle: false,
  plate: false,
  clearBed: false,
};
const features: ToolpathFeature[] = [
  "wall",
  "infill",
  "support",
  "travel",
  "other",
];
const featureColors: Record<ToolpathFeature, string> = {
  wall: "#e94560",
  infill: "#b5a1e0",
  support: "#76c8b3",
  travel: "#7f8a9e",
  other: "#dfc787",
};

const desktopSyncClient:SyncClient={request:localSyncRequest,status:getSyncStatus,connect:connectLocal,logout:()=>localSyncRequest("/logout","POST",{})};
export default function App() {
  const [project, setProject] = useState<Project>(() =>
    createProject("New manufacturing project"),
  );
  const [initializing, setInitializing] = useState(true);
  const [slicingWorking,setSlicingWorking]=useState(false);
  const [startupWorkspaceReady,setStartupWorkspaceReady]=useState(false);
  const startupPresentedAt=useRef(performance.now());
  const desktopStartupComplete=new URLSearchParams(window.location.search).get('desktop-startup')==='complete';
  const [page, setPage] = useState<Page>("source");
  const [inspectorTab, setInspectorTab] = useState<
    "part" | "process" | "checks"
  >("part");
  const [mobilePane, setMobilePane] = useState<"viewport" | "inspector">(
    "viewport",
  );
  const [partsOpen, setPartsOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const showInspector = (tab: "part" | "process" | "checks") => {
    setPartsOpen(false);
    setInspectorTab(tab);
    setInspectorOpen(true);
    setMobilePane("inspector");
  };
  const [focusTarget, setFocusTarget] = useState("");
  const [presetName, setPresetName] = useState("Team · functional PETG");
  const [presetOpen, setPresetOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [revokeReason, setRevokeReason] = useState("");

  const [sourceOpen, setSourceOpen] = useState(false);
  const [sourceInitialUrl,setSourceInitialUrl]=useState('');
  const [robotLink,setRobotLink]=useState('');
  const [sourceInitialTab, setSourceInitialTab] = useState<
    "shared" | "onshape" | "local" | "fixtures"
  >("shared");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [connectionState, setConnectionState] = useState<{
    onshape?: { available: boolean; reason?: string };
    slicing?: { available: boolean; reason?: string };
  }>({});
  const [guideOpen, setGuideOpen] = useState(false);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [catalogGroup, setCatalogGroup] = useState("");
  const [query, setQuery] = useState("");
  useEffect(()=>setCatalogGroup(''),[project.id]);
  const [viewMode, setViewMode] = useState<"parts" | "plate">("plate");
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saveState, setSaveState] = useState("Not saved");
  const [layer, setLayer] = useState(0);
  const [placementTool,setPlacementTool]=useState<'orbit'|'move'|'face'>('orbit');
  const [pathColorMode,setPathColorMode]=useState<'filament'|'feature'>('filament');
  const [visibleFeatures, setVisibleFeatures] =
    useState<ToolpathFeature[]>(features.filter(feature=>feature!=='travel'));
  const [installed, setInstalled] = useState(false);
  const [toolpathOpen, setToolpathOpen] = useState(false);
  const [connectSetupOpen,setConnectSetupOpen]=useState(false);
  const [updatesOpen,setUpdatesOpen]=useState(false);
  const [updateReady,setUpdateReady]=useState(false);
  const [restarting,setRestarting]=useState(false);
  useEffect(()=>{let live=true;const refresh=()=>void fetch('/api/desktop/updates').then(r=>r.json()).then(status=>{if(live)setUpdateReady(status.phase==='ready');}).catch(()=>{});refresh();const timer=setInterval(refresh,30_000);return()=>{live=false;clearInterval(timer);};},[]);
  const [supportAdvice,setSupportAdvice]=useState<{jobId:string;reason:string}>();
  const [generatedPreview, setGeneratedPreview] = useState<{projectId:string;jobId:string;slice:SliceJob}>();
  const [pendingGcode, setPendingGcode] = useState<{
    name: string;
    gcode: string;
    fixture: boolean;
  }>();
  const [mappingConfirmed, setMappingConfirmed] = useState(false);
  const [externalSlicer, setExternalSlicer] = useState("");
  const [externalVersion, setExternalVersion] = useState("");
  const [actor, setActor] = useState("");
  const [reviewConfirm, setReviewConfirm] = useState(false);
  const [manifestConfirm, setManifestConfirm] = useState(false);
  const [setupConfirm,setSetupConfirm]=useState(false);
  const [checks, setChecks] = useState<OperatorChecks>(blankChecks);
  const [assignee, setAssignee] = useState("");
  const [capability, setCapability] = useState("Checking slicing service…");
  const [manifestHash, setManifestHash] = useState("");
  const [proposedRevision, setProposedRevision] = useState<Part[]>([]);
  const [revisionChanges, setRevisionChanges] = useState<RevisionChange[]>([]);
  const [revisionLoading, setRevisionLoading] = useState(false);
  const [revisionError, setRevisionError] = useState("");
  const projectRef = useRef(project);
  projectRef.current = project;
  const projectFile = useRef<HTMLInputElement>(null);
  const toolpathFile = useRef<HTMLInputElement>(null);
  const actionLock = useRef(false);
  const boot = useRef(false);
  const job =
    project.jobs.find((j) => j.id === project.activeJobId) ?? project.jobs[0];
  const workspace=useWorkspaceSnapshot(project,!initializing);
  const autosave=useProjectAutosave(project,workspace.snapshot,!initializing);
  const approvalVerified=workspace.snapshot?.approvalCurrent===true;
  const toolpathVerified=workspace.snapshot?.toolpathCurrent===true;
  const saveAction=useRef(saveProject);saveAction.current=saveProject;
  useEffect(()=>{const save=(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();void saveAction.current();}};document.addEventListener('keydown',save);return()=>document.removeEventListener('keydown',save);},[]);
  const sliceSession=useSliceSession({project,job,manifestHash,busy,current:()=>{const p=projectRef.current;return{project:p,job:p.jobs.find(j=>j.id===p.activeJobId)!};},locked:()=>actionLock.current,attach:attachGeneratedSlice,preview:slice=>{const p=projectRef.current;setGeneratedPreview({projectId:p.id,jobId:p.activeJobId,slice});}});
  const slicingActive=slicingWorking||['slicing','waiting','attaching'].includes(sliceSession.phase);
  const approvalCurrent =
    approvalVerified &&
    !!job.approval &&
    !job.toolpath?.stale &&
    job.toolpath?.mappingConfirmed === true;
  const toolpathCurrent =
    toolpathVerified &&
    !!job.toolpath &&
    !job.toolpath.stale &&
    job.toolpath.mappingConfirmed === true;
  const jobParts = job.items
    .map((item) => project.parts.find((p) => p.id === item.partId))
    .filter((p): p is Part => !!p);
  const newerRevisionAvailable = jobParts.some(
    (p) =>
      p.source.kind === "fixture" &&
      p.source.versionId !== fixtureCatalog[0].newerVersion,
  );
  const selectedPart =
    project.parts.find((p) => p.id === selectedId) ?? project.parts[0];
  const selectedItem = job.items.find((i) => i.partId === selectedPart?.id);
  const generated = generatedPreview?.projectId === project.id && generatedPreview.jobId === job.id
    && generatedPreview.slice.manifestHash === manifestHash ? generatedPreview.slice : undefined;
  const previewSource = generated?.result?.gcode ?? job.toolpath?.gcode;
  const previewState = useToolpathPreview(`${project.id}:${job.id}:${generated?.id ?? job.toolpath?.hash ?? ''}`, previewSource,!!generated||job.toolpath?.source==='bambu');
  const parsed = previewState.preview;
  const pendingPreviewState = useToolpathPreview(`import:${pendingGcode?.name ?? ''}`, pendingGcode?.gcode);
  const pendingPreview = pendingPreviewState.preview;
  const warnings = useMemo(() => fitWarnings(project, job), [project]);
  const overrides = settingOverrides(job);
  const issues = useMemo(
    () => preflightIssues(project, job, { toolpathCurrent, approvalCurrent }),
    [project, job, toolpathCurrent, approvalCurrent],
  );
  const reconciledQuantities = useMemo(
    () => quantityReconciliation(project, job),
    [project, job],
  );
  const profileAdvice = selectedPart
    ? recommendedProfile(selectedPart, job)
    : undefined;
  const issueErrors = issues.filter((i) => i.severity === "error");
  const stepErrors = page === "prepare" ? issueErrors.filter(issue => issue.page === "prepare") : issueErrors;
  const blockingApprovalIssues = issueErrors.filter(
    (i) => i.id !== "toolpath-review",
  );
  function jumpToIssue(issue: PreflightIssue) {
    setPage(issue.page);
    setInspectorOpen(true);
    setPartsOpen(false);
    if (
      issue.field &&
      /Rotate|Position|orientation|position/i.test(issue.field)
    )
      setManualOpen(true);
    if (
      issue.field &&
      /Layer|Wall|Infill|Support|Brim|speed/i.test(issue.field)
    )
      setAdvancedOpen(true);
    if (issue.partId) setSelectedId(issue.partId);
    setMobilePane("inspector");
    const processFields = [
      "Printer profile",
      "Nozzle",
      "Filament",
      "Layer height",
      "Wall loops",
      "Infill",
      "Supports",
      "Brim width",
      "Print speed",
    ];
    setInspectorTab(processFields.includes(issue.field) ? "process" : "part");
    if (issue.field === "Add CAD parts") setSourceOpen(true);
    if (
      [
        "Intended use",
        "Load directions",
        "Critical constraints",
        "Operating conditions",
      ].includes(issue.field)
    )
      setGuideOpen(true);
    setFocusTarget(
      issue.field === "Classification"
        ? "Part classification"
        : issue.field === "Add CAD parts"
          ? "Immutable version"
          : issue.field,
    );
  }
  useEffect(() => {
    if (!focusTarget) return;
    const t = setTimeout(() => {
      const controls = Array.from(
        document.querySelectorAll<HTMLElement>("input,select,textarea,button"),
      );
      const input =
        controls.find((el) => el.getAttribute("aria-label") === focusTarget) ||
        controls.find((el) => el.textContent?.trim() === focusTarget);
      let ancestor = input?.parentElement;
      while (ancestor) {
        if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
        ancestor = ancestor.parentElement;
      }
      input?.focus();
      input?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      setFocusTarget("");
    }, 100);
    return () => clearTimeout(t);
  }, [focusTarget, page, inspectorTab, selectedId, sourceOpen, guideOpen]);
  const includedParts = workspaceCatalog(project.parts,query,catalogGroup);
  const total = job.items.reduce((s, i) => s + i.quantity + i.spareQuantity, 0);
  function notify(s: string) {
    setToast(s);
    setTimeout(() => setToast(""), 5000);
  }
  function fail(e: unknown) {
    setError(e instanceof Error ? e.message : String(e));
  }
  useEffect(() => {
    if (boot.current) return;
    boot.current = true;
    (async () => {
      try {
        let savedJson: string | null = null,
          draftJson: string | null = null,
          serviceError = "";
        try {
          draftJson = localStorage.getItem("catalyst-project");
        } catch {
          /* Workspace file persistence is available when browser storage is disabled. */
        }
        try {
          const res = await fetch("/api/project");
          const data = await res.json();
          if (!res.ok)
            throw new Error(data.error ?? "Saved project could not be opened.");
          if (data.project) savedJson = JSON.stringify(data.project);
        } catch (e) {
          serviceError = (e as Error).message;
        }
        const recovered = await recoverProject(savedJson, draftJson);
        if (recovered.project) {
          const p = recovered.project;
          setProject(p);
          setSelectedId(p.parts[0]?.id ?? "");
          setPage(p.parts.length ? "prepare" : "source");
          setSaveState(
            recovered.origin === "draft"
              ? "Recovered browser draft"
              : "Saved on this laptop",
          );
          if (serviceError)
            setError(
              `Local project service unavailable: ${serviceError}. Your validated browser draft was recovered; export a recovery copy or retry saving.`,
            );
          else if (recovered.warnings.length)
            setError(recovered.warnings.join(" "));
          return;
        }
        if (serviceError || recovered.warnings.length)
          throw new Error(
            [serviceError, ...recovered.warnings].filter(Boolean).join(" "),
          );
        setProject(createProject("New manufacturing project"));
        setPage("source");
        setSaveState("New project · not saved");
      } catch (e) {
        fail(e);
      } finally {
        setStartupWorkspaceReady(true);
        // Native handoff already completed the pour; never play it twice.
        const splash=document.querySelector<HTMLElement>('.foundry-startup');
        if(!desktopStartupComplete&&splash)await waitForStartupPresentation(splash,startupPresentedAt.current);
        setInitializing(false);
      }
    })();
    fetch("/api/capabilities")
      .then((r) => r.json())
      .then((c) => {
        setConnectionState(c);
        setCapability(
          c.slicing?.reason ??
            "Slicing unavailable: no tested profiles configured.",
        );
      })
      .catch(() =>
        setCapability(
          "Local slicing service disconnected. Start npm run dev to reconnect.",
        ),
      );
  }, []);
  useEffect(() => {
    let live = true;
    fingerprint(project,job)
      .then((h) => {
        if (live) {
          setManifestHash(h);
        }
      })
      .catch(() => {
        if (live) {
          setManifestHash("");
        }
      });
    return () => {
      live = false;
    };
  }, [project]);
  useEffect(() => {
    setLayer(Math.max(0, (parsed?.layers.length ?? 1) - 1));
    setReviewConfirm(false);
    setManifestConfirm(false);
    setSetupConfirm(false);
    setChecks(blankChecks);
  }, [
    parsed,
    job.id,
    job.toolpath?.id,
    job.toolpath?.hash,
    job.toolpath?.mappingConfirmed,
    job.toolpath?.stale,
    manifestHash,
  ]);
  useEffect(() => {
    if (!revisionOpen) return;
    const controller = new AbortController();
    setRevisionLoading(true);
    setRevisionError("");
    setProposedRevision([]);
    setRevisionChanges([]);
    const fixture = jobParts.find((p) => p.source.kind === "fixture");
    if (!fixture) {
      setRevisionLoading(false);
      return;
    }
    const selection = {
      ...fixtureDefaultSelection,
      elementId: fixture.source.elementId ?? fixtureDefaultSelection.elementId,
      configuration:
        fixture.source.configuration ?? fixtureDefaultSelection.configuration,
      versionId: fixtureCatalog[0].newerVersion,
    };
    importFixtureParts(selection, { signal: controller.signal, delayMs: 0 })
      .then((parts) => {
        setProposedRevision(parts);
        setRevisionChanges(
          comparePartRevisions(
            jobParts.filter((p) => p.source.kind === "fixture"),
            parts,
          ),
        );
      })
      .catch((e) => {
        if (!controller.signal.aborted) setRevisionError((e as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setRevisionLoading(false);
      });
    return () => controller.abort();
  }, [revisionOpen]);
  const mutate = useCallback(
    (action: (p: Project, j: Job) => void, reason?: string) => {
      if (actionLock.current) return false;
      try {
        const next = structuredClone(projectRef.current);
        const j = next.jobs.find((v) => v.id === next.activeJobId)!;
        action(next, j);
        const changed = invalidateChangedJobs(projectRef.current, next, reason);
        if (reason && !changed.includes(j.id)) invalidateJob(j, reason);
        for (const batch of next.jobs)
          batch.status = preparationStatus(next, batch);
        next.updatedAt = new Date().toISOString();
        projectRef.current = next;
        setProject(next);
        setSaveState("Unsaved changes");
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return false;
      }
    },
    [],
  );
  function editItem(patch: Partial<JobItem>) {
    if (!selectedItem) return;
    if (
      patch.quantity !== undefined &&
      (!Number.isInteger(patch.quantity) ||
        patch.quantity < 0 ||
        patch.quantity+(patch.spareQuantity??selectedItem.spareQuantity)<1 ||
        patch.quantity + (patch.spareQuantity ?? selectedItem.spareQuantity) >
          1000)
    )
      return;
    if (
      patch.spareQuantity !== undefined &&
      (!Number.isInteger(patch.spareQuantity) ||
        patch.spareQuantity < 0 ||
        patch.spareQuantity+(patch.quantity??selectedItem.quantity)<1 ||
        patch.spareQuantity + (patch.quantity ?? selectedItem.quantity) > 1000)
    )
      return;
    if (
      patch.orientation?.some((n) => !Number.isFinite(n)) ||
      patch.position?.some((n) => !Number.isFinite(n))
    )
      return;
    mutate(
      (_, j) =>
        Object.assign(
          j.items.find((i) => i.partId === selectedPart.id)!,
          {...patch,...(patch.orientation?{orientationMode:'manual' as const}:{})},
        ),
      "Part quantity, orientation or placement changed.",
    );
  }
  function placeItem(partId:string,patch:Partial<JobItem>){
    if(patch.position?.some(v=>!Number.isFinite(v))||patch.orientation?.some(v=>!Number.isFinite(v)))return;
    mutate((_,target)=>{const item=target.items.find(item=>item.partId===partId);if(!item)throw new Error('Add this part to the plate first.');Object.assign(item,patch,...(patch.orientation?[{orientationMode:'manual'}]:[]));},'Part placement or rotation changed.');
    setInstalled(false);
  }
  async function preparePlate(arrange:boolean,orient=true){
    let explanation='';let preparationError:unknown;
    const accepted=await run(async(p,target)=>{
      try{const before=structuredClone(p),prepared=await preparePlateWorker(p,target,arrange,orient);
      target.items=prepared.items;target.settings=prepared.settings;explanation=prepared.reason;
      invalidateChangedJobs(before,p,'Plate orientation, placement or support selection changed.');target.status=preparationStatus(p,target);
      }catch(error){preparationError=error;throw error;}
    });
    if(!accepted)throw preparationError??new Error('Plate preparation stopped. Resolve the displayed error and retry.');
    setSupportAdvice({jobId:projectRef.current.activeJobId,reason:explanation});setInstalled(false);return structuredClone(projectRef.current);
  }
  function editSetting(key: string, value: number | string | boolean | undefined) {
    mutate((_, j) => {
      if(value===undefined)delete j.settings[key];else j.settings[key] = value;
      if(key==='bambu.sparse_infill_pattern'){j.settings.infillMode=value===undefined?'auto':'manual';delete j.settings.infillResolvedPattern;}
      if(key==='infillMode'&&value==='auto'){delete j.settings['bambu.sparse_infill_pattern'];delete j.settings.infillResolvedPattern;}
    }, `Process setting ${key} changed.`);
  }
  async function run(action: (p: Project, j: Job) => Promise<void>) {
    if (actionLock.current) return false;
    actionLock.current = true;
    setBusy(true);
    setError("");
    try {
      const p = structuredClone(projectRef.current);
      const j = p.jobs.find((v) => v.id === p.activeJobId)!;
      await action(p, j);
      p.updatedAt = new Date().toISOString();
      projectRef.current = p;
      setProject(p);
      setSaveState("Unsaved changes");
      return true;
    } catch (e) {
      fail(e);
      return false;
    } finally {
      setBusy(false);
      actionLock.current = false;
    }
  }
  async function attachGeneratedSlice(slice:SliceJob){
    let failure:unknown;
    const accepted=await run(async(p,target)=>{try{
      if(!slice.result||slice.result.previewSupported===false||await fingerprint(p,target)!==slice.manifestHash)throw Error('This native result does not match the current plate. Slice its current settings again.');
      if(slice.result.slicerVersion!==target.slicer.version)throw Error('The slicing version changed. Apply the configured profiles and slice again.');
      await attachToolpath(p,target,slice.result.gcode,{name:'Bambu Studio sliced job.gcode',source:'bambu',preparationVersion:slice.result.preparationVersion,nozzleOffset:slice.result.nozzleOffset,slicer:target.slicer,mappingConfirmed:true,slicerProject:slice.result.slicerProject});
      notify('Exact native layers attached. Review them before approval.');
    }catch(error){failure=error;throw error;}});
    if(failure)throw failure;return accepted;
  }
  async function saveProject() {
    if(actionLock.current)return false;
    actionLock.current=true;setBusy(true);
    try{await autosave.save(projectRef.current);setSaveState('Saved on this laptop');notify('Project saved on this laptop.');return true;}
    catch(error){fail(error);return false;}
    finally{actionLock.current=false;setBusy(false);}
  }
  async function exportProject() {
    try {
      download(
        await serializeProject(project),
        "intake-project.catalyst.json",
        "application/json",
      );
      notify("Portable project downloaded with geometry and review history.");
    } catch (e) {
      fail(e);
    }
  }
  async function importProject(file?: File) {
    if (!file || actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    try {
      if (file.size > 35 * 1024 * 1024)
        throw new Error("Project exceeds the 35 MiB import limit.");
      const p = await deserializeProject(await file.text());
      setProject(p);
      setSelectedId(p.parts[0]?.id ?? "");
      setPage("prepare");
      setSaveState("Imported · unsaved");
      notify("Project reopened. Geometry hashes and approvals were checked.");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
      actionLock.current = false;
    }
  }
  function acceptParts(parts: Part[],options?:RobotImportOptions) {
    if(options?.organize){const accepted=mutate(p=>{if(options.workOrder)p.manufacturingOrder=options.workOrder;const drafts=addRobotDrafts(p,parts);for(const draft of drafts)try{draft.items=arrangePlate(p,draft);}catch{/* Slice preparation reports the exact fit issue. */}},'Robot CAD imported into draft jobs; review profiles, orientation and fit.');if(!accepted)return false;setSelectedId(parts[0]?.id??'');setPage('prepare');notify('Robot parts organized into draft jobs. Review the active job before slicing.');return true;}
    const accepted=mutate((p, j) => {
      if(options?.workOrder)p.manufacturingOrder=options.workOrder;
      for (const part of parts) {
        const existing = p.parts.find((v) => v.id === part.id);
        if (existing && existing.geometry.hash !== part.geometry.hash)
          throw new Error(
            "An existing source changed. Create a new revision job instead.",
          );
        if (!existing) p.parts.push(part);
        else {
          existing.classification = part.classification;
          existing.quantity = part.quantity;
          existing.spareQuantity = part.spareQuantity;
        }
        if ((existing ?? part).classification === "make") {
          const item = j.items.find((i) => i.partId === part.id);
          if (item) {
            item.quantity = part.quantity;
            item.spareQuantity = part.spareQuantity;
          } else
            j.items.push({
              partId: part.id,
              quantity: part.quantity,
              spareQuantity: part.spareQuantity,
              orientation: [0, 0, 0],
              position: [128, 128, 0],
            });
        }
      }
      if(j.items.length)try{j.items=arrangePlate(p,j);}catch{/* Keep the CAD; show a resolvable plate check. */}
      j.status = "needs review";
    }, "Source parts imported; review plate placement.");
    if(!accepted)return false;
    setSelectedId(parts[0]?.id ?? "");
    setPage("prepare");
    notify(
      `${parts.length} part types imported. Review quantities and placement.`,
    );
    return true;
  }
  function openRobotCad(url='') {
    setSourceInitialTab('onshape');
    setSourceInitialUrl(url.trim());
    setSourceOpen(true);
  }
  function togglePart(part: Part) {
    mutate((p, j) => {
      if (j.items.some((i) => i.partId === part.id))
        j.items = j.items.filter((i) => i.partId !== part.id);
      else if (part.classification !== "buy") {
        p.parts.find(p=>p.id===part.id)!.classification="make";
        j.items.push({
          partId: part.id,
          quantity: part.quantity,
          spareQuantity: part.spareQuantity,
          orientation: [0, 0, 0],
          position: [128, 128, 0],
        });
      }
    }, "Batch selection changed.");
  }
  async function chooseToolpath(file?: File) {
    if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024)
        throw new Error("Toolpath exceeds the 10 MiB limit.");
      let gcode: string;
      try {
        gcode = new TextDecoder("utf-8", {
          fatal: true,
          ignoreBOM: true,
        }).decode(await file.arrayBuffer());
      } catch {
        throw new Error(
          "G-code must be valid UTF-8 text. Binary and other encodings are unsupported.",
        );
      }
      const result = parseGcode(gcode);
      setPendingGcode({
        name: file.name,
        gcode,
        fixture: result.isDemonstration,
      });
      setMappingConfirmed(false);
      setToolpathOpen(true);
    } catch (e) {
      fail(e);
    }
  }
  async function demoToolpath() {
    try {
      const r = await fetch("/fixtures/bracket-demo.gcode");
      if (!r.ok)
        throw new Error(
          "Demonstration G-code could not be loaded. Retry or import a supported file.",
        );
      const gcode = await r.text();
      parseGcode(gcode);
      setPendingGcode({ name: "bracket-demo.gcode", gcode, fixture: true });
      setMappingConfirmed(false);
      setToolpathOpen(true);
    } catch (e) {
      fail(e);
    }
  }
  async function attach() {
    if (!pendingGcode || !pendingPreview) return;
    await run(async (p, j) => {
      await attachToolpath(p, j, pendingGcode.gcode, {
        name: pendingGcode.name,
        source: pendingGcode.fixture ? "fixture" : "imported",
        slicer: {
          id: pendingGcode.fixture ? "fixture-gcode" : externalSlicer,
          version: pendingGcode.fixture ? "1.0-demo" : externalVersion,
        },
        warnings: pendingPreview.warnings,
        mappingConfirmed,
        bounds: pendingPreview.bounds,
      });
      setToolpathOpen(false);
      setPage("toolpaths");
      notify("Actual G-code imported. Inspect its layers before approval.");
    });
  }
  async function approve() {
    await run(async (p, j) => {
      if (!reviewConfirm || !manifestConfirm)
        throw new Error(
          "Confirm the layer review and exact manifest before approval.",
        );
      if(!isFixtureJob(p,j)&&(!j.printer.tested||!j.material.tested)&&!profileQualificationCurrent(j)){
        if(!setupConfirm)throw Error('Confirm the actual printer/material setup and native machine routines before manufacturing approval.');
        qualifyProfile(j,actor);
      }
      await reviewToolpath(p, j, actor);
      const blockers = preflightIssues(p, j, { toolpathCurrent: true }).filter(
        (i) => i.severity === "error",
      );
      if (blockers.length)
        throw new Error(
          blockers[0].message +
            " Open job preflight to resolve the affected setting.",
        );
      await approveJob(p, j, actor);
      notify(
        j.approval?.demonstrationOnly
          ? "Demonstration job approved · package is non-manufacturable."
          : "Exact manufacturing manifest approved.",
      );
    });
  }
  async function exportPackage() {
    await run(async (p, j) => {
      const key = `${j.approval?.id ?? "missing"}:operator-export`;
      const bytes = await exportJobPackage(p, j, {
        idempotencyKey: key,
        actor,
        checks,
      });
      download(
        new Uint8Array(bytes).buffer,
        `catalyst-${j.id.slice(0, 8)}-${j.approval?.manifestHash.slice(0, 8)}.zip`,
      );
      notify("Versioned package exported. No machine dispatch was performed.");
    });
  }
  function applyProfile() {
    if (!selectedPart) return;
    mutate((_, j) => {
      const s = recommendedProfile(selectedPart, j).settings;
      j.baseSettings = { ...j.baseSettings, ...s } as ProcessSettings;
      j.settings = {
        ...j.baseSettings,
        ...Object.fromEntries(
          Object.entries(overrides).map(([k, v]) => [k, v.value]),
        ),
      };
    }, "Base profile updated; manual overrides preserved.");
    notify("Example base profile applied; manual overrides preserved.");
  }
  function savePreset() {
    setPresetName("Team · " + (profileAdvice?.title ?? "process"));
    setPresetOpen(true);
  }
  function commitPreset() {
    if (!presetName.trim()) return;
    mutate((p) =>
      p.teamPresets.push({
        id: createId(),
        name: presetName.trim(),
        category: selectedPart?.category ?? "custom",
        printer: structuredClone(job.printer),
        material: structuredClone(job.material),
        settings: { ...job.settings },
        tested: false,
      }),
    );
    setPresetOpen(false);
    notify(
      "Team preset saved as untested. Exact printer, material and process are retained.",
    );
  }
  const categories = Object.keys(categoryLabels) as PartCategory[];
  if (initializing) return <StartupScreen animate={!desktopStartupComplete} ready={startupWorkspaceReady}/>;
  return (
    <div className={`app guided-app page-${page}`}>
      <div className="shell" inert={busy||restarting} aria-busy={busy||restarting}>
        <header className="topbar">
          <div className="brand"><Hexagon size={19}/><strong>Foundry</strong><span className="brand-parent">Catalyst</span></div>
          <div className="header-project"><h1>{project.name}</h1>{project.parts.some(part=>part.source.kind==='fixture')&&<span className="header-demo">Fixture · non-manufacturable</span>}</div>
          <div className="topright">
            <span className="save-state" role="status" title={autosave.error??workspace.error}>{workspace.error?'Workspace check failed · export a recovery copy':workspace.checking?'Checking and saving…':autosave.message||saveState}</span>
            {updateReady&&<button className="btn ghost" onClick={()=>setUpdatesOpen(true)}><ArrowDownToLine size={14}/>Update ready</button>}
            <button className="btn primary add-robot-button" onClick={()=>openRobotCad()} disabled={busy}><Link size={14}/>Add robot</button>
            <button className="btn ghost" onClick={saveProject} disabled={busy}><Save size={14}/>Save progress</button>
            <details className="project-menu" onClick={event=>{if((event.target as HTMLElement).closest('button'))event.currentTarget.removeAttribute('open');}} onKeyDown={event=>{if(event.key==='Escape')event.currentTarget.removeAttribute('open');}}>
              <summary><FolderOpen size={15}/>Project<ChevronDown size={12}/></summary>
              <div className="project-menu-content">
                <button className="btn ghost" onClick={()=>projectFile.current?.click()}><FolderOpen size={14}/>Open project</button>
                <button className="btn ghost" onClick={exportProject}><ArrowDownToLine size={14}/>Export project</button>
                <button className="btn ghost" aria-label="Job queue" onClick={()=>setPage('queue')}><ClipboardList size={14}/>Job records</button>
                <button className="btn ghost" onClick={()=>setPage("sync")}><Settings2 size={14}/>Team sync & records</button>
                <button className="btn ghost" onClick={()=>setConnectSetupOpen(true)}><Printer size={14}/>Connect a printer</button>
                <button className="btn ghost" onClick={()=>setUpdatesOpen(true)}><ArrowDownToLine size={14}/>App updates</button>
                <button className="btn ghost" aria-label="Help and capabilities" onClick={()=>setPage('help')}><Settings2 size={14}/>Integrations & help</button>
                {newerRevisionAvailable&&<button className="btn ghost" aria-label="Review source changes" onClick={()=>setRevisionOpen(true)}><History size={14}/>Review source changes</button>}
              </div>
            </details>
          </div>
        </header>
        <nav className="workflow" aria-label="Manufacturing workflow">
          {(
            [
              ["source", "01", "Team parts", Link],
              ["prepare", "02", "Prepare", Box],
              ["toolpaths", "03", "Slice & inspect", Layers3],
              ["review", "04", "Approve", ShieldCheck],
              ["export", "05", "Export", PackageCheck],
            ] as const
          ).map(([p, n, label]) => (
            <button
              key={p}
              className={`step ${page === p ? "active" : ""}`}
              aria-current={page === p ? "step" : undefined}
              onClick={() => setPage(p)}
            >
              <span className="stepnumber">{n}</span>
              {label}
              {p === "review" && approvalCurrent && <Check size={12} />}
            </button>
          ))}
        </nav>
        {error && (
          <div
            className="notice error"
            role="alert"
            style={{
              margin: "16px 30px 0",
              display: "flex",
              justifyContent: "space-between",
              gap: 15,
            }}
          >
            <span>
              <AlertTriangle
                size={13}
                style={{ verticalAlign: "middle", marginRight: 7 }}
              />
              {error}
            </span>
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              <X size={14} />
            </button>
          </div>
        )}
        {page === "source" && (
          <main className="intake-page">
            <div className="intake-intro">
              <h2>Your robot parts.</h2>
              <p>
                Add your robot’s Onshape link once. After that, everyone chooses
                parts here. No project file is needed.
              </p>
            </div>
            <div className="intake-body">
            <div className="intake-methods">
            <form className="robot-entry" aria-label="Add robot from Onshape" onSubmit={event=>{event.preventDefault();openRobotCad(robotLink);}}>
              <label htmlFor="robot-onshape-link">Robot’s Onshape link</label>
              <div className="robot-entry-controls"><input id="robot-onshape-link" type="url" required value={robotLink} onChange={event=>setRobotLink(event.target.value)} placeholder="Paste the whole robot’s Onshape assembly link"/><button className="btn primary" disabled={busy||!robotLink.trim()}>Add robot <ArrowRight size={14}/></button></div>
              <p className="smalltext">The first pull saves CAD for the team automatically. Already added? Choose its parts below.</p>
            </form>
            <SharedCadIntake workOrder={project.manufacturingOrder??''} onImport={acceptParts}/>
            <details className="team-documents"><summary>Advanced source options</summary><div className="intake-alternatives">
              <button
                className="text-action"
                onClick={() => {
                  setSourceInitialTab("local");
                  setSourceOpen(true);
                }}
              >
                <Upload size={16} />
                <span>
                  <strong>Import a local STL</strong>
                  <small>
                    Fallback with explicit units and dimension review
                  </small>
                </span>
                <ChevronRight size={14} />
              </button>
              <button
                className="text-action"
                onClick={() => {
                  setSourceInitialTab("fixtures");
                  setSourceOpen(true);
                }}
              >
                <Box size={16} />
                <span>
                  <strong>Try demonstration fixtures</strong>
                  <small>Sample CAD and G-code · never production-ready</small>
                </span>
                <ChevronRight size={14} />
              </button>
            </div>
            </details>
            </div>
            </div>
            {project.parts.length > 0 && (
              <section className="intake-existing">
                <h3>This project has {project.parts.length} source parts</h3>
                <p>
                  Adding parts keeps existing geometry pinned. Source updates
                  require a separate reviewed revision.
                </p>
                <button className="btn" onClick={() => setPage("prepare")}>
                  Continue preparing this job <ArrowRight size={14} />
                </button>
              </section>
            )}
            <p className="intake-footnote">
              You stay in control: prepare → slice and inspect → approve the
              exact job → export for an operator. Foundry never starts a
              printer.
            </p>
          </main>
        )}
        {(page === "prepare" || page === "toolpaths") && (
          <>
            <div
              className="mobile-pane-switch"
              role="tablist"
              aria-label="Workspace pane"
            >
              <button
                role="tab"
                aria-label="Show 3D workspace"
                aria-selected={mobilePane === "viewport"}
                onClick={() => {setMobilePane("viewport");setInspectorOpen(false);}}
              >
                <Box size={13} />
                Viewport
              </button>
              <button
                role="tab"
                aria-label="Show settings inspector"
                aria-selected={mobilePane === "inspector"}
                onClick={() => {setMobilePane("inspector");setInspectorOpen(true);}}
              >
                <Settings2 size={13} />
                Inspector
              </button>
              <button
                aria-label="Show preflight errors"
                onClick={() => {
                  setMobilePane("inspector");
                  setInspectorTab("checks");
                  setInspectorOpen(true);
                }}
              >
                <AlertTriangle size={12} />
                {stepErrors.length} checks
              </button>
            </div>
            <div className="workspace" data-mobile-pane={mobilePane} data-parts-open={partsOpen} data-inspector-open={inspectorOpen}>
              <aside className="parts-panel">
                <div className="panel-heading">
                  <div className="row">
                    <h2>Source parts</h2>
                    <span className="count">{project.parts.length}</span>
                  </div>
                  <button
                    className="iconbtn"
                    title="Add CAD parts"
                    aria-label="Add CAD parts"
                    onClick={() => setSourceOpen(true)}
                  >
                    <Plus size={13} />
                  </button>
                </div>
                <div className="tree-root">
                  <ChevronDown size={12} />
                  <Boxes size={13} />
                  <span>{project.name}</span>
                </div>
                <div className="parts-search">
                  <Search size={13} />
                  <input
                    aria-label="Search parts"
                    placeholder="Find a component…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <label className="field catalog-group">Assembly / subsystem<select aria-label="Filter source assembly" value={catalogGroup} onChange={e=>setCatalogGroup(e.target.value)}>
                  <option value="">All imported parts</option>
                  {workspaceGroups(project.parts).map(group=><option key={group.id} value={group.id}>{group.label}</option>)}
                </select></label>
                <p className="catalog-count smalltext">{includedParts.length} of {project.parts.length} part types · filter does not change job quantities</p>
                <div className="part-list">
                  {includedParts.map((part) => {
                    const item = job.items.find((i) => i.partId === part.id);
                    return (
                      <button
                        key={part.id}
                        className={`part-card ${selectedPart?.id === part.id ? "active" : ""}`}
                        onClick={() => {
                          setSelectedId(part.id);
                          if (mobilePane === "inspector")
                            setInspectorTab("part");
                        }}
                      >
                        <span className="part-thumb">
                          <PartThumbnail part={part} />
                        </span>
                        <div className="part-info">
                          <strong>{part.name}</strong>
                          <small>
                            {part.source.versionName ??
                              part.source.revision ??
                              "Local import"}{" "}
                            ·{" "}
                            {part.classification === "make"
                              ? job.material.type
                              : part.classification}
                          </small>
                          <small>
                            {part.geometry.dimensions
                              .map((n) => Number(n.toFixed(1)))
                              .join(" × ")}{" "}
                            mm
                          </small>
                        </div>
                        <span
                          className="partqty"
                          title={item ? job.status : "Not in batch"}
                        >
                          {item
                            ? `${item.quantity + item.spareQuantity}×`
                            : "—"}
                        </span>
                      </button>
                    );
                  })}
                  {!includedParts.length && (
                    <div className="empty">
                      <Box size={25} />
                      <p>
                        {query
                          ? "No matching parts."
                          : "Your source parts will appear here."}
                      </p>
                      <button
                        className="btn small"
                        onClick={() => setSourceOpen(true)}
                      >
                        Select CAD parts
                      </button>
                    </div>
                  )}
                </div>
                <div className="part-foot">
                  <div className="source-status">
                    <Unplug size={12} />
                    Onshape ·{" "}
                    {connectionState.onshape?.available
                      ? "server access configured"
                      : "login setup needed"}
                  </div>
                  Source versions and geometry remain pinned.
                  <div className="divider" style={{ margin: "11px 0" }} />
                  <button
                    className="linkbutton"
                    onClick={() => setRevisionOpen(true)}
                  >
                    <History size={11} />{" "}
                    {newerRevisionAvailable
                      ? "V19 fixture update · review changes"
                      : "Check source revisions"}
                  </button>
                </div>
              </aside>
              <main className="viewer-column">
                <div className="viewer-toolbar">
                  <button className={`btn ghost canvas-parts ${partsOpen ? 'selected' : ''}`} aria-label="Toggle source parts" aria-expanded={partsOpen} onClick={()=>{setPartsOpen(!partsOpen);setInspectorOpen(false);setMobilePane('viewport');}}><Boxes size={15}/>Parts <span className="count">{project.parts.length}</span></button>
                  <div className="segmented">
                    <button
                      className={
                        page === "prepare" && viewMode === "plate"
                          ? "active"
                          : ""
                      }
                      onClick={() => {
                        setPage("prepare");
                        setViewMode("plate");
                        setInstalled(false);
                      }}
                    >
                      <Layers3 size={12} />
                      Build plate
                    </button>
                    <button
                      className={
                        page === "prepare" && viewMode === "parts"
                          ? "active"
                          : ""
                      }
                      onClick={() => {
                        setPage("prepare");
                        setViewMode("parts");
                      }}
                    >
                      <Box size={12} />
                      Part
                    </button>
                    <button
                      className={page === "toolpaths" ? "active" : ""}
                      onClick={() => setPage("toolpaths")}
                    >
                      <Activity size={12} />
                      Toolpaths
                    </button>
                  </div>
                  <span
                    className="viewer-context"
                    title={
                      page === "toolpaths"
                        ? generated ? "Bambu Studio sliced plate" : job.toolpath?.name
                        : selectedPart?.name
                    }
                  >
                    {page === "toolpaths"
                      ? generated ? "Bambu Studio sliced plate" : job.toolpath?.name
                      : selectedPart?.name}
                  </span>
                  <span
                    className={`tag ${job.toolpath?.stale ? "yellow" : ""}`}
                  >
                    {page === "toolpaths"
                      ? job.toolpath?.stale
                        ? "STALE"
                        : (job.toolpath || generated)
                          ? "ACTUAL TOOLPATH"
                          : "NO TOOLPATH"
                      : "mm"}
                  </span>
                  <div className="canvas-menus">
                    <FilamentPicker jobId={job.id} color={job.material.color} materialType={job.material.type} printerModel={job.printer.model} disabled={busy||slicingActive} allowAutomatic={!generated&&!job.toolpath} onColor={color=>mutate((_,target)=>{target.material.color=color;},'Filament color changed; verify the loaded spool and tray mapping.')}/>
                    {page === 'prepare' && <button className="btn ghost" aria-expanded={inspectorOpen && inspectorTab==='part'} onClick={()=>inspectorOpen && inspectorTab==='part'?setInspectorOpen(false):showInspector('part')}><SlidersHorizontal size={14}/>Edit part</button>}
                    <button className="btn ghost" aria-expanded={inspectorOpen && inspectorTab==='process'} onClick={()=>inspectorOpen && inspectorTab==='process'?setInspectorOpen(false):showInspector('process')}><Settings2 size={14}/>{page==='toolpaths'?'Advanced inspection':'Print setup'}</button>
                    {page==='prepare' && <button className="btn ghost" aria-expanded={inspectorOpen && inspectorTab==='checks'} onClick={()=>inspectorOpen && inspectorTab==='checks'?setInspectorOpen(false):showInspector('checks')}><ShieldCheck size={14}/>{stepErrors.length ? `${stepErrors.length} checks` : 'Checks'}</button>}
                  </div>
                </div>
                {page === 'toolpaths' && previewState.loading && <div className="toolpath-preview-notice" role="status">Loading actual layers…</div>}
                {page === 'toolpaths' && previewState.error && <div className="toolpath-preview-notice" role="alert">{previewState.error}</div>}
                {page === 'toolpaths' && parsed && !parsed.canApprove && <div className="toolpath-preview-notice" role="alert">Incomplete command preview · Foundry approval blocked. Review the full result in Bambu Connect.</div>}
                <div className="viewer-stage">
                  {page==='prepare'&&viewMode==='plate'&&!installed&&<PlateTools
                    tool={placementTool} onTool={setPlacementTool} disabled={busy||!selectedItem} busy={busy} hasItems={job.items.length>0}
                    onArrange={()=>{void preparePlate(true).catch(fail);}}
                    onFloor={()=>selectedItem&&placeItem(selectedItem.partId,{position:[selectedItem.position[0],selectedItem.position[1],0]})}
                    onRotate={(axis,delta)=>{
                      if(selectedItem){const orientation=[...selectedItem.orientation] as Vec3;orientation[axis]+=delta;
                        placeItem(selectedItem.partId,{orientation,position:[selectedItem.position[0],selectedItem.position[1],0]});}
                    }}
                    onLayFlat={()=>{void run(async(p,target)=>{
                      const item=target.items.find(item=>item.partId===selectedPart?.id),part=p.parts.find(part=>part.id===selectedPart?.id);
                      if(!item||!part)throw new Error('Select a part on this plate.');
                      item.orientation=await layFlatWorker(part,item,target.printer.buildVolume);item.orientationMode='manual';item.position[2]=0;
                      invalidateJob(target,'Lay-flat orientation changed.');
                    }).then(()=>setInstalled(false));}}
                  />}

                  <WorkspaceViewer
                    parts={
                      viewMode === "parts" &&
                      page === "prepare" &&
                      selectedPart &&
                      !installed
                        ? [selectedPart]
                        : project.parts
                    }
                    items={job.items}
                    selectedPartId={selectedPart?.id}
                    onSelectPart={setSelectedId}
                    mode={page === "toolpaths" && parsed ? "toolpath" : viewMode}
                    toolpath={parsed}
                    layer={layer}
                    showTravel={visibleFeatures.includes("travel")}
                    visibleFeatures={Object.fromEntries(
                      features.map((f) => [f, visibleFeatures.includes(f)]),
                    )}
                    plate={job.printer.buildVolume}
                    filamentColor={job.material.color}
                    pathOffset={generated?.result?.nozzleOffset??job.toolpath?.nozzleOffset}
                    beadWidth={job.printer.nozzleDiameter*1.05} beadHeight={job.settings.layerHeight} pathColorMode={pathColorMode}
                    placementTool={placementTool}
                    onMovePart={(id,position)=>placeItem(id,{position})}
                    onPlaceFace={(id,normal)=>{const item=job.items.find(item=>item.partId===id);if(item){try{placeItem(id,{orientation:faceDownOrientation(item.orientation,normal),position:[item.position[0],item.position[1],0]});setPlacementTool('orbit');}catch(error){fail(error);}}}}
                    installedOrientation={installed}
                  />
                </div>
                {page === "toolpaths" && parsed && (
                  <>
                    <div className="featurekey">
                      <label>Color<select aria-label="Toolpath coloring" value={pathColorMode} onChange={event=>setPathColorMode(event.target.value as 'filament'|'feature')}><option value="filament">Filament</option><option value="feature">Line type</option></select></label>
                      {features.map((f) => (
                        <label key={f}>
                          <input
                            type="checkbox"
                            checked={visibleFeatures.includes(f)}
                            onChange={(e) =>
                              setVisibleFeatures(
                                e.target.checked
                                  ? [...visibleFeatures, f]
                                  : visibleFeatures.filter((v) => v !== f),
                              )
                            }
                          />
                          <span
                            className="keydot"
                            style={{ background:pathColorMode==='feature'||f==='travel'?featureColors[f]:f==='support'?'#93b5a7':job.material.color }}
                          />
                          {f === "wall"
                            ? "Walls"
                            : f === "other"
                              ? "Other"
                              : f[0].toUpperCase() + f.slice(1)}
                        </label>
                      ))}
                    </div>
                    <div className="layerbar">
                      <Layers3 size={12} />
                      <span title="Extrusion widths and heights use slicer metadata when supplied, otherwise the job nozzle/layer settings. Machine commands are not simulated.">Bead preview</span>
                      <span>
                        Layer {layer + 1} / {parsed.layers.length}
                      </span>
                      <input
                        aria-label="Toolpath layer"
                        type="range"
                        min={0}
                        max={Math.max(0, parsed.layers.length - 1)}
                        value={layer}
                        onChange={(e) => setLayer(Number(e.target.value))}
                      />
                      <span>Z {parsed.layers[layer]?.z.toFixed(2)} mm</span>
                    </div>
                  </>
                )}
                    <SlicingPanel
                      key={`${project.id}:${job.id}`}
                      slice={sliceSession.slice} sessionMessage={sliceSession.message}
                      onSlice={sliceSession.accept} onDeliver={sliceSession.retry}
                      onInspect={() => setPage("toolpaths")}
                      onFix={jumpToIssue}
                      project={project}
                      job={job}
                      onError={fail}
                      onActivityChange={setSlicingWorking}
                      getCurrent={()=>{const current=projectRef.current;return {project:current,job:current.jobs.find(candidate=>candidate.id===current.activeJobId)!};}}
                      supportReason={supportAdvice?.jobId===job.id?supportAdvice.reason:undefined}
                      onSupportStyle={style=>{setSupportAdvice(undefined);mutate((_,target)=>{target.settings.supports=style!=='off';target.settings.supportStyle=style==='off'?'auto':style as 'auto'|'normal'|'tree';delete target.settings.supportResolvedStyle;delete target.settings['bambu.support_type'];},'Support generation changed.');}}
                      onSetting={editSetting}
                      onPrepare={preparePlate}
                      onUseProfile={(profile) => {
                        const accepted=mutate((_, target) => {
                          target.printer = structuredClone(profile.printer);
                          target.material = {...structuredClone(profile.material),color:target.material.color};
                          target.slicer = structuredClone(profile.slicer);
                        }, "Confirmed machine, material and exact slicer profiles applied.");
                        return accepted?structuredClone(projectRef.current):false;
                      }}
                    />
                <div className="viewport-stats">
                  <span>
                    {page === "toolpaths" ? (
                      `${parsed?.segmentCount ?? 0} actual linear moves`
                    ) : (
                      <>
                        <span
                          className="dot"
                          style={{
                            display: "inline-block",
                            background: warnings.length ? "var(--cat-warn)" : "var(--cat-ok)",
                            marginRight: 6,
                          }}
                        />
                        {warnings.length
                          ? `${warnings.length} plate warnings`
                          : "Within build volume"}
                      </>
                    )}
                  </span>
                  <span>
                    {job.printer.buildVolume.join(" × ")} <strong>mm</strong>{" "}
                    <span style={{ marginLeft: 6, color: "var(--cat-dim)" }}>{job.printer.id.startsWith('example-')?'Example profile':profileQualificationCurrent(job)?'Operator-confirmed setup':'Needs setup confirmation'}</span>
                  </span>
                </div>
              </main>
              <aside className="inspector" data-tab={inspectorTab}>
                <div className="drawer-heading"><span>{page==='toolpaths'?'Slicing & inspection':inspectorTab==='part'?'Part settings':inspectorTab==='process'?'Print setup':'Preflight checks'}</span><button className="iconbtn" aria-label="Close settings" onClick={()=>{setInspectorOpen(false);setMobilePane('viewport');}}><X size={16}/></button></div>
                {page === "prepare" && (
                  <div
                    className="inspector-tabs"
                    role="tablist"
                    aria-label="Settings inspector"
                  >
                    {(
                      [
                        ["part", "Part", "Part inspector"],
                        ["process", "Process", "Process inspector"],
                        ["checks", "Checks", "Preflight checks"],
                      ] as const
                    ).map(([id, label, aria]) => (
                      <button
                        key={id}
                        role="tab"
                        aria-label={aria}
                        aria-selected={inspectorTab === id}
                        onClick={() => setInspectorTab(id)}
                      >
                        {label}
                        {id === "checks" && stepErrors.length > 0 && (
                          <span>{stepErrors.length}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {page === "prepare" ? (
                  <>
                    <div
                      className="inspector-section"
                      data-inspector-panel="part"
                    >
                      <div className="section-title">
                        <h3>Part & batch</h3>
                        <Box size={14} />
                      </div>
                      {selectedPart ? (
                        <>
                          <div
                            className="row"
                            style={{ justifyContent: "space-between" }}
                          >
                            <strong style={{ fontSize: 12, fontWeight: 500 }}>
                              {selectedPart.name}
                            </strong>
                            <span className="tag">
                              {selectedPart.source.kind}
                            </span>
                          </div>
                          <Field
                            label="Classification"
                            hint={
                              selectedPart.classification === "review"
                                ? "Confirm make/buy before adding this part to a manufacturing batch."
                                : undefined
                            }
                          >
                            <select
                              aria-label="Part classification"
                              value={selectedPart.classification}
                              onChange={(e) =>
                                mutate((p, j) => {
                                  p.parts.find(
                                    (v) => v.id === selectedPart.id,
                                  )!.classification = e.target
                                    .value as Part["classification"];
                                  if (e.target.value !== "make")
                                    j.items = j.items.filter(
                                      (i) => i.partId !== selectedPart.id,
                                    );
                                }, "Part classification changed.")
                              }
                            >
                              <option value="make">
                                Make · manufacture in team
                              </option>
                              <option value="buy">
                                Buy · purchased component
                              </option>
                              <option value="review">
                                Needs classification review
                              </option>
                            </select>
                          </Field>
                          <label className="togglelabel">
                            <input
                              type="checkbox"
                              checked={!!selectedItem}
                              disabled={selectedPart.classification === "buy"}
                              onChange={() => togglePart(selectedPart)}
                            />
                            Print this part · add to this plate
                          </label>
                          {selectedItem && (
                            <div className="fieldrow">
                              <Field label="Required quantity">
                                <input
                                  aria-label="Required quantity"
                                  type="number"
                                  min={0}
                                  max={1000}
                                  value={selectedItem.quantity}
                                  onChange={(e) =>
                                    editItem({
                                      quantity: Number(e.target.value),
                                    })
                                  }
                                />
                              </Field>
                              <Field label="Backup parts">
                                <input
                                  aria-label="Backup parts"
                                  type="number"
                                  min={0}
                                  max={100}
                                  value={selectedItem.spareQuantity}
                                  onChange={(e) =>
                                    editItem({
                                      spareQuantity: Number(e.target.value),
                                    })
                                  }
                                />
                              </Field>
                            </div>
                          )}
                          <p className="smalltext">
                            CAD material hint:{" "}
                            {selectedPart.materialHint ?? "Not specified"}.
                            Choose filament below.
                          </p>
                          <details style={{ marginTop: 12 }}>
                            <summary
                              className="smalltext"
                              style={{ cursor: "pointer" }}
                            >
                              Source revision & lineage
                            </summary>
                            <p className="smalltext" style={{ marginTop: 8 }}>
                              {selectedPart.source.versionName ??
                                selectedPart.source.revision ??
                                "Local import"}
                              <br />
                              {selectedPart.source.configuration ??
                                "Source units: " +
                                  (selectedPart.geometry.original?.units ??
                                    "mm")}
                              <br />
                              {selectedPart.source.occurrences?.length ??
                                0}{" "}
                              installed occurrence paths
                              <br />
                              <span className="hash">
                                {shortHash(selectedPart.geometry.hash)}
                              </span>
                            </p>
                            {selectedPart.source.url && (
                              <a
                                className="linkbutton"
                                href={selectedPart.source.url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {selectedPart.source.kind === "fixture"
                                  ? "Fixture source link (illustrative) ↗"
                                  : "Open source reference ↗"}
                              </a>
                            )}
                            {selectedPart.source.occurrences
                              ?.slice(0, 10)
                              .map((o, i) => (
                                <p className="smalltext" key={i}>
                                  {o.path.join(" / ")}
                                </p>
                              ))}
                          </details>
                          {selectedPart.geometry.warnings?.map((w, i) => (
                            <div key={i} className="inline-error">
                              Geometry review required: {w}
                            </div>
                          ))}
                        </>
                      ) : (
                        <button
                          className="btn"
                          onClick={() => setSourceOpen(true)}
                        >
                          Select CAD parts
                        </button>
                      )}
                    </div>
                    <div
                      className="inspector-section"
                      data-inspector-panel="process"
                    >
                      <div className="section-title">
                        <h3>Machine & material</h3>
                        <Printer size={14} />
                      </div>
                      <p className="smalltext">{job.printer.model} · {job.printer.nozzleDiameter} mm · {job.material.type}. Choose Printer & material below the plate to change the included profile.</p>
                      <details className="advanced-disclosure"><summary>Manual profile overrides</summary>
                      <Field
                        label="Printer"
                        hint={
                          job.printer.id === "example-bambu-256"
                            ? "Example profile only. Use configured profiles at the slicing step for your actual machine."
                            : "Explicit configured printer. Its nozzle, plate, material and process are checked before slicing."
                        }
                      >
                        <select
                          aria-label="Printer profile"
                          value={job.printer.id}
                          onChange={(e) =>
                            mutate((_, j) => {
                              if (e.target.value === defaultPrinter.id)
                                j.printer = structuredClone(defaultPrinter);
                            }, "Printer changed.")
                          }
                        >
                          {job.printer.id !== "example-bambu-256" && (
                            <option value={job.printer.id}>
                              {job.printer.model} · configured
                            </option>
                          )}
                          <option value="example-bambu-256">
                            Bambu Lab · 256 mm example
                          </option>
                        </select>
                      </Field>
                      <div className="fieldrow">
                        <Field label="Nozzle">
                          <select
                            aria-label="Nozzle"
                            value={job.printer.nozzleDiameter}
                            onChange={(e) =>
                              mutate((_, j) => {
                                j.printer.nozzleDiameter = Number(
                                  e.target.value,
                                );
                                j.printer.tested = false;
                              }, "Nozzle changed.")
                            }
                          >
                            {![0.4, 0.6].includes(
                              job.printer.nozzleDiameter,
                            ) && (
                              <option value={job.printer.nozzleDiameter}>
                                {job.printer.nozzleDiameter} mm · configured
                              </option>
                            )}
                            <option value={0.4}>0.4 mm · example</option>
                            <option value={0.6}>0.6 mm · example</option>
                          </select>
                        </Field>
                        <Field label="Filament">
                          <select
                            aria-label="Filament"
                            value={job.material.type}
                            onChange={(e) =>
                              mutate((_, j) => {
                                j.material = {
                                  ...j.material,
                                  id: `example-${e.target.value.toLowerCase()}`,
                                  type: e.target.value,
                                  name: `Generic ${e.target.value} · example`,
                                  tested: false,
                                };
                              }, "Material mapping changed.")
                            }
                          >
                            {!["PETG", "PLA", "ASA"].includes(
                              job.material.type,
                            ) && <option>{job.material.type}</option>}
                            <option>PETG</option>
                            <option>PLA</option>
                            <option>ASA</option>
                          </select>
                        </Field>
                      </div>
                      </details>
                      <Field label="Filament preview color"><input aria-label="Filament preview color" type="color" value={/^#[0-9a-f]{6}$/i.test(job.material.color)?job.material.color:"#d9d9d9"} onChange={e=>mutate((_,j)=>{j.material.color=e.target.value;},"Selected filament color changed; review the loaded spool.")}/></Field>
                      <p className="smalltext">Choose the color of your intended spool. Foundry cannot detect the loaded printer filament.</p>
                      <small>
                        Untested profiles · physical validation required
                      </small>
                    </div>
                    <div
                      className="inspector-section"
                      data-inspector-panel="process"
                    >
                      <div className="section-title">
                        <h3>Print settings</h3>
                        <span className="tag">{job.settings.layerHeight} mm · {job.settings.walls} walls · {job.settings.infill}%</span>
                      </div>
                      <details className="advanced-disclosure"><summary>Example recommendations</summary>
                      <Field label="Part category · confirm or correct">
                        <select
                          aria-label="Part category"
                          value={selectedPart?.category ?? "custom"}
                          disabled={!selectedPart}
                          onChange={(e) =>
                            mutate((p) => {
                              p.parts.find(
                                (v) => v.id === selectedPart.id,
                              )!.category = e.target.value as PartCategory;
                            })
                          }
                        >
                          {categories.map((c) => (
                            <option value={c} key={c}>
                              {categoryLabels[c]}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <div className="recommendation">
                        <strong>
                          <Sparkles
                            size={11}
                            style={{ verticalAlign: "middle", marginRight: 5 }}
                          />
                          Suggested starting point · uncertain
                        </strong>
                        {profileAdvice?.reason ??
                          "Select a part to review a process recommendation."}
                        <details className="assumptions">
                          <summary>Recommendation assumptions</summary>
                          <ul>
                            {profileAdvice?.assumptions.map((a, i) => (
                              <li key={i}>{a}</li>
                            ))}
                          </ul>
                        </details>
                        <button
                          className="linkbutton"
                          style={{ display: "block", marginTop: 7 }}
                          onClick={applyProfile}
                        >
                          Apply example base profile
                        </button>
                      </div>
                      </details>
                      <details
                        className="advanced-disclosure"
                        open={advancedOpen}
                        onToggle={(e) => setAdvancedOpen(e.currentTarget.open)}
                      >
                        <summary>
                          Advanced slicing settings{" "}
                          <span>{Object.keys(overrides).length} overrides</span>
                        </summary>
                        <div className="fieldrow">
                          <Field
                            label="Layer height"
                            override={!!overrides.layerHeight}
                          >
                            <div className="inputunit">
                              <input
                                aria-label="Layer height"
                                type="number"
                                min={0.04}
                                max={1}
                                step={0.02}
                                value={job.settings.layerHeight}
                                onChange={(e) =>
                                  editSetting(
                                    "layerHeight",
                                    Number(e.target.value),
                                  )
                                }
                              />
                              <span>mm</span>
                            </div>
                          </Field>
                          <Field
                            label="Wall loops"
                            override={!!overrides.walls}
                          >
                            <input
                              aria-label="Wall loops"
                              type="number"
                              min={1}
                              max={20}
                              value={job.settings.walls}
                              onChange={(e) =>
                                editSetting("walls", Number(e.target.value))
                              }
                            />
                          </Field>
                        </div>
                        <div className="fieldrow">
                          <Field label="Infill" override={!!overrides.infill}>
                            <div className="inputunit">
                              <input
                                aria-label="Infill"
                                type="number"
                                min={0}
                                max={100}
                                value={job.settings.infill}
                                onChange={(e) =>
                                  editSetting("infill", Number(e.target.value))
                                }
                              />
                              <span>%</span>
                            </div>
                          </Field>
                          <Field
                            label="Supports"
                            override={!!overrides.supports}
                          >
                            <select
                              aria-label="Supports"
                              value={String(job.settings.supports)}
                              onChange={(e) =>
                                editSetting(
                                  "supports",
                                  e.target.value === "true",
                                )
                              }
                            >
                              <option value="false">Off</option>
                              <option value="true">Enabled</option>
                            </select>
                          </Field>
                        </div>
                        <div className="fieldrow">
                          <Field
                            label="Brim width"
                            override={!!overrides.brimWidth}
                          >
                            <input
                              aria-label="Brim width"
                              type="number"
                              min={0}
                              max={50}
                              value={job.settings.brimWidth}
                              onChange={(e) =>
                                editSetting("brimWidth", Number(e.target.value))
                              }
                            />
                          </Field>
                          <Field
                            label="Speed · mm/s"
                            override={!!overrides.speed}
                          >
                            <input
                              aria-label="Print speed"
                              type="number"
                              min={1}
                              max={1000}
                              value={job.settings.speed}
                              onChange={(e) =>
                                editSetting("speed", Number(e.target.value))
                              }
                            />
                          </Field>
                        </div>
                        <div
                          className="row"
                          style={{ justifyContent: "space-between" }}
                        >
                          <button className="linkbutton" onClick={savePreset}>
                            <Save size={11} /> Save team preset
                          </button>
                          <button
                            className="linkbutton"
                            onClick={() => setResetOpen(true)}
                          >
                            Reset overrides
                          </button>
                        </div>
                        <details className="advanced-disclosure"><summary>All Bambu process settings</summary><BambuProcessSettings settings={job.settings} baseSettings={job.baseSettings} profileKey={job.slicer.profileBundleHash} onChange={editSetting} disabled={busy||slicingActive}/></details>
                      </details>
                      {project.teamPresets.length > 0 && (
                        <Field label="Saved team presets">
                          <select
                            aria-label="Team preset"
                            defaultValue=""
                            onChange={(e) => {
                              const preset = project.teamPresets.find(
                                (p) => p.id === e.target.value,
                              );
                              if (preset)
                                mutate((_, j) => {
                                  j.printer = structuredClone(preset.printer);
                                  j.material = structuredClone(preset.material);
                                  j.baseSettings = { ...preset.settings };
                                  j.settings = { ...preset.settings };
                                }, "Team preset applied.");
                            }}
                          >
                            <option value="" disabled>
                              Select an untested team preset
                            </option>
                            {project.teamPresets.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name} · untested
                              </option>
                            ))}
                          </select>
                        </Field>
                      )}
                    </div>
                    <div
                      className="inspector-section"
                      data-inspector-panel="part"
                    >
                      <details
                        className="advanced-disclosure"
                        open={manualOpen}
                        onToggle={(e) => setManualOpen(e.currentTarget.open)}
                      >
                        <summary>Manual placement and rotation</summary>
                        <Field label="Copy spacing · mm"><input aria-label="Copy spacing" type="number" min={8} max={200} value={selectedItem?.copySpacing??8} disabled={!selectedItem} onChange={event=>{const spacing=Number(event.target.value);if(spacing>=8&&spacing<=200)editItem({copySpacing:spacing});}}/></Field>
                        <Field label="Rotation · Euler XYZ degrees">
                          <div className="triple">
                            {(["X", "Y", "Z"] as const).map((a, i) => (
                              <div className="inputunit" key={a}>
                                <input
                                  aria-label={`Rotate ${a}`}
                                  type="number"
                                  step={15}
                                  value={selectedItem?.orientation[i] ?? 0}
                                  disabled={!selectedItem}
                                  onChange={(e) => {
                                    const v = [
                                      ...selectedItem!.orientation,
                                    ] as Vec3;
                                    v[i] = Number(e.target.value);
                                    editItem({ orientation: v });
                                  }}
                                />
                                <span>{a}</span>
                              </div>
                            ))}
                          </div>
                        </Field>
                        <Field label="Plate position · mm">
                          <div className="triple">
                            {(["X", "Y", "Z"] as const).map((a, i) => (
                              <div className="inputunit" key={a}>
                                <input
                                  aria-label={`Position ${a}`}
                                  type="number"
                                  value={selectedItem?.position[i] ?? 0}
                                  disabled={!selectedItem}
                                  onChange={(e) => {
                                    const v = [
                                      ...selectedItem!.position,
                                    ] as Vec3;
                                    v[i] = Number(e.target.value);
                                    editItem({ position: v });
                                  }}
                                />
                                <span>{a}</span>
                              </div>
                            ))}
                          </div>
                        </Field>
                        <div className="row">
                          <button
                            className="btn small"
                            disabled={!selectedItem}
                            onClick={() => editItem({ orientation: [0, 0, 0] })}
                          >
                            <RotateCcw size={11} />
                            Reset
                          </button>
                          <button
                            className="btn small"
                            onClick={() => setGuideOpen(true)}
                          >
                            <Sparkles size={11} />
                            Strength guidance
                          </button>
                        </div>
                        <label className="togglelabel">
                          <input
                            type="checkbox"
                            checked={installed}
                            onChange={(e) => {
                              setInstalled(e.target.checked);
                              setViewMode("parts");
                            }}
                          />
                          Inspect installed CAD orientation{" "}
                          <small>(separate)</small>
                        </label>
                        {warnings.slice(0, 4).map((w, i) => (
                          <div className="inline-error" key={i}>
                            <AlertTriangle size={10} /> {w}
                          </div>
                        ))}
                        <p className="smalltext" style={{ marginTop: 8 }}>
                          Copies use explicit grid spacing. Move parts to
                          resolve overlap. Geometry is never auto-scaled.
                        </p>
                      </details>
                    </div>
                    <div data-inspector-panel="part">
                      {selectedPart && (
                        <PreparationAssistant
                          project={project}
                          job={job}
                          partId={selectedPart.id}
                          onOrientation={(orientation) => {
                            editItem({ orientation });
                            setInstalled(false);
                          }}
                          onPlacement={(orientation, position) => {
                            editItem({ orientation, position });
                            setInstalled(false);
                          }}
                          onReviewContext={() => setGuideOpen(true)}
                        />
                      )}
                    </div>
                    <div data-inspector-panel="checks">
                      <PreflightPanel
                        issues={issues.filter(issue => issue.page === "prepare")}
                        rows={reconciledQuantities}
                        onJump={jumpToIssue}
                        onReconcile={(partId, quantity) =>
                          mutate((_, j) => {
                            j.items.find((i) => i.partId === partId)!.quantity =
                              quantity;
                          }, "User reconciled required quantity against immutable CAD demand; spares retained.")
                        }
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="inspector-section">
                      <h3>Advanced: existing G-code</h3>
                      <button
                        className="btn primary fullwidth"
                        onClick={() => toolpathFile.current?.click()}
                        style={{ marginTop: 12 }}
                      >
                        <Upload size={13} />
                        Import G-code
                      </button>
                      <button
                        className="btn fullwidth"
                        onClick={demoToolpath}
                        style={{ marginTop: 9 }}
                      >
                        <FileBox size={13} />
                        Load demonstration toolpath
                      </button>
                      <p className="smalltext" style={{ marginTop: 12 }}>
                        Preview reads actual G0/G1 moves. Imported mapping is
                        operator-attested. No geometry cross-section is used as
                        a sliced preview.
                      </p>
                    </div>
                    {job.toolpath && (
                      <div className="inspector-section">
                        <div className="section-title">
                          <h3>Toolpath artifact</h3>
                          <span
                            className={`tag ${toolpathCurrent ? "green" : "yellow"}`}
                          >
                            {toolpathCurrent ? "CURRENT" : "STALE"}
                          </span>
                        </div>
                        <p className="smalltext">
                          {job.toolpath.name}
                          <br />
                          {job.toolpath.source} · {job.toolpath.slicer.id}{" "}
                          {job.toolpath.slicer.version}
                          <br />
                          {parsed?.layers.length ?? 0} layers ·{" "}
                          {parsed?.segmentCount ?? 0} moves
                          <br />
                          No print-time estimate is available.
                        </p>
                        <div className="divider" />
                        <div className="hash">
                          SHA-256 {shortHash(job.toolpath.hash)}
                        </div>
                        {job.toolpath.source === "fixture" && (
                          <div
                            className="notice coral"
                            style={{ marginTop: 13 }}
                          >
                            Demonstration G-code only. It is not a Bambu slicing
                            result and is not intended for manufacturing.
                          </div>
                        )}
                        {job.toolpath.stale && (
                          <div
                            className="notice error"
                            style={{ marginTop: 13 }}
                          >
                            Manufacturing inputs changed. Import a matching
                            toolpath and review it again.
                          </div>
                        )}
                        <button
                          className="btn small danger fullwidth"
                          aria-label="Revoke toolpath mapping"
                          style={{ marginTop: 12 }}
                          disabled={!job.toolpath.mappingConfirmed}
                          onClick={() => {
                            setRevokeReason("");
                            setRevokeOpen(true);
                          }}
                        >
                          Revoke toolpath mapping
                        </button>
                        {parsed?.warnings.map((w, i) => (
                          <div key={i} className="inline-error">
                            {w}
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="inspector-section">
                      <h3>Artifact separation</h3>
                      <p className="smalltext" style={{ marginTop: 12 }}>
                        Source geometry{" "}
                        <span className="light">preserved STL</span>
                        <br />
                        Native slicer project{" "}
                        <span className="light">
                          {job.toolpath?.slicerProject
                            ? "preserved native 3MF"
                            : "not present"}
                        </span>
                        <br />
                        Final toolpath{" "}
                        <span className="light">
                          {job.toolpath ? "imported G-code" : "not imported"}
                        </span>
                      </p>
                    </div>
                  </>
                )}
              </aside>
            </div>
            <div className="bottom-bar">
              <div className="bottom-note">
                <button
                  className={`preflight-summary ${stepErrors.length ? "has-errors" : ""}`}
                  aria-label="Open job preflight"
                  onClick={() => {
                    showInspector("checks");
                    setPage("prepare");
                    setMobilePane("inspector");
                  }}
                >
                  <AlertTriangle size={13} />
                  {stepErrors.length} preflight{" "}
                  {stepErrors.length === 1 ? "error" : "errors"}
                  <ChevronRight size={12} />
                </button>
                <ShieldCheck size={15} />
                <span>
                  {job.approval
                    ? "Exact manifest approval recorded."
                    : "Source geometry stays tied to its version and hash."}
                  <br />
                  <span style={{ color: "var(--cat-ok)" }}>
                    Fixtures and example profiles are non-manufacturable.
                  </span>
                </span>
              </div>
              <div className="row">
                <button className="btn ghost" onClick={exportProject}>
                  <ArrowDownToLine size={13} />
                  Export project
                </button>
                <button
                  className="btn primary"
                  onClick={() =>
                    setPage(page === "prepare" ? "toolpaths" : "review")
                  }
                >
                  {page === "prepare"
                    ? "Slice & inspect this plate"
                    : "Review manufacturing job"}
                  <ArrowRight size={14} />
                </button>
              </div>
            </div>
          </>
        )}
        {(page === "review" || page === "export") && (
          <div className={`review-page guided-${page}`}>
            <div className="review-layout">
              <div>
                <div className="card">
                  <div
                    className="row"
                    style={{
                      justifyContent: "space-between",
                      marginBottom: 20,
                    }}
                  >
                    <h2 style={{ margin: 0 }}>
                      Review the exact manufacturing job
                    </h2>
                    <span
                      className={`tag ${approvalCurrent ? "green" : "yellow"}`}
                    >
                      {approvalCurrent ? "APPROVED" : "REVIEW REQUIRED"}
                    </span>
                  </div>
                  <Field label="Job name">
                    <input
                      aria-label="Job name"
                      value={job.name}
                      onChange={(e) =>
                        mutate((_, j) => {
                          j.name = e.target.value;
                        }, "Job manifest name changed.")
                      }
                    />
                  </Field>
                  <div className="definition">
                    <span>Source & geometry</span>
                    <span>
                      {job.items.length} part types · {total} copies · explicit
                      mm
                    </span>
                  </div>
                  <div className="definition">
                    <span>Printer / nozzle</span>
                    <span>
                      {job.printer.model} / {job.printer.nozzleDiameter} mm
                    </span>
                  </div>
                  <div className="definition">
                    <span>Build plate</span>
                    <span>
                      {job.printer.plate} ·{" "}
                      {job.printer.buildVolume.join(" × ")} mm
                    </span>
                  </div>
                  <div className="definition">
                    <span>Material mapping</span>
                    <span>
                      {job.material.name} · {job.material.color}
                    </span>
                  </div>
                  <div className="definition">
                    <span>Process settings</span>
                    <span>
                      {job.settings.layerHeight} mm layers ·{" "}
                      {job.settings.walls} walls · {job.settings.infill}% infill
                      · supports {job.settings.supports ? "on" : "off"} ·{" "}
                      {Object.keys(overrides).length} overrides
                    </span>
                  </div>
                  <div className="definition">
                    <span>Slicer identity</span>
                    <span>
                      {job.slicer.id} · {job.slicer.version}
                    </span>
                  </div>
                  <div className="definition">
                    <span>Manifest SHA-256</span>
                    <span className="hash" title={manifestHash}>
                      {manifestHash}
                    </span>
                  </div>
                  <div className="definition">
                    <span>Toolpath SHA-256</span>
                    <span className="hash" title={job.toolpath?.hash}>
                      {job.toolpath?.hash ?? "No toolpath imported"}
                    </span>
                  </div>
                  {job.approval && (
                    <div className="definition">
                      <span>Approval SHA-256</span>
                      <span className="hash">{job.approval.manifestHash}</span>
                    </div>
                  )}
                  {job.items.map((item) => {
                    const p = project.parts.find((p) => p.id === item.partId)!;
                    return (
                      <div className="jobrow" key={item.partId}>
                        <div className="row">
                          <span className="part-thumb">
                            <PartThumbnail part={p} />
                          </span>
                          <div>
                            <h3>{p.name}</h3>
                            <p>
                              {p.source.versionName ?? "Local STL"} ·{" "}
                              {p.source.configuration ?? "explicit local units"}{" "}
                              · {item.quantity} + {item.spareQuantity} backup
                              <br />
                              Rotate {item.orientation.join(" / ")}° · Position{" "}
                              {item.position.join(" / ")} mm
                            </p>
                            <p className="hash" style={{ marginTop: 5 }}>
                              {shortHash(p.geometry.hash)}
                            </p>
                            {p.geometry.warnings?.map((w, k) => (
                              <p className="inline-error" key={k}>
                                Geometry review: {w}
                              </p>
                            ))}
                          </div>
                        </div>
                        <button
                          className="btn small"
                          onClick={() => {
                            setSelectedId(p.id);
                            setPage("prepare");
                          }}
                        >
                          Inspect
                        </button>
                      </div>
                    );
                  })}
                  <button
                    className="linkbutton"
                    style={{ marginTop: 15 }}
                    onClick={() =>
                      download(
                        JSON.stringify(
                          manufacturingManifest(project, job, true),
                          null,
                          2,
                        ),
                        "manufacturing-manifest.json",
                        "application/json",
                      )
                    }
                  >
                    Download inspectable manifest JSON{" "}
                    <ArrowDownToLine size={11} />
                  </button>
                </div>
                <div className="card">
                  <h2>Review history</h2>
                  {job.reviews.length ? (
                    job.reviews
                      .slice()
                      .reverse()
                      .slice(0, 15)
                      .map((event) => (
                        <div className="definition" key={event.id}>
                          <span>
                            {formatDate(event.at)}
                            <br />
                            {event.actor}
                          </span>
                          <span>
                            {event.action}
                            <small
                              style={{
                                display: "block",
                                marginTop: 5,
                                overflowWrap: "anywhere",
                              }}
                            >
                              {event.detail}
                            </small>
                          </span>
                        </div>
                      ))
                  ) : (
                    <p>
                      No review actions yet. Import matching toolpaths, inspect
                      the layers and approve the exact manifest.
                    </p>
                  )}
                </div>
              </div>
              <aside>
                <div className="card exact-approval-panel">
                  <h2>Approval</h2>
                  {(!job.toolpath||!toolpathCurrent)&&<div className={`notice ${['slicing','restoring','waiting','attaching','ready'].includes(sliceSession.phase)?'':'error'}`} role="status">
                    <p>{sliceSession.message||(job.toolpath?.stale?'The plate changed. Slice it again before approval.':job.toolpath?'Checking attached layers…':'This plate needs a matching slice before approval.')}</p>
                    {['slicing','restoring','waiting','attaching'].includes(sliceSession.phase)?<span className="smalltext"><LoaderCircle size={13} className="spin"/> You can stay here; layers attach automatically.</span>:<button className="btn" onClick={()=>void sliceSession.retry()} disabled={busy}>{sliceSession.slice?.status==='succeeded'?'Retry native layer attachment':'Find this plate’s saved slice'}</button>}
                    <button className="linkbutton" onClick={()=>setPage('toolpaths')}>Open slicing and layers</button>
                  </div>}
                  {isFixtureJob(project,job) && (
                    <div className="notice coral" style={{ marginBottom: 15 }}>
                      Demonstration only. This job contains fixture geometry or a demonstration toolpath. Any exported package is <b>NON-MANUFACTURABLE</b>
                      .
                    </div>
                  )}
                  <Field
                    label="Reviewer / operator name"
                    hint="Local review identity is self-reported; this is not an authenticated signature."
                  >
                    <input
                      aria-label="Reviewer name"
                      placeholder="e.g. Alex · manufacturing lead"
                      value={actor}
                      onChange={(e) => setActor(e.target.value)}
                    />
                  </Field>
                  {!isFixtureJob(project,job)&&(!job.printer.tested||!job.material.tested)&&<>
                    <p className="smalltext">{profileQualificationCurrent(job)?'This exact setup was confirmed by an operator.':'Confirm this setup to enable manufacturing approval.'} Foundry has not physically qualified the printer or filament.</p>
                    {!profileQualificationCurrent(job)&&<label className="togglelabel"><input type="checkbox" aria-label="Confirm print setup" checked={setupConfirm} onChange={event=>setSetupConfirm(event.target.checked)}/>I checked this printer, nozzle, plate, filament and native machine routines for this print.</label>}
                  </>}
                  <label className="togglelabel">
                    <input
                      aria-label="Confirm toolpath review"
                      type="checkbox"
                      checked={reviewConfirm}
                      onChange={(e) => setReviewConfirm(e.target.checked)}
                    />
                    I inspected the actual toolpath layers, feature types,
                    travel and warnings.
                  </label>
                  <label className="togglelabel">
                    <input
                      aria-label="Confirm manufacturing manifest"
                      type="checkbox"
                      checked={manifestConfirm}
                      onChange={(e) => setManifestConfirm(e.target.checked)}
                    />
                    I reviewed the source version, geometry, units, quantities,
                    placement, orientation, machine, material, slicer and
                    settings.
                  </label>
                  <button
                    className="btn primary fullwidth"
                    disabled={
                      busy ||
                      !toolpathCurrent ||
                      blockingApprovalIssues.length > 0 ||
                      !actor.trim() ||
                      !reviewConfirm ||
                      !manifestConfirm
                      ||(!isFixtureJob(project,job)&&(!job.printer.tested||!job.material.tested)&&!profileQualificationCurrent(job)&&!setupConfirm)
                    }
                    onClick={approve}
                  >
                    <ShieldCheck size={14} />
                    {approvalCurrent
                      ? "Reconfirm exact job"
                      : "Approve exact job"}
                  </button>
                  {approvalCurrent && (
                    <p className="smalltext" style={{ marginTop: 12 }}>
                      <CheckCircle2 size={12} /> Approved by{" "}
                      {job.approval?.actor}. Future manufacturing changes
                      invalidate this approval.
                    </p>
                  )}
                </div>
                {sliceSession.slice?.result?.slicerProject&&sliceSession.slice.manifestHash===manifestHash&&toolpathCurrent&&<div className="card"><PrintHandoffPanel project={project} job={job} slice={sliceSession.slice} current={true} onError={fail}/></div>}
                {page === "export" && (
                  <div className="card">
                    <h2>Operator-controlled export</h2>
                    {!approvalCurrent && (
                      <div className="notice error" role="status">
                        <b>Approval needed</b>
                        <p>
                          Review and approve the exact current job before
                          exporting. Changes to manufacturing inputs require a
                          new matching result and approval.
                        </p>
                        <button
                          className="btn"
                          onClick={() => setPage("review")}
                        >
                          Return to approval <ArrowRight size={13} />
                        </button>
                      </div>
                    )}
                    <p>
                      No machine connection is configured. Assignment and export
                      do not mean a printer accepted or started this job.
                    </p>
                    <div className="checklist">
                      {(
                        Object.keys(checksLabels) as (keyof OperatorChecks)[]
                      ).map((key) => (
                        <label className="togglelabel" key={key}>
                          <input
                            aria-label={checksLabels[key]}
                            type="checkbox"
                            checked={checks[key]}
                            onChange={(e) =>
                              setChecks({ ...checks, [key]: e.target.checked })
                            }
                          />
                          {checksLabels[key]}
                        </label>
                      ))}
                    </div>
                    <p className="smalltext">
                      These are operator attestations. Software cannot verify
                      physical conditions. Required before physical release;
                      demonstration packages remain non-manufacturable.
                    </p>
                    <button
                      className="btn fullwidth"
                      style={{ marginTop: 15 }}
                      disabled={!approvalCurrent || busy || !actor.trim()}
                      onClick={exportPackage}
                    >
                      <PackageCheck size={14} />
                      Export approved package
                    </button>
                    <p className="smalltext" style={{ marginTop: 10 }}>
                      ZIP contains versioned manifest, geometry, original
                      imports, settings, toolpath, project, review history and
                      SHA-256 checksums. Repeated export reuses the release
                      record.
                    </p>
                  </div>
                )}
                {page === "review" && (
                  <button
                    className="btn primary fullwidth continue-export"
                    disabled={!approvalCurrent}
                    onClick={() => setPage("export")}
                  >
                    Continue to export <ArrowRight size={14} />
                  </button>
                )}
                {page === "export" && (
                  <div className="card">
                    <h2>Assign for operator review</h2>
                    <Field label="Operator or station">
                      <input
                        aria-label="Operator assignment"
                        placeholder="e.g. Jordan · printer station 1"
                        value={assignee}
                        onChange={(e) => setAssignee(e.target.value)}
                      />
                    </Field>
                    <button
                      className="btn fullwidth"
                      disabled={!approvalCurrent || !assignee.trim() || busy}
                      onClick={() =>
                        run(async (p, j) => {
                          await assignJob(
                            p,
                            j,
                            assignee,
                            actor || "Team member",
                          );
                          notify(
                            "Assigned for operator review. No printer dispatch was performed.",
                          );
                          setPage("queue");
                        })
                      }
                    >
                      <ClipboardList size={14} />
                      Assign job
                    </button>
                  </div>
                )}
              </aside>
            </div>
          </div>
        )}
        {page === "queue" && (
          <ManufacturingQueue
            project={project}
            busy={busy}
            onOpenJob={(id) => {
              mutate((p) => {
                p.activeJobId = id;
              });
              const target = project.jobs.find((j) => j.id === id)!;
              setSelectedId(
                target.items[0]?.partId ?? project.parts[0]?.id ?? "",
              );
              setPage("prepare");
              setMobilePane("viewport");
            }}
            onCreateJob={() => {
              mutate((p) => {
                const next = createJob([], "New manufacturing batch");
                p.jobs.push(next);
                p.activeJobId = next.id;
              });
              setPage("prepare");
              setInspectorTab("part");
            }}
            onSaveProject={saveProject}
            onExportProject={exportProject}
            onImportProject={() => projectFile.current?.click()}
          />
        )}
        {page === "help" && (
          <div className="help-page">
            <div className="review-layout">
              <div>
                <div className="card">
                  <h2>Setup and connections</h2>
                  <p>
                    Catalyst Foundry keeps immutable source geometry,
                    manufacturing orientation, settings, imported toolpaths and
                    local approvals together. The current vertical slice runs
                    without credentials, machine access or a cloud slicer.
                  </p>
                  <div className="definition">
                    <span>Onshape</span>
                    <span className="row">
                      <span
                        className={`tag ${connectionState.onshape?.available ? "green" : "yellow"}`}
                      >
                        {connectionState.onshape?.available
                          ? "CONFIGURED"
                          : "LOGIN SETUP NEEDED"}
                      </span>{" "}
                      {connectionState.onshape?.reason ??
                        "Checking local connection status."}
                    </span>
                  </div>
                  <details
                    className="advanced-disclosure"
                    open={!connectionState.onshape?.available}
                  >
                    <summary>Enable authorised Onshape intake</summary>
                    <ol className="setup-steps">
                      <li>
                        An authorised team administrator must complete Onshape
                        OAuth setup and login separately. Foundry does not
                        create credentials or implement token refresh.
                      </li>
                      <li>
                        Store the resulting access token in a server-only UTF-8
                        file. Set <code>ONSHAPE_ACCESS_TOKEN_FILE</code> to its
                        absolute path and restart Foundry. Never put it in the
                        browser or a project file.
                      </li>
                      <li>
                        Open Select design and choose a document, immutable
                        version, configuration and explicitly classified parts.
                        Expired login or missing document permissions will
                        require correction.
                      </li>
                    </ol>
                    <p className="smalltext">
                      Full setup and required live qualification:
                      docs/ONSHAPE.md. No private Onshape account has been
                      tested in this cloud environment.
                    </p>
                  </details>
                  <div className="definition">
                    <span>Geometry</span>
                    <span>
                      Real ASCII/binary STL. Explicit mm/in conversion. Original
                      bytes preserved. No repair, solid splitting or merging.
                    </span>
                  </div>
                  <div className="definition">
                    <span>Toolpaths</span>
                    <span>
                      Real linear G-code preview. G0/G1, G20/G21, G90/G91,
                      M82/M83 and G92 supported. Unsupported motion commands
                      block approval. See docs/SLICING.md.
                    </span>
                  </div>
                  <div className="definition">
                    <span>Bambu Studio CLI</span>
                    <span>{capability}</span>
                  </div>
                  <div className="definition">
                    <span>Printer handoff</span>
                    <span>
                      Approved ZIP export only. Bambu Connect integration
                      remains unavailable pending a verified supported workflow.
                    </span>
                  </div>
                  <div className="definition">
                    <span>Laser cutting</span>
                    <span>
                      Deferred until a machine, supported file formats,
                      material/thickness rules, settings and operator checks are
                      verified.
                    </span>
                  </div>
                </div>
                <div className="card">
                  <h2>Strength guidance has limits</h2>
                  <p>
                    Geometry categories are review aids, not FEA. No
                    force-loading results, stress maps, safety factors or
                    guarantees are generated. Reviewed Onshape simulation
                    studies can currently be recorded as manual context in the
                    use-case form; public numerical-result access has not been
                    established. A stress magnitude image alone does not
                    determine a print orientation.
                  </p>
                  <button
                    className="btn"
                    style={{ marginTop: 15 }}
                    onClick={() => setGuideOpen(true)}
                  >
                    <Sparkles size={14} />
                    Review load context
                  </button>
                </div>
              </div>
              <aside>
                <div className="card">
                  <h2>Included documentation</h2>
                  <p>
                    Read the source checkout for detailed setup and
                    verification:
                  </p>
                  <div className="definition">
                    <span>Launch</span>
                    <span>README.md</span>
                  </div>
                  <div className="definition">
                    <span>Onshape setup</span>
                    <span>docs/ONSHAPE.md</span>
                  </div>
                  <div className="definition">
                    <span>Slicer profiles</span>
                    <span>docs/SLICING.md</span>
                  </div>
                  <div className="definition">
                    <span>Verification</span>
                    <span>docs/VERIFICATION.md</span>
                  </div>
                  <div className="definition">
                    <span>Architecture</span>
                    <span>docs/ARCHITECTURE.md</span>
                  </div>
                </div>
                <div className="card">
                  <h2>Connection recovery</h2>
                  <p>
                    If save fails, use Export project to retain your work.
                    Restart npm run dev, then retry. Live services are never
                    represented as connected by fixture data.
                  </p>
                  <button
                    className="btn fullwidth"
                    style={{ marginTop: 15 }}
                    onClick={exportProject}
                  >
                    Export recovery copy
                  </button>
                </div>
              </aside>
            </div>
          </div>
        )}
        {page==='sync'&&<main className="sync-page"><SyncWorkspace client={desktopSyncClient} currentParts={project.parts} currentLabel={project.name} onUseParts={(parts,workOrder)=>acceptParts(parts,{organize:true,workOrder})} workOrder={project.manufacturingOrder??''} onWorkOrder={value=>mutate(p=>{p.manufacturingOrder=value;})} allowConfiguration onUseSource={source=>{mutate(p=>{p.manufacturingOrder=source.work_order;});setSourceInitialTab('onshape');setSourceInitialUrl(source.source_url);setSourceOpen(true);}} onConnected={()=>{void fetch('/api/capabilities').then(r=>r.json()).then(setConnectionState).catch(()=>{});}}/></main>}
        <footer className="footer-app">
          <span>mm · Euler XYZ · Immutable source geometry</span>
          <span>
            Onshape:{" "}
            {connectionState.onshape?.available
              ? "configured server access"
              : "setup needed"}{" "}
            · Slicer:{" "}
            {connectionState.slicing?.available
              ? "configured local CLI"
              : "setup needed / imported G-code"}{" "}
            · Printing reviewed in Bambu Connect
          </span>
        </footer>
      </div>
      <input
        ref={projectFile}
        type="file"
        accept=".json,.catalyst"
        style={{ display: "none" }}
        onChange={(e) => {
          void importProject(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={toolpathFile}
        type="file"
        accept=".gcode,.gco,.gc"
        style={{ display: "none" }}
        onChange={(e) => {
          void chooseToolpath(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {resetOpen && (
        <Modal
          title="Reset process overrides"
          subtitle="Review the settings that will return to the current base profile."
          onClose={() => setResetOpen(false)}
          footer={
            <>
              <small>
                Geometry and source artifacts are preserved. The current
                toolpath will become stale.
              </small>
              <button
                className="btn primary"
                onClick={() => {
                  mutate((_, j) => {
                    j.settings = { ...j.baseSettings };
                  }, "Process overrides reset after explicit review.");
                  setResetOpen(false);
                }}
              >
                Reset to base profile
              </button>
            </>
          }
        >
          <div>
            {Object.entries(overrides).map(([key, value]) => (
              <div className="definition" key={key}>
                <span>{key}</span>
                <span>
                  {String(value.value)} → {String(value.base)}
                </span>
              </div>
            ))}
            {!Object.keys(overrides).length && (
              <p className="smalltext">No process overrides are present.</p>
            )}
          </div>
        </Modal>
      )}
      {presetOpen && (
        <Modal
          title="Save team process preset"
          subtitle="Exact printer, nozzle, plate, filament and settings are retained as an untested example."
          onClose={() => setPresetOpen(false)}
          footer={
            <>
              <small>Presets do not establish physical validation.</small>
              <button
                className="btn primary"
                disabled={!presetName.trim()}
                onClick={commitPreset}
              >
                Save preset
              </button>
            </>
          }
        >
          <Field label="Preset name">
            <input
              aria-label="Preset name"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
            />
          </Field>
        </Modal>
      )}
      {revokeOpen && (
        <Modal
          title="Revoke toolpath mapping"
          subtitle="Keep the artifact and history, but withdraw its mapping and approval."
          onClose={() => setRevokeOpen(false)}
          footer={
            <>
              <small>A new matching result and review will be required.</small>
              <button
                className="btn primary"
                disabled={!actor.trim() || !revokeReason.trim() || busy}
                onClick={() =>
                  run(async (_p, j) => {
                    revokeToolpathMapping(j, actor, revokeReason);
                    setRevokeOpen(false);
                    notify(
                      "Mapping revoked. Approval and layer review were invalidated.",
                    );
                  })
                }
              >
                Revoke mapping
              </button>
            </>
          }
        >
          <Field label="Reviewer / operator name">
            <input
              aria-label="Mapping reviewer"
              value={actor}
              onChange={(e) => setActor(e.target.value)}
            />
          </Field>
          <Field label="Reason">
            <textarea
              aria-label="Mapping revocation reason"
              value={revokeReason}
              onChange={(e) => setRevokeReason(e.target.value)}
            />
          </Field>
        </Modal>
      )}
      {sourceOpen && (
        <SourceDialog
          initialTab={sourceInitialTab}
          initialOnshapeUrl={sourceInitialUrl}
          initialWorkOrder={project.manufacturingOrder??''}
          onClose={() => {
            setSourceOpen(false);
            setSourceInitialTab("onshape");
            setSourceInitialUrl('');
          }}
          onImport={acceptParts}
          onError={setError}
        />
      )}
      {toolpathOpen && pendingGcode && (
        <Modal
          title="Bind an imported toolpath"
          subtitle="Review the file and its relationship to the current job before attaching it."
          onClose={() => setToolpathOpen(false)}
          footer={
            <>
              <small>
                Toolpath SHA-256 is computed from the original bytes.
              </small>
              <button
                className="btn primary"
                disabled={
                  !mappingConfirmed || !pendingPreview?.canApprove || busy
                }
                onClick={attach}
              >
                Attach to current manifest
                <ArrowRight size={13} />
              </button>
            </>
          }
        >
          <div className={`notice ${pendingGcode.fixture ? "coral" : "info"}`}>
            <b>
              {pendingGcode.fixture
                ? "NON-MANUFACTURABLE DEMONSTRATION"
                : "IMPORTED G-CODE · OPERATOR MAPPING REQUIRED"}
            </b>
            <br />
            {pendingGcode.fixture
              ? "This manually authored fixture contains actual G-code moves for viewer testing. It was not sliced from the selected CAD. Attaching it creates only a demonstration job."
              : "Foundry cannot prove that an external slicer used this geometry or settings. Verify the complete mapping in the external slicer before confirming."}
          </div>
          <div className="definition">
            <span>File</span>
            <span>{pendingGcode.name}</span>
          </div>
          <div className="definition">
            <span>Parsed output</span>
            <span>
              {pendingPreview?.layers.length ?? 0} layers ·{" "}
              {pendingPreview?.segmentCount ?? 0} linear moves
            </span>
          </div>
          <div className="definition">
            <span>Coordinate bounds</span>
            <span>
              {pendingPreview
                ? `${pendingPreview.bounds.min.map((n) => n.toFixed(1)).join(", ")} → ${pendingPreview.bounds.max.map((n) => n.toFixed(1)).join(", ")} mm`
                : "Parsing failed"}
            </span>
          </div>
          <div className="definition">
            <span>Manufacturing inputs</span>
            <span className="hash">{manifestHash}</span>
          </div>
          {!pendingGcode.fixture && (
            <div className="fieldrow">
              <Field label="Actual slicer name">
                <input
                  aria-label="Actual slicer name"
                  value={externalSlicer}
                  onChange={(e) => setExternalSlicer(e.target.value)}
                />
              </Field>
              <Field label="Actual slicer version">
                <input
                  aria-label="Actual slicer version"
                  value={externalVersion}
                  onChange={(e) => setExternalVersion(e.target.value)}
                />
              </Field>
            </div>
          )}
          {pendingPreview?.warnings.map((w, i) => (
            <p className="inline-error" key={i}>
              {w}
            </p>
          ))}
          {!pendingPreview?.canApprove && (
            <div className="notice error" style={{ marginTop: 14 }}>
              This file cannot be approved. Unsupported or missing commands make
              the preview incomplete. Re-export supported linear G-code with
              explicit units and extrusion mode.
            </div>
          )}
          <label className="togglelabel">
            <input
              aria-label="Confirm imported toolpath mapping"
              type="checkbox"
              checked={mappingConfirmed}
              onChange={(e) => setMappingConfirmed(e.target.checked)}
            />
            {pendingGcode.fixture
              ? "I understand this is a demonstration binding and the package must not be manufactured."
              : "I verified this toolpath corresponds to the exact current source geometry, quantities, units, orientation, placement, printer/nozzle/plate, filament and process settings."}
          </label>
          <p className="smalltext">
            Any manufacturing change after binding makes this toolpath stale.
            Operator mapping is an attestation, not a verified slicing
            calculation.
          </p>
        </Modal>
      )}
      {guideOpen && (
        <Modal
          title="Orientation & strength review"
          subtitle="Confirm the application before comparing manufacturing orientations."
          onClose={() => setGuideOpen(false)}
          footer={
            <>
              <small>Heuristics are not FEA or a strength guarantee.</small>
              <button
                className="btn primary"
                onClick={() => setGuideOpen(false)}
              >
                Save review context
                <Check size={13} />
              </button>
            </>
          }
        >
          <div className="notice">
            Loads, constraints and environment are not inferred from shape or
            CAD colour. Review a physical prototype and validated
            material/process data for the intended use.
          </div>
          <div className="fieldrow">
            <Field label="Intended use / mounting interfaces">
              <textarea
                aria-label="Intended use"
                placeholder="e.g. sensor bracket fixed by two M4 bolts…"
                value={job.useCase.purpose}
                onChange={(e) =>
                  mutate((_, j) => {
                    j.useCase.purpose = e.target.value;
                    j.useCase.confirmed = false;
                  }, "Use-case context changed.")
                }
              />
            </Field>
            <Field label="Expected loads & directions">
              <textarea
                aria-label="Load directions"
                placeholder="Direction, magnitude, cyclic/impact loads; unknown is acceptable."
                value={job.useCase.loadDirection}
                onChange={(e) =>
                  mutate((_, j) => {
                    j.useCase.loadDirection = e.target.value;
                    j.useCase.confirmed = false;
                  }, "Load context changed.")
                }
              />
            </Field>
          </div>
          <div className="fieldrow">
            <Field label="Constraints & critical surfaces">
              <textarea
                aria-label="Critical constraints"
                placeholder="Fasteners, bearing fits, datums, required tolerances…"
                value={job.useCase.constraints}
                onChange={(e) =>
                  mutate((_, j) => {
                    j.useCase.constraints = e.target.value;
                    j.useCase.confirmed = false;
                  }, "Constraints changed.")
                }
              />
            </Field>
            <Field label="Operating conditions / reviewed study reference">
              <textarea
                aria-label="Operating conditions"
                placeholder="Temperature, moisture, chemicals; link/name of reviewed simulation study…"
                value={job.useCase.operatingConditions}
                onChange={(e) =>
                  mutate((_, j) => {
                    j.useCase.operatingConditions = e.target.value;
                    j.useCase.confirmed = false;
                  }, "Operating conditions changed.")
                }
              />
            </Field>
          </div>
          <label className="togglelabel">
            <input
              type="checkbox"
              aria-label="Confirm load context"
              checked={job.useCase.confirmed}
              disabled={
                !job.useCase.purpose.trim() ||
                !job.useCase.loadDirection.trim() ||
                !job.useCase.constraints.trim() ||
                !job.useCase.operatingConditions.trim()
              }
              onChange={(e) =>
                mutate((_, j) => {
                  j.useCase.confirmed = e.target.checked;
                }, "Use-case review confirmation changed.")
              }
            />
            The use case, loads, constraints and operating conditions were
            reviewed by the team.
          </label>
          <div className="divider" />
          <h3>Candidate orientations · compare with the confirmed use case</h3>
          {selectedPart && (
            <PreparationAssistant
              project={project}
              job={job}
              partId={selectedPart.id}
              onOrientation={(orientation) => {
                editItem({ orientation });
                setInstalled(false);
                setGuideOpen(false);
                setPage("prepare");
                setMobilePane("viewport");
              }}
              onPlacement={(orientation, position) => {
                editItem({ orientation, position });
                setInstalled(false);
                setGuideOpen(false);
                setPage("prepare");
                setMobilePane("viewport");
              }}
              onReviewContext={() =>
                document
                  .querySelector<HTMLElement>('[aria-label="Intended use"]')
                  ?.focus()
              }
            />
          )}
          <p className="smalltext">
            These candidates are geometric alternatives, not a ranked optimum.
            Assembly mounting context is shown in installed orientation. No
            print-time or material comparisons are shown because matching slicer
            results are unavailable. Numerical Onshape study integration is
            deferred; record reviewed study references manually.
          </p>
        </Modal>
      )}
      {revisionOpen && (
        <Modal
          title="Source revision review"
          subtitle="Approved geometry is never replaced in place."
          onClose={() => setRevisionOpen(false)}
          footer={
            <>
              <small>
                Live revision checks unavailable · fixture comparison only
              </small>
              <button className="btn" onClick={() => setRevisionOpen(false)}>
                Keep pinned geometry
              </button>
            </>
          }
        >
          <div className="notice info">
            Current jobs remain pinned to their original immutable source
            version and geometry hash. This fixture demonstrates a newer version
            for comparison.
          </div>
          {revisionLoading && (
            <div className="loading">
              <LoaderCircle className="spin" size={15} />
              Comparing exported geometry and source metadata…
            </div>
          )}
          {revisionError && <p className="inline-error">{revisionError}</p>}
          {!revisionLoading && !revisionChanges.length && (
            <p className="smalltext" style={{ marginTop: 15 }}>
              {project.parts.some((p) => p.source.kind === "fixture")
                ? "No source changes in the proposed version."
                : "No fixture sources in this project. Live revision comparison is not implemented; import a reviewed immutable version into a separate job."}
            </p>
          )}
          {revisionChanges.map((change) => (
            <div className="definition" key={change.partId}>
              <span>{change.name}</span>
              <span>
                {change.changes.join(" · ")}
                <small style={{ display: "block", marginTop: 7 }}>
                  Previous:{" "}
                  <span className="hash">{shortHash(change.previousHash)}</span>
                  <br />
                  Proposed:{" "}
                  <span className="hash">{shortHash(change.proposedHash)}</span>
                </small>
              </span>
            </div>
          ))}
          <button
            className="btn primary"
            disabled={
              !proposedRevision.length ||
              revisionLoading ||
              !revisionChanges.length
            }
            style={{ marginTop: 20 }}
            onClick={() => {
              mutate((p) => {
                for (const part of proposedRevision)
                  if (!p.parts.some((v) => v.id === part.id))
                    p.parts.push(part);
                const next = createJob(
                  proposedRevision,
                  "Intake · V19 revision review",
                );
                p.jobs.push(next);
                p.activeJobId = next.id;
              });
              setSelectedId(proposedRevision[0]?.id ?? "");
              setRevisionOpen(false);
              setPage("prepare");
              notify(
                "New revision job created. Previous jobs and geometry remain pinned. Review placement and reslice.",
              );
            }}
          >
            Create separate revision job
            <ArrowRight size={13} />
          </button>
          <p className="smalltext" style={{ marginTop: 12 }}>
            The new job has no toolpath or approval. Check dimensions,
            placements and quantities before slicing. Existing approved jobs
            retain their original source and history.
          </p>
        </Modal>
      )}
      {connectSetupOpen&&<Modal title="Connect a Bambu printer" subtitle="Install the official companion, then choose cloud login or LAN-only pairing." onClose={()=>setConnectSetupOpen(false)}><BambuConnectSetup/></Modal>}
      {updatesOpen&&<Modal title="App updates" subtitle="Signed internal releases, with a restart when you are ready." onClose={()=>setUpdatesOpen(false)}><AppUpdates canRestart={!busy&&!slicingActive&&!restarting} onSave={saveProject} onRestartLock={setRestarting}/></Modal>}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={16} />
          {toast}
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
