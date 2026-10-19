import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { isAbsolute, join, relative, sep, win32, posix } from 'node:path';
import type { ProcessSettings, PrinterProfile, MaterialProfile } from '../src/domain/model';
import { validateSettings } from '../src/domain/invariants';
import {nativeOverrides} from '../src/domain/bambu-settings';
import type { BambuCliConfig } from './slicer';
export const SETTINGS_MAPPING_VERSION = 'foundry-bambu-process-v2';
export const hashBytes = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
export function isPathInside(root: string, candidate: string, allowRoot = false, platform: 'win32' | 'posix' = process.platform === 'win32' ? 'win32' : 'posix'): boolean {
  const api = platform === 'win32' ? win32 : posix;
  const rel = api.relative(root, candidate);
  return (allowRoot || rel !== '') && !api.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + api.sep);
}
const required: Record<'machine'|'filament'|'process', string[]> = {
 machine: ['printer_model','printer_variant','nozzle_diameter','printable_area','printable_height','machine_start_gcode','machine_end_gcode','gcode_flavor','retraction_length','retraction_speed','z_hop'],
 filament: ['filament_type','filament_diameter','filament_density','filament_flow_ratio','filament_max_volumetric_speed','nozzle_temperature','nozzle_temperature_initial_layer','textured_plate_temp','textured_plate_temp_initial_layer','filament_start_gcode','filament_end_gcode'],
 process: ['layer_height','initial_layer_print_height','wall_loops','sparse_infill_density','sparse_infill_pattern','enable_support','support_type','brim_width','outer_wall_speed','inner_wall_speed','sparse_infill_speed','top_shell_layers','bottom_shell_layers','line_width'],
};
/** Structural gate, separate from a qualified operator's physical review. Reject inherited fragments. */
export function validateFullProfile(kind: keyof typeof required, value: unknown): Record<string, unknown> {
 if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`The ${kind} profile must be complete JSON.`);
 const profile = value as Record<string,unknown>;
 const missing = required[kind].filter(key => profile[key] === undefined || profile[key] === null);
 if (profile.inherits || profile.include || missing.length) throw new Error(`The ${kind} profile must be fully resolved without inheritance; missing ${missing.join(', ') || 'resolved inheritance'}. Export full configuration or use the documented profile resolver.`);
 if (profile.type !== kind) throw new Error(`Expected ${kind} profile type.`);
 return profile;
}
export function resolveProcessSettings(base: Record<string, unknown>, settings: ProcessSettings): Record<string, unknown> {
 if(!settings||typeof settings!=='object'||Array.isArray(settings))throw new Error('Provide explicit process settings before resolving the slicer profile.');
 validateSettings(settings);
 // speed means all explicit common extrusion-speed fields; travel and machine acceleration remain from the complete base.
 return {...base, layer_height:String(settings.layerHeight), wall_loops:String(settings.walls), sparse_infill_density:`${settings.infill}%`, enable_support:settings.supports?'1':'0', support_type:(settings.supportStyle==='tree'||settings.supportStyle==='auto'&&settings.supportResolvedStyle==='tree')?'tree(auto)':'normal(auto)', support_threshold_angle:String(settings.supportThreshold??45), brim_width:String(settings.brimWidth),
  outer_wall_speed:String(settings.speed), inner_wall_speed:String(settings.speed), sparse_infill_speed:String(settings.speed), internal_solid_infill_speed:String(settings.speed), top_surface_speed:String(settings.speed), gap_infill_speed:String(settings.speed),...(settings.infillMode==='auto'&&settings.infillResolvedPattern?{sparse_infill_pattern:settings.infillResolvedPattern}:{}),...nativeOverrides(settings)};
}
export interface SlicingFileConfig extends BambuCliConfig { printer: PrinterProfile; material: MaterialProfile; profileLabel: string; }
export function validateConfiguredProfiles(config: SlicingFileConfig, machine: Record<string,unknown>, filament: Record<string,unknown>) {
 if (!config.printer || !config.material || !config.profileLabel?.trim()) throw new Error('Configure explicit printer, material and profileLabel metadata; no generic machine can be selected silently.');
 const nozzle = Array.isArray(machine.nozzle_diameter) ? Number(machine.nozzle_diameter[0]) : Number(machine.nozzle_diameter);
 if (String(machine.printer_model)!==config.printer.model || nozzle!==config.printer.nozzleDiameter) throw new Error('Configured printer model/nozzle does not match the complete machine profile.');
 if(config.printer.nozzleCount!==undefined){const nozzles=Array.isArray(machine.nozzle_diameter)?machine.nozzle_diameter:[machine.nozzle_diameter];if(nozzles.length!==config.printer.nozzleCount||nozzles.some(n=>Number(n)!==config.printer.nozzleDiameter)||config.printer.activeNozzle!=='primary')throw new Error('Multi-nozzle profile must pin every nozzle and explicitly use the primary nozzle.');}
 const area = machine.printable_area as unknown[];
 if (!Array.isArray(area) || area.length!==4) throw new Error('Only a rectangular four-corner build area is currently supported.');
 const points=area.map(point=>String(point).split('x').map(Number));
 const width=Math.max(...points.map(p=>p[0])), depth=Math.max(...points.map(p=>p[1]));
 if(new Set(points.map(p=>p.join(','))).size!==4||![[0,0],[width,0],[width,depth],[0,depth]].every(corner=>points.some(p=>p[0]===corner[0]&&p[1]===corner[1]))||points.some(p=>p.length!==2||p.some(v=>!Number.isFinite(v)||v<0))||Math.min(...points.map(p=>p[0]))!==0||Math.min(...points.map(p=>p[1]))!==0||width!==config.printer.buildVolume[0]||depth!==config.printer.buildVolume[1]||Number(machine.printable_height)!==config.printer.buildVolume[2])throw new Error('Configured build volume does not match the machine profile.');
 const type=Array.isArray(filament.filament_type)?filament.filament_type[0]:filament.filament_type;
 if(type!==config.material.type)throw new Error('Configured material type does not match the complete filament profile.');
 if(!['Textured PEI Plate','High Temp Plate','Cool Plate','Engineering Plate','Supertack Plate'].includes(config.printer.plate))throw new Error('Select an explicitly supported Bambu bed-type name; generic plate labels cannot be sent to the slicer.');
 if (!config.printer.plate.trim() || config.printer.tested !== false || config.material.tested !== false) throw new Error('Offline configured profiles must retain tested:false until a separate physical qualification workflow is implemented.');
}
export async function readPinnedProfile(file: {path:string;sha256:string}, kind: keyof typeof required) {
 if(!isAbsolute(file.path)||!/^[a-f0-9]{64}$/.test(file.sha256))throw new Error(`Pin the complete ${kind} profile path and hash.`);
 const bytes=await readFile(file.path);if(hashBytes(bytes)!==file.sha256)throw new Error(`The ${kind} profile changed after review.`);
 return validateFullProfile(kind, JSON.parse(bytes.toString()));
}
export async function resolvedConfig(config: SlicingFileConfig, settings: ProcessSettings,materialColor?:string): Promise<SlicingFileConfig> {
 const base=await readPinnedProfile(config.process,'process');
 const resolved=resolveProcessSettings(base,settings);const bytes=JSON.stringify(resolved,null,2)+'\n';
 const hash=hashBytes(bytes);const directory=join(config.workRoot,'resolved-profiles');await mkdir(directory,{recursive:true});const profilePath=join(directory,hash+'.json');await writeFile(profilePath,bytes,{mode:0o600});
 if(materialColor===undefined)return {...config,process:{path:profilePath,sha256:hash}};
 if(!/^#[a-f\d]{6}$/i.test(materialColor))throw Error('Choose a valid six-digit filament color.');
 const filament=await readPinnedProfile(config.filament,'filament');
 const filamentBytes=JSON.stringify({...filament,filament_colour:[materialColor.toUpperCase()]},null,2)+'\n',filamentHash=hashBytes(filamentBytes),filamentPath=join(directory,filamentHash+'.json');
 await writeFile(filamentPath,filamentBytes,{mode:0o600});
 return {...config,material:{...config.material,color:materialColor},process:{path:profilePath,sha256:hash},filament:{path:filamentPath,sha256:filamentHash}};
}
