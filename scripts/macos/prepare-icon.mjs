/** Repackage existing PNG icon frames losslessly; no generated artwork. */
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export function icnsFromIco(bytes){
 if(bytes.readUInt16LE(0)!==0||bytes.readUInt16LE(2)!==1)throw Error('Expected the existing ICO asset.');
 const entries=[],types={128:['ic07','ic12'],256:['ic08','ic13'],512:['ic09','ic14'],1024:['ic10']};
 for(let i=0;i<bytes.readUInt16LE(4);i++){
  const at=6+i*16,size=bytes.readUInt32LE(at+8),offset=bytes.readUInt32LE(at+12),png=bytes.subarray(offset,offset+size);
  if(png.length<24||png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')continue;
  const width=png.readUInt32BE(16);if(png.readUInt32BE(20)!==width||!types[width])continue;
  for(const type of types[width]){const header=Buffer.alloc(8);header.write(type);header.writeUInt32BE(png.length+8,4);entries.push(Buffer.concat([header,png]));}
 }
 if(!entries.length)throw Error('The ICO lacks a usable PNG icon frame.');
 const header=Buffer.alloc(8);header.write('icns');header.writeUInt32BE(8+entries.reduce((size,entry)=>size+entry.length,0),4);return Buffer.concat([header,...entries]);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await writeFile('packaging/assets/foundry.icns',icnsFromIco(await readFile('packaging/assets/foundry.ico')));
