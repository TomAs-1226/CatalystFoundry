import {unzipSync,strFromU8} from 'fflate';
import type {SlicerProjectArtifact} from '../domain/model';
/** Hash is independently checked by the caller. Never elevate a loose G-code header. */
export function assertNativeArtifact(gcode:string,artifact:SlicerProjectArtifact|undefined){
  if(!artifact||artifact.format!=='3mf'||artifact.encoding!=='base64'||artifact.data.length>70*1024*1024)throw Error('A matching native 3MF is required for native toolpath review.');
  let count=0,oversize=false;
  const archive=unzipSync(Uint8Array.from(atob(artifact.data),c=>c.charCodeAt(0)),{filter:file=>{if(!/(?:^|\/)plate_\d+\.gcode$/i.test(file.name))return false;count++;if(file.originalSize>10*1024*1024){oversize=true;return false;}return true;}});
  const keys=Object.keys(archive);
  if(count!==1||oversize||keys.length!==1||strFromU8(archive[keys[0]])!==gcode)throw Error('The native 3MF does not contain this exact single bounded toolpath.');
}
