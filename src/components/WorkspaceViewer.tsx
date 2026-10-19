import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Expand, Grid2X2, Rotate3D, ScanLine, View } from 'lucide-react';
import type { Part, JobItem } from '../domain/model';
import { layoutItem } from '../domain/invariants';
import { installedTransformMatrix, manufacturingFrame } from './viewer-geometry';
import { cameraFrameForBounds, resizedCameraFrame, type CameraFrame, type CameraInsets, type CameraViewport } from './camera-frame';
import './workspace-viewer.css';
import { buildPathBuffers, pathDrawRanges, type PathBuffer } from './toolpath-buffers';
import {createToolpathBeads} from './toolpath-beads';
import {ViewerMeshCache} from './viewer-mesh-cache';
import {frameScheduler,viewerPixelRatio} from './viewer-scheduler';
import {viewerBudget,type ViewerQuality} from './viewer-quality';
import {partInstances} from './part-instances';

export type ToolpathFeature = 'wall' | 'infill' | 'support' | 'travel' | 'other';
export interface ViewerToolpath {
  segments?: readonly {
    from: readonly [number, number, number]; to: readonly [number, number, number];
    feature: ToolpathFeature; layer: number;
    width?:number;height?:number;printMove?:boolean;
  }[];
  layers?: readonly unknown[];
  renderBuffers?:PathBuffer[];
}
export interface WorkspaceViewerProps {
  parts: readonly Part[];
  items: readonly JobItem[];
  selectedPartId?: string;
  onSelectPart?: (id: string) => void;
  mode: 'parts' | 'plate' | 'toolpath';
  toolpath?: ViewerToolpath;
  /** The zero-based upper visible layer. Lower layers remain visible for context. */
  layer?: number;
  showTravel?: boolean;
  visibleFeatures?: Partial<Record<ToolpathFeature, boolean>>;
  plate?: readonly [number, number, number];
  /** Installed transforms are an inspection mode only, never manufacturing orientation. */
  installedOrientation?: boolean;
  filamentColor?:string;
  pathOffset?:readonly [number,number];
  beadWidth?:number;beadHeight?:number;pathColorMode?:'filament'|'feature';
  placementTool?:'orbit'|'move'|'face';
  onMovePart?:(id:string,position:[number,number,number])=>void;
  onPlaceFace?:(id:string,normal:[number,number,number])=>void;
  className?: string;
}

