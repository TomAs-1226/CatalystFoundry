import {readFile,readdir,writeFile} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
const cppPath=resolve(process.argv[2]??'../../bambu-source-inspect/BambuStudio-02.08.02.61/src/libslic3r/PrintConfig.cpp');
const cpp=await readFile(cppPath,'utf8'),profileDir='vendor/bambu/resources/profiles/BBL/process',values=new Map();
for(const file of (await readdir(profileDir)).sort()){if(!file.endsWith('.json'))continue;const profile=JSON.parse(await readFile(join(profileDir,file),'utf8'));for(const [key,value] of Object.entries(profile)){const list=values.get(key)??[];if(!list.some(x=>JSON.stringify(x)===JSON.stringify(value)))list.push(value);values.set(key,list);}}
const template=JSON.parse(await readFile(resolve(dirname(cppPath),'../../resources/profiles_template/Template/process/process template.json'),'utf8'));
for(const [key,value] of Object.entries(template))if(!values.has(key))values.set(key,[value]);
const tab=await readFile(resolve(dirname(cppPath),'../slic3r/GUI/Tab.cpp'),'utf8'),printTab=tab.slice(tab.indexOf('void TabPrint::build()'),tab.indexOf('void TabPrint::reload_config()'));
for(const match of printTab.matchAll(/(?:append_single_option_line|get_option)\(\s*"([^"]+)"/g))if(!values.has(match[1]))values.set(match[1],[]);
const matches=[...cpp.matchAll(/def\s*=\s*this->add\(\s*"([^"]+)"\s*,\s*(co\w+)\s*\);/g)],blocks=new Map(matches.map((m,i)=>[m[1],{type:m[2],text:cpp.slice(m.index,matches[i+1]?.index??cpp.length)}]));
const variables=new Map(matches.flatMap(m=>{const alias=cpp.slice(Math.max(0,m.index-70),m.index).match(/(\w+)\s*=\s*$/)?.[1];return alias?[[alias,m[1]]]:[];}));
const quote='"((?:[^"\\\\]|\\\\.)*)"',strings=text=>[...text.matchAll(new RegExp(quote,'g'))].map(m=>{try{return JSON.parse('"'+m[1]+'"');}catch{return m[1];}});
const textValue=(block,name)=>{const tail=block.match(new RegExp('def->'+name+'\\s*=\\s*L\\(([\\s\\S]*?)\\);'))?.[1]??block.match(new RegExp('def->'+name+'\\s*=\\s*("[^";]*")\\s*;'))?.[1];return tail?strings(tail).join(''):undefined;};
const excluded=[],fields=[];
for(const [key,presetValues] of [...values].sort(([a],[b])=>a.localeCompare(b))){
  const block=blocks.get(key);
  if(!block||/^(?:type|name|from|instantiation|inherits|include|setting_id|version|description|alias|renamed_from)$/.test(key)||(/gcode|filename|post_process|compatible|printer|filament|extruder|host|url|path|script|thumbnail/i.test(key)&&!['override_filament_scarf_seam_setting','gcode_add_line_number'].includes(key))){excluded.push(key);continue;}
  const {type,text}=block;
  if(!['coBool','coBools','coInt','coInts','coFloat','coFloats','coPercent','coPercents','coFloatOrPercent','coFloatsOrPercents','coEnum'].includes(type)){excluded.push(key);continue;}
  const label=textValue(text,'label');if(!label){excluded.push(key);continue;}
  const options=[...text.matchAll(/def->enum_values\.(?:push_back|emplace_back)\(\s*"([^"]+)"\s*\)/g)].map(m=>m[1]);
  const assigned=text.match(/def->enum_values\s*=\s*\{([\s\S]*?)\};/)?.[1];if(assigned)options.push(...strings(assigned));
  if(type==='coEnum'&&!options.length)for(const value of presetValues.flat())if(typeof value==='string'&&!options.includes(value))options.push(value);
  const inherit=variables.get(text.match(/def->enum_values\s*=\s*(\w+)->enum_values/)?.[1]??text.match(/append\(def->enum_values,\s*(\w+)->enum_values/)?.[1]);
  if(type==='coEnum'&&!options.length&&!inherit){excluded.push(key);continue;}
  const optionLabels=[...text.matchAll(/def->enum_labels\.(?:push_back|emplace_back)\(\s*L\(\s*"([^"]+)"\s*\)\s*\)/g)].map(m=>m[1]);
  const number=name=>{const value=text.match(new RegExp('def->'+name+'\\s*=\\s*(-?\\d+(?:\\.\\d+)?)\\s*;'))?.[1];return value===undefined?undefined:Number(value);};
  fields.push({key,label,category:textValue(text,'category')??'Other',type,unit:textValue(text,'sidetext')??'',min:number('min'),max:number('max'),...(options.length?{options:[...new Set(options)],optionLabels}:{}),...(inherit?{inherit}:{}),description:(textValue(text,'tooltip')??'').slice(0,2500)});
}
for(let pass=0;pass<4;pass++)for(const field of fields)if(field.inherit){const other=fields.find(f=>f.key===field.inherit);if(other?.options?.length){field.options=[...other.options];field.optionLabels=[...other.optionLabels];delete field.inherit;}}
for(const field of fields)if(field.type==='coEnum'&&!field.options?.length)throw Error('Unresolved native enumeration: '+field.key);
const result={version:'Bambu Studio 2.8.2.61',source:'bambulab/BambuStudio v02.08.02.61 src/libslic3r/PrintConfig.cpp, src/slic3r/GUI/Tab.cpp and pinned BBL process presets',sourceSha256:createHash('sha256').update(cpp).digest('hex'),tabSourceSha256:createHash('sha256').update(tab).digest('hex'),scope:'Numeric, Boolean and enumerated BBL process controls. Machine/filament definitions, scripts, paths, compatibility metadata and multi-extruder assignments are excluded.',fields,excluded};
await writeFile('src/domain/bambu-process-options.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({fields:fields.length,excluded:excluded.length,categories:[...new Set(fields.map(f=>f.category))],sourceSha256:result.sourceSha256}));
