/** CPU/parser/allocation acceptance only. No UI automation or GPU claim. */
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {unzipSync,strFromU8} from 'fflate';
import {parseGcode} from '../../src/adapters/toolpaths';
import {buildPathBuffers,pathDrawRanges} from '../../src/components/toolpath-buffers';
const directory=resolve(process.argv[2]??'../../evidence/plate-workspace-native'),reports=[];
for(const folder of await readdir(directory)){
 if(folder==='summary.json')continue;
 const bytes=await readFile(join(directory,folder,'NON-MANUFACTURABLE.3mf')),archive=unzipSync(bytes),name=Object.keys(archive).find(name=>/plate_\d+[.]gcode$/i.test(name));if(!name)throw Error('No actual native plate');
 const gcode=strFromU8(archive[name]),lines=gcode.split('\n'),started=performance.now(),parsed=parseGcode(gcode),parseMs=performance.now()-started;
 const expectedLayers=lines.filter(line=>/^\s*;\s*CHANGE_LAYER\s*$/i.test(line)).length;
 if(parsed.layers.length!==expectedLayers)throw Error('Native layer markers were not preserved');
 if(parsed.unsupportedCommands.some(command=>['G2','G3'].includes(command)))throw Error('Native arcs remain unsupported');
 const first=lines.findIndex(line=>/^; CHANGE_LAYER/.test(line)),end=lines.findIndex(line=>/^; MACHINE_END_GCODE_START/.test(line));
 const arcs=lines.map((line,index)=>({line,index})).filter(entry=>/^G[23]\s/.test(entry.line)&&entry.index>first&&entry.index<end);
 if(!arcs.every(entry=>parsed.segments.some(segment=>segment.line===entry.index+1&&segment.printMove)))throw Error('A native print arc was silently omitted');
 const allocationStart=performance.now(),buffers=buildPathBuffers(parsed),bufferMs=performance.now()-allocationStart;
 for(const buffer of buffers){const original=buffer.positions;for(let layer=0;layer<expectedLayers;layer++)pathDrawRanges(buffer,layer);if(buffer.positions!==original)throw Error('Scrubbing rebuilt geometry');}
 const extrusionBuffers=buffers.filter(buffer=>buffer.feature!=='travel'),instances=extrusionBuffers.reduce((sum,b)=>sum+b.positions.length/6,0);
 const report={folder,nativeLayers:expectedLayers,parsedLayers:parsed.layers.length,printArcs:arcs.length,allPrintArcsRepresented:true,parsedSegments:parsed.segments.length,displayExtrusionInstances:instances,parseMs,bufferMs,previewCpuBufferBytes:buffers.reduce((sum,b)=>sum+b.positions.byteLength+b.starts.byteLength+b.widths.byteLength+b.heights.byteLength,0),instanceMatrixBytes:instances*16*4,extrusionDrawCalls:extrusionBuffers.length,scrubbingReusesBuffers:true,canApprove:parsed.canApprove,remainingUnsupportedCommands:parsed.unsupportedCommands,gpuRendering:'untested',lowEndLaptopFPS:'untested'};
 reports.push(report);console.log(JSON.stringify(report));
}
if(reports.length!==4)throw Error('Expected four native support cases');
await writeFile(join(directory,'../plate-workspace-preview.json'),JSON.stringify({passed:true,scope:'Actual native fixture G-code parsed and indexed on CPU, all arcs and explicit layers checked; no UI or GPU validation',reports},null,2)+'\n');