interface ViewerEngine {
  scene: THREE.Scene; camera: THREE.PerspectiveCamera; renderer: THREE.WebGLRenderer;
  controls: OrbitControls; content: THREE.Group; platform: THREE.Group;
  fit: (view?: 'iso' | 'top' | 'front') => void; render: () => void;
  bounds: THREE.Box3; plate: readonly [number, number, number];
  viewport: CameraViewport; insets: CameraInsets; hasFit: boolean;
  dispose: () => void;
}
const colors: Record<ToolpathFeature, number> = {
  wall: 0xe94560, infill: 0xb5a1e0, support: 0x76c8b3, travel: 0x7f8a9e, other: 0xe9cb82,
};
function cameraInsets(host: HTMLElement): CameraInsets {
  const hostBox = host.getBoundingClientRect();
  const root = host.parentElement;
  const toolbar = root?.querySelector('.workspace-viewer__tools')?.getBoundingClientRect();
  const topline = root?.querySelector('.workspace-viewer__topline')?.getBoundingClientRect();
  const preparation=root?.closest('.viewer-stage')?.querySelector('.plate-tools')?.getBoundingClientRect();
  const footer = root?.querySelector('.workspace-viewer__footer')?.getBoundingClientRect();
  return {
    left: Math.max(16,toolbar&&toolbar.height>toolbar.width?toolbar.right-hostBox.left+12:0,preparation&&preparation.height>preparation.width?preparation.right-hostBox.left+12:0),
    right: 20,
    top: Math.max(20, topline ? topline.bottom - hostBox.top + 12 : 20,preparation&&preparation.width>=preparation.height?preparation.bottom-hostBox.top+12:0,
      toolbar && toolbar.width >= toolbar.height ? toolbar.bottom - hostBox.top + 12 : 0),
    bottom: footer ? Math.max(20, hostBox.bottom - footer.top + 12) : 20,
  };
}
function disposeTree(group: THREE.Object3D, sharedGeometry=false) {
  const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>();
  group.traverse(object => {
    const item = object as THREE.Mesh;
    if(object instanceof THREE.InstancedMesh)object.dispose();
    if(item.geometry&&!(sharedGeometry&&object.userData.sharedGeometry))geometries.add(item.geometry);
    if (Array.isArray(item.material)) item.material.forEach(material => materials.add(material));
    else if(item.material)materials.add(item.material);
  });
  geometries.forEach(geometry=>geometry.dispose());materials.forEach(material=>material.dispose());
  group.clear();
}
function addLine(points: THREE.Vector3[], color: number, opacity = 1) {
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
}
function createPlatform(plate: readonly [number, number, number]) {
  const [width, depth] = plate;
  const group = new THREE.Group();
  const surface = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshStandardMaterial({
    color: 0x22242a, roughness: .97, metalness: .03, side: THREE.DoubleSide,
  }));
  surface.position.set(width / 2, depth / 2, -.55); surface.receiveShadow = true;
  group.add(surface);
  const vertices: number[] = [];
  for (let x = 0; x <= width; x += 10) vertices.push(x, 0, -.4, x, depth, -.4);
  for (let y = 0; y <= depth; y += 10) vertices.push(0, y, -.4, width, y, -.4);
  const grid = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x9a9ba1, transparent: true, opacity: .12 }));
  grid.geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); grid.name = 'plate-grid'; group.add(grid);
  group.add(addLine([new THREE.Vector3(0, 0, -.3), new THREE.Vector3(width, 0, -.3), new THREE.Vector3(width, depth, -.3), new THREE.Vector3(0, depth, -.3), new THREE.Vector3(0, 0, -.3)], 0x99a5ab, .55));
  // The corner marks make the bed limits visible independently of the grid.
  for (const [x, y, dx, dy] of [[0, 0, 1, 1], [width, 0, -1, 1], [width, depth, -1, -1], [0, depth, 1, -1]]) {
    group.add(addLine([new THREE.Vector3(x + dx * 11, y, -.2), new THREE.Vector3(x, y, -.2), new THREE.Vector3(x, y + dy * 11, -.2)], 0x9a9ba1, .85));
  }
  const origin = new THREE.Vector3(0, 0, .1);
  group.add(new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), origin, 18, 0xd47d76, 3, 1.5));
  group.add(new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), origin, 18, 0x77ad9a, 3, 1.5));
  return group;
}

