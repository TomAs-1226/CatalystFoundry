import catalog from './bambu-process-options.json';
import type {ProcessSettings} from './model';
export interface BambuOption {key:string;label:string;category:string;type:string;unit:string;min?:number;max?:number;options?:string[];optionLabels?:string[];description:string;}
export const bambuOptions=catalog.fields as BambuOption[];
export const bambuOptionsVersion=catalog.version;
export const nativeAliases:Record<string,string>={layer_height:'layerHeight',wall_loops:'walls',sparse_infill_density:'infill',enable_support:'supports',brim_width:'brimWidth',support_threshold_angle:'supportThreshold'};
const byKey=new Map(bambuOptions.map(field=>[field.key,field]));
export const processSettingKey=(field:BambuOption)=>nativeAliases[field.key]??'bambu.'+field.key;
export function nativeValue(field:BambuOption,value:unknown):string|string[]{
  if(field.type==='coEnum'){if(typeof value!=='string'||!field.options?.includes(value))throw Error(`${field.label}: choose a supported Bambu option.`);return value;}
  let result:string;
  if(/^coBools?$/.test(field.type)){
    if(![true,false,'0','1'].includes(value as any))throw Error(`${field.label}: choose on or off.`);result=value===true||value==='1'?'1':'0';
  }else{
    if(typeof value!=='number'&&typeof value!=='string')throw Error(`${field.label}: enter a number.`);
    const text=String(value),percent=text.endsWith('%'),number=Number(percent?text.slice(0,-1):text);
    if(!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)%?$/.test(text)||!Number.isFinite(number)||Math.abs(number)>1e6)throw Error(`${field.label}: enter a finite native value.`);
    if(percent&&!/Percent/.test(field.type))throw Error(`${field.label}: percentages are not supported.`);
    if(/^coInts?$/.test(field.type)&&!Number.isInteger(number))throw Error(`${field.label}: enter a whole number.`);
    if(field.min!==undefined&&number<field.min||field.max!==undefined&&number>field.max)throw Error(`${field.label}: value is outside the pinned Bambu range (${field.min??'unbounded'}–${field.max??'unbounded'}).`);
    result=String(number)+(/Percent/.test(field.type)&&(!/OrPercent/.test(field.type)||percent)?'%':'');
  }
  return ['coBools','coInts','coFloats','coPercents','coFloatsOrPercents'].includes(field.type)?[result]:result;
}
const common=new Set(['layerHeight','walls','infill','supports','brimWidth','speed','supportStyle','supportResolvedStyle','supportThreshold','infillMode','infillResolvedPattern']);
export function nativeOverrides(settings:ProcessSettings):Record<string,unknown>{
  const output:Record<string,unknown>={};
  if(settings.infillMode!==undefined&&!['auto','manual'].includes(String(settings.infillMode)))throw Error('Choose automatic or manual infill.');
  if(settings.infillResolvedPattern!==undefined&&!['adaptivecubic','gyroid','zig-zag'].includes(String(settings.infillResolvedPattern)))throw Error('Invalid automatic infill pattern.');
  for(const [key,value] of Object.entries(settings)){
    if(value===undefined||common.has(key))continue;
    const field=key.startsWith('bambu.')?byKey.get(key.slice(6)):undefined;
    if(!field||nativeAliases[field.key])throw Error(`Process setting ${key} is unsupported. Use a named Bambu setting.`);
    output[field.key]=nativeValue(field,value);
  }
  return output;
}
export function displayNativeValue(field:BambuOption,settings:ProcessSettings,base:Record<string,unknown>):string|number|boolean|undefined{
  const key=processSettingKey(field);if(settings[key]!==undefined)return settings[key];
  if(['outer_wall_speed','inner_wall_speed','sparse_infill_speed','internal_solid_infill_speed','top_surface_speed','gap_infill_speed'].includes(field.key))return settings.speed;
  if(field.key==='sparse_infill_pattern'&&settings.infillMode==='auto'&&settings.infillResolvedPattern)return settings.infillResolvedPattern;
  if(field.key==='support_type')return (settings.supportStyle==='tree'||settings.supportStyle==='auto'&&settings.supportResolvedStyle==='tree')?'tree(auto)':'normal(auto)';
  if(field.key==='support_threshold_angle')return settings.supportThreshold??45;
  const value=Array.isArray(base[field.key])?(base[field.key] as unknown[])[0]:base[field.key];
  return value==='nil'?undefined:typeof value==='string'||typeof value==='number'||typeof value==='boolean'?value:undefined;
}
