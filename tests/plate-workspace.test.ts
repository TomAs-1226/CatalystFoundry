import {expect,it} from 'vitest';
import {BoxGeometry,Euler,Mesh,Quaternion,Vector3} from 'three';
import {STLExporter} from 'three/addons/exporters/STLExporter.js';
import {STLLoader} from 'three/addons/loaders/STLLoader.js';
import {parseSTL} from '../src/adapters/geometry';
import {parseGcode} from '../src/adapters/toolpaths';
import {faceDownOrientation,layFlatOrientation} from '../src/domain/plate-orientation';
import {preparePlateModel} from '../src/domain/prepare-plate';
import {createProject,type Part} from '../src/domain/model';
import {fingerprint,fitWarnings,layoutItem,manufacturingManifest} from '../src/domain/invariants';
import {deserializeProject,serializeProject} from '../src/domain/persistence';
import {manufacturingGeometry,geometryDimensions} from '../src/components/viewer-geometry';
import {buildPathBuffers} from '../src/components/toolpath-buffers';

async function tiltedBox(){
  const geometry=new BoxGeometry(12,50,4).toNonIndexed();geometry.rotateX(.53);geometry.rotateY(.29);
  const text=new STLExporter().parse(new Mesh(geometry));geometry.dispose();
  const p=createProject(),j=p.jobs[0];const part:Part={id:'tilted',name:'Tilted plate',source:{kind:'local'},geometry:await parseSTL(text,'mm'),classification:'make',quantity:1,spareQuantity:1,category:'custom'};
  p.parts=[part];j.items=[{partId:part.id,quantity:1,spareQuantity:1,orientation:[0,0,0],position:[999,999,50]}];return{p,j,part};
}
it('lays a tilted thin part onto an actual mesh face, arranges both copies on the bed, and preserves source bytes',async()=>{
  const {p,j,part}=await tiltedBox(),before=structuredClone(part.geometry);
  const prepared=await preparePlateModel(p,j,true,true);j.items=prepared.items;
  const source=new STLLoader().parse(part.geometry.stl),mesh=manufacturingGeometry(source,j.items[0].orientation);
  expect(geometryDimensions(mesh)[2]).toBeCloseTo(4,4);expect(j.items[0].position[2]).toBe(0);expect(fitWarnings(p,j)).toEqual([]);
  expect(part.geometry).toEqual(before);expect(j.items[0].spareQuantity).toBe(1);expect(j.items[0].orientationMode).toBe('automatic');source.dispose();mesh.dispose();
  expect(await layFlatOrientation(part,j.items[0],j.printer.buildVolume)).toEqual(j.items[0].orientation);
});
it('keeps reviewed manual rotations during automatic preparation and does not change a manual layout when arrange is off',async()=>{
  const {p,j}=await tiltedBox();j.items[0].orientation=[25,40,12];j.items[0].orientationMode='manual';
  expect((await preparePlateModel(p,j,true,true)).items[0].orientation).toEqual([25,40,12]);
  expect((await preparePlateModel(p,j,false,true)).items).toEqual(j.items);
});
it('places a picked world-space face down with the same Euler XYZ transform used by manufacturing',()=>{
  const current:[number,number,number]=[30,20,15],original=new Vector3(0,1,0),rotation=new Quaternion().setFromEuler(new Euler(...current.map(v=>v*Math.PI/180) as [number,number,number],'XYZ'));
  const world=original.clone().applyQuaternion(rotation);const result=faceDownOrientation(current,world.toArray());
  const transformed=original.clone().applyEuler(new Euler(...result.map(v=>v*Math.PI/180) as [number,number,number],'XYZ'));
  expect(transformed.x).toBeCloseTo(0,6);expect(transformed.y).toBeCloseTo(0,6);expect(transformed.z).toBeCloseTo(-1,6);
  expect(()=>faceDownOrientation(current,[0,0,0])).toThrow(/valid/);
});
it('persists support clearance and binds changed copy positions to the exact manifest',async()=>{
  const {p,j}=await tiltedBox();j.items[0].orientationMode='manual';const prior=await fingerprint(p,j);
  j.items=(await preparePlateModel(p,j,true,false)).items;expect(j.items[0].copySpacing).toBeGreaterThanOrEqual(24);
  const copies=layoutItem(p.parts[0],j.items[0]);expect(copies[1].position[0]-copies[0].position[0]-copies[0].dimensions[0]).toBeGreaterThanOrEqual(24-.001);
  expect(manufacturingManifest(p,j).layoutVersion).toBe('grid-v2');expect(await fingerprint(p,j)).not.toBe(prior);
  const restored=await deserializeProject(serializeProject(p));expect(restored.jobs[0].items).toEqual(j.items);
  const before=await fingerprint(p,j);j.items[0].copySpacing!+=3;expect(await fingerprint(p,j)).not.toBe(before);
});
it('renders clockwise, counterclockwise and full-circle arcs continuously without inventing straight shortcuts',()=>{
  const g='G21\nG90\nM83\nG17\nG0 X10 Y0 Z.2\n;FEATURE:Outer wall\n';
  const ccw=parseGcode(g+'G3 X0 Y10 I-10 J0 E1\nG1 X0 Y11 E1');
  const wall=ccw.segments.filter(s=>s.feature==='wall');expect(wall.length).toBeGreaterThan(8);
  for(const s of wall.slice(0,-1))expect(Math.hypot(s.to[0],s.to[1])).toBeCloseTo(10,6);
  expect(wall.at(-1)!.from).toEqual([0,10,.2]);expect(ccw.extrusionMm).toBeCloseTo(2,7);expect(ccw.canApprove).toBe(true);
  const cw=parseGcode(g+'G2 X0 Y-10 I-10 J0 E1');expect(cw.segments.filter(s=>s.feature==='wall').every(s=>s.to[1]<=.000001)).toBe(true);
  const circle=parseGcode(g+'G3 I-10 J0 E1');expect(circle.segments.at(-1)!.to).toEqual([10,0,.2]);expect(circle.segments.length).toBeGreaterThan(20);
  const hop=parseGcode(g+'G1 X11 E1\nG3 Z.6 I-1 J0 P1 F30000');expect(hop.unsupportedCommands).not.toContain('G3');expect(hop.segments.at(-1)!.to).toEqual([11,0,.6]);expect(hop.segments.at(-1)!.feature).toBe('travel');
  expect(parseGcode(g+'G1 X11 E1\nG3 Z.6 I-1 J0 P2').canApprove).toBe(false);
  expect(parseGcode(g+'G3 X0 Y10 I-2 J0 E1\nG1 X0 Y11 E1').canApprove).toBe(false);
});
it('honors Bambu layers and line widths, excludes setup/end motions from display, and keeps unsupported machine commands blocking',()=>{
  const path=parseGcode('G21\nG90\nM83\nG0 Z.2\nG1 X-20 E1\n; CHANGE_LAYER\n; Z_HEIGHT: .2\n; LAYER_HEIGHT: .2\n; FEATURE: Support\n; LINE_WIDTH: .5\nG0 X10 Y10 Z.16\nG1 X20 E1\nG0 Z.2\nG1 Y20 E1\n; CHANGE_LAYER\n; Z_HEIGHT: .4\nG0 Z.4\nG1 X10 E1\n; MACHINE_END_GCODE_START\nG1 X400 E1\nG28\n');
  expect(path.layers.map(layer=>layer.z)).toEqual([.2,.4]);expect(path.segments.filter(s=>s.feature==='support'&&s.printMove).map(s=>s.layer)).toEqual([0,0,1]);
  const buffers=buildPathBuffers(path),support=buffers.find(b=>b.feature==='support')!;
  expect(Math.max(...support.positions)).toBeLessThanOrEqual(20);expect([...support.widths]).toEqual([.5,.5,.5]);expect(support.heights[0]).toBeCloseTo(.2);
  expect(path.canApprove).toBe(false);expect(path.blockingIssues.join(' ')).toMatch(/homing/);
});