/** Real STL meshes and parsed G-code, with no geometry repair, scaling, or invented paths. */
export function WorkspaceViewer({ parts, items, selectedPartId, onSelectPart, mode, toolpath, layer,
  showTravel = false, visibleFeatures, plate = [256, 256, 256], installedOrientation = false, filamentColor = '#d9d9d9',pathOffset=[0,0],beadWidth=.42,beadHeight=.2,pathColorMode='filament',placementTool='orbit',onMovePart,onPlaceFace,className = '',
}: WorkspaceViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<ViewerEngine | null>(null);
  const meshCache=useRef<ViewerMeshCache|undefined>(undefined);
  const frames=useRef(new Map<string,ReturnType<typeof manufacturingFrame>>());
  const selectRef = useRef(onSelectPart);
  const pathObjects = useRef<({kind:'beads';buffer:PathBuffer;mesh:ReturnType<typeof createToolpathBeads>}|{kind:'lines';buffer:PathBuffer;context:THREE.LineSegments;active:THREE.LineSegments})[]>([]);
  const interaction=useRef({placementTool,onMovePart,onPlaceFace,mode,selectedPartId,items});interaction.current={placementTool,onMovePart,onPlaceFace,mode,selectedPartId,items};
  const previousMode = useRef<string>('');
  const hasContent = useRef(false);
  const previousPart = useRef<string | undefined>(undefined);
  const previousInstalled = useRef(false);
  const [error, setError] = useState('');
  const [geometryErrors, setGeometryErrors] = useState<string[]>([]);
  const [meshLoading,setMeshLoading]=useState(false);
  const [gridVisible, setGridVisible] = useState(true);
  const [view, setView] = useState<'iso' | 'top' | 'front'>('iso');
  const [quality,setQuality]=useState<ViewerQuality>('auto');
  const qualityRef=useRef<ViewerQuality>(quality);qualityRef.current=quality;
  const detailRef=useRef({triangles:0,moving:false,update:()=>{}});
  const qualityChanged=useRef(false);
  useEffect(()=>{let live=true;void fetch('/api/preferences').then(r=>r.json()).then(value=>{if(live&&!qualityChanged.current&&['auto','quality','economy'].includes(value.viewerQuality))setQuality(value.viewerQuality);}).catch(()=>{});return()=>{live=false;};},[]);
  useEffect(()=>{detailRef.current.update();},[quality]);
  const chooseQuality=(value:ViewerQuality)=>{qualityChanged.current=true;setQuality(value);void fetch('/api/preferences',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({viewerQuality:value})}).catch(()=>{});};
  selectRef.current = onSelectPart;
  // Parent UI renders may create equivalent arrays/objects. Rebuild GPU content only
  // when the immutable geometry identity or a relevant manufacturing value changes.
  const partsKey = useMemo(()=>JSON.stringify(parts.map(part => [part.id, part.name, part.geometry.hash, part.geometry.dimensions, installedOrientation ? part.source.occurrences : null, installedOrientation ? part.source.installedTransformUnits : null])),[parts,installedOrientation]);
  const itemsKey = useMemo(()=>JSON.stringify(items.map(item => [item.partId, item.quantity, item.spareQuantity, item.orientation, item.position,item.copySpacing])),[items]);
  const displaySelection = mode === 'parts' ? selectedPartId : undefined;
  const featuresKey = (['wall', 'infill', 'support', 'travel', 'other'] as const).map(feature => visibleFeatures?.[feature] === false ? '0' : '1').join('');
  const presentation=useRef({layer,visibleFeatures,showTravel,filamentColor,pathColorMode,selectedPartId});presentation.current={layer,visibleFeatures,showTravel,filamentColor,pathColorMode,selectedPartId};
  const present=()=>{
    const state=presentation.current;
    for(const paths of pathObjects.current){
      const ranges=pathDrawRanges(paths.buffer,state.layer),visible=state.visibleFeatures?.[paths.buffer.feature]!==false&&(paths.buffer.feature!=='travel'||state.showTravel);
      if(paths.kind==='beads'){paths.mesh.geometry.instanceCount=(ranges.context.count+ranges.active.count)/2;paths.mesh.visible=visible&&paths.mesh.geometry.instanceCount>0;paths.mesh.material.color.set(state.pathColorMode==='feature'?colors[paths.buffer.feature]:paths.buffer.feature==='support'?0x93b5a7:state.filamentColor);}
      else{paths.context.visible=visible&&ranges.context.count>0;paths.active.visible=visible&&ranges.active.count>0;paths.context.geometry.setDrawRange(ranges.context.start,ranges.context.count);paths.active.geometry.setDrawRange(ranges.active.start,ranges.active.count);}
    }
    engineRef.current?.content.traverse(object=>{
      if(object.userData.partId&&object instanceof THREE.Mesh&&object.material instanceof THREE.MeshStandardMaterial)object.material.color.set(/^#[0-9a-f]{6}$/i.test(state.filamentColor)?state.filamentColor:'#d9d9d9');
      if(object.userData.selectionPartId&&object instanceof THREE.LineSegments){const selected=!state.selectedPartId||state.selectedPartId===object.userData.selectionPartId,material=object.material as THREE.LineBasicMaterial;material.color.set(selected?0xf3f3f3:0x34363d);material.opacity=selected?.55:.24;}
    });
    engineRef.current?.render();
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // React StrictMode can recreate this engine while preserving component refs.
    // Every fresh engine needs its own initial fit once content is mounted.
    previousMode.current = ''; hasContent.current = false; previousPart.current = undefined; previousInstalled.current = false;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' }); }
    catch { setError('The 3D workspace needs WebGL. Enable browser hardware acceleration, then reload this page. Your project is preserved.'); return; }
    renderer.setPixelRatio(viewerPixelRatio(host.clientWidth,host.clientHeight,window.devicePixelRatio));
    renderer.setClearColor(0x0d0e12, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.setAttribute('aria-label', 'Interactive 3D manufacturing workspace. Drag to orbit, right-drag to pan, scroll to zoom.');
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.tabIndex = 0;
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, .1, 20000); camera.up.set(0, 0, 1);
    camera.position.set(440, -370, 340);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(128, 128, 10); controls.update(); controls.enableDamping = false;
    controls.minDistance = 5; controls.maxDistance = 6000;
    controls.maxPolarAngle = Math.PI * .96;
    controls.screenSpacePanning = true;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x5b6168, .85));
    const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(100, -200, 500); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024); key.shadow.camera.left = -400; key.shadow.camera.right = 400;
    key.shadow.camera.top = 400; key.shadow.camera.bottom = -400; key.shadow.camera.far = 1000;
    key.shadow.bias = -.0005; scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, .65); fill.position.set(-250, 350, 200); scene.add(fill);
    const content = new THREE.Group(); scene.add(content);
    const platform = new THREE.Group(); scene.add(platform);
    const scheduler=frameScheduler(()=>renderer.render(scene,camera),requestAnimationFrame,cancelAnimationFrame);
    const render=scheduler.render;
    let moving=false;
    const resolution=()=>{
      detailRef.current.moving=moving;
      const budget=viewerBudget(qualityRef.current,detailRef.current.triangles,moving);
      const ratio=viewerPixelRatio(host.clientWidth,host.clientHeight,window.devicePixelRatio,moving,budget.pixels,budget.ratio);if(renderer.getPixelRatio()!==ratio)renderer.setPixelRatio(ratio);
      if(renderer.shadowMap.enabled!==budget.shadows){renderer.shadowMap.enabled=budget.shadows;renderer.shadowMap.needsUpdate=true;}
      content.children.forEach(object=>{if(object.userData.selectionPartId)object.visible=budget.edges;});
    };
    detailRef.current.update=()=>{resolution();render();};
    const startMotion=()=>{moving=true;resolution();render();},endMotion=()=>{moving=false;resolution();render();};
    controls.addEventListener('start',startMotion);controls.addEventListener('end',endMotion);
    const applyFrame = (frame: CameraFrame, move = true) => {
      camera.aspect = frame.aspect; camera.near = frame.near; camera.far = frame.far;
      camera.setViewOffset(frame.viewport.width, frame.viewport.height, frame.viewOffset.x, frame.viewOffset.y, frame.viewport.width, frame.viewport.height);
      if (move) {
        controls.maxDistance = Math.max(6000, frame.distance * 20);
        camera.up.copy(frame.up); camera.position.copy(frame.position);
        controls.target.copy(frame.target); controls.update();
      }
      camera.updateProjectionMatrix();
    };
    const engine: ViewerEngine = {
      scene, camera, renderer, controls, content, platform, render,
      bounds: new THREE.Box3(), plate: [256, 256, 256],
      viewport: { width: 1, height: 1 }, insets: { top: 20, right: 20, bottom: 20, left: 20 }, hasFit: false,
      fit(nextView) {
        const bounds = engine.bounds.isEmpty() ? new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(engine.plate[0], engine.plate[1], 20)) : engine.bounds;
        const direction = nextView === 'top' ? new THREE.Vector3(0, -.001, 1) : nextView === 'front' ? new THREE.Vector3(0, -1, .001)
          : nextView === 'iso' ? new THREE.Vector3(1, -1.45, 1.12) : camera.position.clone().sub(controls.target);
        engine.viewport = { width: Math.max(1, host.clientWidth), height: Math.max(1, host.clientHeight) };
        engine.insets = cameraInsets(host);
        applyFrame(cameraFrameForBounds(bounds, { viewport: engine.viewport, insets: engine.insets, direction, fov: camera.fov }));
        engine.hasFit = true; render();
      },
      dispose() {
        scheduler.dispose();disposeTree(content,true); disposeTree(platform); controls.dispose(); renderer.dispose();
        if (host.contains(renderer.domElement)) host.removeChild(renderer.domElement);
      },
    };
    engineRef.current = engine;
    const resize = () => {
      const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
      const viewport = { width, height }, insets = cameraInsets(host);
      resolution();renderer.setSize(width, height, false);
      const options = { viewport, insets, fov: camera.fov, position: camera.position, target: controls.target,
        previousViewport: engine.viewport, previousInsets: engine.insets };
      applyFrame(engine.hasFit ? resizedCameraFrame(engine.bounds, options) : cameraFrameForBounds(engine.bounds, options), engine.hasFit);
      engine.viewport = viewport; engine.insets = insets; render();
    };
    const observer = new ResizeObserver(resize); observer.observe(host); resize();
    controls.addEventListener('change', render);
    const raycaster = new THREE.Raycaster(); let downX = 0, downY = 0;
    const setRay=(event:PointerEvent)=>{const rect=renderer.domElement.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1),camera);};
    const hitAt=(event:PointerEvent)=>{setRay(event);return raycaster.intersectObjects(content.children.filter(object=>object instanceof THREE.Mesh&&object.userData.partId),false)[0];};
    const floor=new THREE.Plane(new THREE.Vector3(0,0,1),0);let drag:{id:string;start:THREE.Vector3;position:[number,number,number];delta:THREE.Vector3;objects:{object:THREE.Object3D;position:THREE.Vector3}[]}|undefined;
    const pointerDown = (event: PointerEvent) => {
      downX = event.clientX; downY = event.clientY;
      const state=interaction.current;if(event.button!==0||state.mode!=='plate'||state.placementTool==='orbit')return;
      const hit=hitAt(event);if(!hit)return;const id=hit.object.userData.partId as string;selectRef.current?.(id);
      if(state.placementTool==='face'&&hit.face){const matrix=hit.object.matrixWorld.clone();if(hit.object instanceof THREE.InstancedMesh&&hit.instanceId!==undefined){const instance=new THREE.Matrix4();hit.object.getMatrixAt(hit.instanceId,instance);matrix.multiply(instance);}const normal=hit.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(matrix)).normalize();state.onPlaceFace?.(id,normal.toArray());event.preventDefault();event.stopImmediatePropagation();return;}
      const item=state.items.find(item=>item.partId===id),point=raycaster.ray.intersectPlane(floor,new THREE.Vector3());
      if(state.placementTool==='move'&&item&&point){controls.enabled=false;startMotion();drag={id,start:point,position:[...item.position],delta:new THREE.Vector3(),objects:content.children.filter(o=>o.userData.partId===id||o.userData.selectionPartId===id).map(object=>({object,position:object.position.clone()}))};renderer.domElement.setPointerCapture(event.pointerId);event.preventDefault();event.stopImmediatePropagation();}
    };
    const pointerMove=(event:PointerEvent)=>{if(!drag)return;setRay(event);const point=raycaster.ray.intersectPlane(floor,new THREE.Vector3());if(!point)return;drag.delta.copy(point).sub(drag.start);drag.delta.z=0;for(const entry of drag.objects)entry.object.position.copy(entry.position).add(drag.delta);render();};
    const pointerUp = (event: PointerEvent) => {
      if(drag){const pending=drag;drag=undefined;controls.enabled=true;endMotion();for(const entry of pending.objects)entry.object.position.copy(entry.position);interaction.current.onMovePart?.(pending.id,[pending.position[0]+pending.delta.x,pending.position[1]+pending.delta.y,0]);render();return;}
      if(interaction.current.placementTool==='face'&&interaction.current.mode==='plate')return;
      if (event.button !== 0 || Math.hypot(event.clientX - downX, event.clientY - downY) > 5) return;
      const rect = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
      const hit = raycaster.intersectObjects(content.children.filter(object=>object instanceof THREE.Mesh&&object.userData.partId),false)[0];
      if (hit) selectRef.current?.(hit.object.userData.partId as string);
    };
    const contextLost = (event: Event) => { event.preventDefault(); setError('The browser lost its graphics context. Save your project and reload to recover the 3D workspace.'); };
    const keydown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'f') { event.preventDefault(); engine.fit(); }
      if (event.key === '1') { engine.fit('iso'); setView('iso'); }
      if (event.key === '2') { engine.fit('top'); setView('top'); }
      if (event.key === '3') { engine.fit('front'); setView('front'); }
    };
    const pointerCancel=()=>{if(drag){for(const entry of drag.objects)entry.object.position.copy(entry.position);drag=undefined;controls.enabled=true;endMotion();render();}};
    renderer.domElement.addEventListener('pointerdown', pointerDown,true);
    renderer.domElement.addEventListener('pointermove',pointerMove);
    renderer.domElement.addEventListener('pointercancel',pointerCancel);
    renderer.domElement.addEventListener('pointerup', pointerUp);
    renderer.domElement.addEventListener('webglcontextlost', contextLost);
    renderer.domElement.addEventListener('keydown', keydown);
    return () => {
      observer.disconnect(); controls.removeEventListener('change', render);
      controls.removeEventListener('start',startMotion);controls.removeEventListener('end',endMotion);
      renderer.domElement.removeEventListener('pointerdown', pointerDown,true);
      renderer.domElement.removeEventListener('pointermove',pointerMove);
      renderer.domElement.removeEventListener('pointercancel',pointerCancel);
      renderer.domElement.removeEventListener('pointerup', pointerUp);
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      renderer.domElement.removeEventListener('keydown', keydown);
      engine.dispose(); engineRef.current = null;
      meshCache.current?.dispose();meshCache.current=undefined;frames.current.clear();
    };
  }, []);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    let cancelled=false;
    const visibleParts=mode==='toolpath'?[]:mode==='parts'&&selectedPartId&&!installedOrientation?parts.filter(part=>part.id===selectedPartId):mode==='plate'?parts.filter(part=>items.some(item=>item.partId===part.id)):parts;
    const cache=meshCache.current??=new ViewerMeshCache();
    setMeshLoading(visibleParts.length>0);
    const update=async()=>{
    const loaded=await Promise.all(visibleParts.map(async part=>{try{return {part,mesh:await cache.get(part.geometry.hash,part.geometry.stl)};}catch(error){return {part,error:`${part.name}: ${(error as Error).message}`};}}));
    if(cancelled)return;
    pathObjects.current = [];
    disposeTree(engine.content,true); disposeTree(engine.platform);
    engine.content.position.set(mode==='toolpath'?pathOffset[0]:0,mode==='toolpath'?pathOffset[1]:0,0);
    engine.plate = plate;
    engine.platform.add(createPlatform(plate));
    engine.platform.getObjectByName('plate-grid')!.visible = gridVisible;
    const errors: string[] = loaded.flatMap(value=>value.error?[value.error]:[]);
    if (mode === 'toolpath') {
      pathObjects.current = [];
      for (const buffer of toolpath ? toolpath.renderBuffers??buildPathBuffers(toolpath) : []) {
        if(buffer.feature!=='travel'){
          const mesh=createToolpathBeads(buffer,filamentColor,beadWidth,beadHeight);engine.content.add(mesh);pathObjects.current.push({kind:'beads',buffer,mesh});continue;
        }
        const attribute = new THREE.BufferAttribute(buffer.positions, 3);
        const lines = (active: boolean) => {
          const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', attribute);
          const paths = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: colors[buffer.feature], transparent: true,
            opacity: buffer.feature === 'travel' ? .35 : active ? 1 : .34, depthWrite: active }));
          engine.content.add(paths); return paths;
        };
        pathObjects.current.push({kind:'lines',buffer, context: lines(false), active: lines(true)});
      }
    } else {
      for (const [partIndex, value] of loaded.entries()) {
        const {part}=value;if(!value.mesh)continue;
        const item = items.find(item => item.partId === part.id);
        if (mode === 'plate' && !item) continue;
        const {geometry,edges}=value.mesh;
        const sourceTransforms = installedOrientation ? part.source.occurrences?.filter(occurrence => occurrence.transform.length === 16 && occurrence.transform.every(Number.isFinite)) : undefined;
        if (installedOrientation && !sourceTransforms?.length) errors.push(`${part.name}: installed transform unavailable; showing source-part coordinates.`);
        if (item?.orientation.some(angle => !Number.isFinite(angle))) { errors.push(`${part.name}: enter finite orientation angles to display this part.`); continue; }
        const quantity = mode === 'parts' ? 1 : (item?.quantity ?? 1) + (item?.spareQuantity ?? 0);
        const placements = mode === 'plate' && item ? layoutItem(part, item) : [];
        const frameKey=JSON.stringify([part.geometry.hash,item?.orientation??[0,0,0]]);
        let frame=frames.current.get(frameKey);if(!frame){frame=manufacturingFrame(geometry,item?.orientation??[0,0,0]);frames.current.set(frameKey,frame);if(frames.current.size>128)frames.current.delete(frames.current.keys().next().value!);}
        const instanceCount = installedOrientation && sourceTransforms?.length ? sourceTransforms.length : quantity;
        if(!instanceCount)continue;
        const batched=mode==='plate'&&!installedOrientation&&instanceCount>1?partInstances(geometry,frame,placements.map(p=>p.position),/^#[0-9a-f]{6}$/i.test(filamentColor)?filamentColor:'#d9d9d9'):undefined;
        if(batched){batched.userData.partId=part.id;engine.content.add(batched);}
        for (let instance = 0; instance < instanceCount; instance++) {
          const selected = !selectedPartId || selectedPartId === part.id;
          const material = new THREE.MeshStandardMaterial({ color: /^#[0-9a-f]{6}$/i.test(filamentColor)?filamentColor:'#d9d9d9', roughness: .82, metalness: 0 });
          const mesh = new THREE.Mesh(geometry, material); mesh.castShadow = true; mesh.receiveShadow = true;mesh.userData.sharedGeometry=true;
          mesh.userData.partId = part.id;
          if (installedOrientation && sourceTransforms?.[instance]) {
            mesh.applyMatrix4(installedTransformMatrix(sourceTransforms[instance].transform, part.source.installedTransformUnits ?? 'm'));
          } else {
            // Copies share the exact oriented GPU mesh; source geometry is untouched.
            const rotatedSize = frame.bounds.getSize(new THREE.Vector3());
            const position = mode === 'parts' ? [plate[0] / 2 + partIndex * (rotatedSize.x + 20), plate[1] / 2, 0] : placements[instance].position;
            mesh.applyMatrix4(frame.matrix);mesh.position.add(new THREE.Vector3(...position));mesh.updateMatrixWorld(true);
            const bounds = frame.bounds.clone().translate(new THREE.Vector3(...position));mesh.userData.displayBounds=bounds;
            const overflow = mode === 'plate' && (bounds.min.x < 0 || bounds.min.y < 0 || bounds.min.z < -.01 || bounds.max.x > plate[0] || bounds.max.y > plate[1] || bounds.max.z > plate[2]);
            if (overflow) {
              const helper = new THREE.Box3Helper(bounds, 0xff5e63); helper.userData.partId = part.id; engine.content.add(helper);
            }
          }
          if(!batched)engine.content.add(mesh);else material.dispose();
          const edge = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: selected?0xf3f3f3:0x34363d, transparent: true, opacity: selected?.55:.24 }));
          edge.userData.selectionPartId=part.id;edge.userData.sharedGeometry=true;
          edge.position.copy(mesh.position); edge.quaternion.copy(mesh.quaternion); edge.scale.copy(mesh.scale); engine.content.add(edge);
        }
      }
    }
    const previousBounds = engine.bounds.clone();
    const contentBounds = new THREE.Box3();engine.content.updateMatrixWorld(true);
    for(const object of engine.content.children)if(object instanceof THREE.Mesh)contentBounds.union(object.userData.displayBounds??new THREE.Box3().setFromObject(object));
    if(mode==='toolpath'){
      contentBounds.makeEmpty();
      const point=new THREE.Vector3();
      for(const paths of pathObjects.current)if(paths.buffer.feature!=='travel'){
        if(paths.buffer.bounds)contentBounds.union(new THREE.Box3(new THREE.Vector3(...paths.buffer.bounds.min),new THREE.Vector3(...paths.buffer.bounds.max)).translate(engine.content.position));
        else for(let i=0;i<paths.buffer.positions.length;i+=3)contentBounds.expandByPoint(point.fromArray(paths.buffer.positions,i).add(engine.content.position));
      }
    }
    engine.bounds.copy(mode === 'parts' ? contentBounds : new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(plate[0], plate[1], 10)).union(contentBounds));
    setGeometryErrors(errors);
    setMeshLoading(false);cache.trim(new Set(visibleParts.map(part=>part.geometry.hash)));
    const contentExists = engine.content.children.length > 0;
    if (previousMode.current !== mode || (!hasContent.current && contentExists) || (mode === 'parts' && !installedOrientation && previousPart.current !== selectedPartId)
      || previousInstalled.current !== installedOrientation || (mode === 'parts' && !previousBounds.equals(engine.bounds))) {
      engine.fit(previousMode.current === '' ? view : undefined); previousMode.current = mode;
    }
    previousPart.current = selectedPartId; previousInstalled.current = installedOrientation;
    hasContent.current = contentExists;
    engine.renderer.shadowMap.needsUpdate=true;
    detailRef.current.triangles=Math.max(engine.content.children.length>250?400_001:0,mode==='toolpath'?pathObjects.current.reduce((sum,path)=>sum+(path.kind==='beads'?path.buffer.positions.length:0),0):loaded.reduce((sum,value)=>sum+(value.mesh?.geometry.getAttribute('position').count??0)/3*(mode==='plate'?Math.max(1,(items.find(item=>item.partId===value.part.id)?.quantity??1)+(items.find(item=>item.partId===value.part.id)?.spareQuantity??0)):1),0));
    detailRef.current.update();
    present();
    };
    void update().catch(error=>{if(!cancelled){setMeshLoading(false);setGeometryErrors([`3D preview could not load: ${(error as Error).message}`]);}});
    return()=>{cancelled=true;};
  }, [partsKey, itemsKey, displaySelection, mode, toolpath, plate[0], plate[1], plate[2], installedOrientation,beadWidth,beadHeight,pathOffset[0],pathOffset[1]]);

  useEffect(() => {
    present();
  }, [mode, toolpath, layer, showTravel, featuresKey, partsKey, itemsKey, displaySelection, plate[0], plate[1], plate[2], installedOrientation]);

  useEffect(()=>{present();},[pathColorMode,filamentColor,selectedPartId]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const grid = engine.platform.getObjectByName('plate-grid');
    if (grid) grid.visible = gridVisible;
    engine.render();
  }, [gridVisible]);


  const changeView = (next: 'iso' | 'top' | 'front') => { setView(next); engineRef.current?.fit(next); };
  const selected = parts.find(part => part.id === selectedPartId);
  return <div className={`workspace-viewer ${className}`} data-placement-tool={placementTool} data-testid="workspace-viewer">
    <div ref={hostRef} className="workspace-viewer__canvas" />
    {meshLoading&&<span className="workspace-viewer__loading" role="status">Loading 3D geometry…</span>}
    {error ? <div className="workspace-viewer__fallback" role="alert"><View size={32} /><strong>3D workspace unavailable</strong><span>{error}</span></div> : <>
      <div className="workspace-viewer__topline"><span><i /> {installedOrientation ? 'INSTALLED ASSEMBLY' : mode === 'toolpath' ? 'ACTUAL TOOLPATH' : mode === 'plate' ? 'BUILD PLATE' : 'GEOMETRY INSPECTION'}</span><span>mm</span></div>
      <div className="workspace-viewer__tools" role="toolbar" aria-label="3D view controls">
        <button type="button" title="Fit to view (F)" aria-label="Fit to view" onClick={() => engineRef.current?.fit()}><Expand size={17} /></button>
        <details className="camera-options"><summary aria-label="Camera options" title="Camera options"><Rotate3D size={18}/></summary><div>
        <button type="button" className={view === 'iso' ? 'is-active' : ''} title="Isometric view (1)" aria-label="Isometric view" onClick={() => changeView('iso')}><Rotate3D size={18} /></button>
        <button type="button" className={view === 'top' ? 'is-active' : ''} title="Top view (2)" aria-label="Top view" onClick={() => changeView('top')}><ScanLine size={18} /></button>
        <button type="button" className={view === 'front' ? 'is-active' : ''} title="Front view (3)" aria-label="Front view" onClick={() => changeView('front')}><View size={18} /></button>
        <span />
        <button type="button" className={gridVisible ? 'is-active' : ''} aria-pressed={gridVisible} title="Toggle plate grid" aria-label="Toggle plate grid" onClick={() => setGridVisible(value => !value)}><Grid2X2 size={17} /></button>
        <label className="viewer-quality">3D quality<select aria-label="3D quality" value={quality} onChange={event=>chooseQuality(event.target.value as ViewerQuality)}><option value="auto">Automatic</option><option value="quality">High detail</option><option value="economy">Low power</option></select></label>
        </div></details>
      </div>
      {geometryErrors.length > 0 && <div className="workspace-viewer__errors" role="alert">{geometryErrors.map(message => <div key={message}>{message}</div>)}</div>}
      {parts.length === 0 && mode !== 'toolpath' && <div className="workspace-viewer__empty"><Rotate3D size={36} strokeWidth={1} /><strong>Your next idea starts here.</strong><span>Select CAD parts or import an STL to inspect your geometry.</span></div>}
      {mode === 'toolpath' && !(toolpath?.renderBuffers?.length??toolpath?.segments?.length) && <div className="workspace-viewer__empty"><ScanLine size={36} strokeWidth={1} /><strong>Ready to slice</strong><span>Use Slice plate below. The generated layers appear here automatically.</span></div>}
      <div className="workspace-viewer__footer"><span className="workspace-viewer__navigation">Drag to orbit <b>·</b> Right-drag to pan <b>·</b> Scroll to zoom</span>
        <span className="workspace-viewer__scale">{mode === 'parts' && selected ? `${selected.geometry.dimensions.map(value => Number(value.toFixed(1))).join(' × ')} mm` : `${plate[0]} × ${plate[1]} mm plate`}</span></div>
      <div className="workspace-viewer__axis" aria-hidden="true"><span className="axis-z">Z</span><span className="axis-y">Y</span><span className="axis-x">X</span><i /></div>
    </>}
  </div>;
}
export default WorkspaceViewer;
