import { parseGcode } from '../adapters/toolpaths';
import {buildPathBuffers} from './toolpath-buffers';

self.onmessage = (event: MessageEvent<{ key: string; gcode: string; nativeBambu?:boolean }>) => {
  const { key, gcode,nativeBambu } = event.data;
  try {
    const {segments,...preview}=parseGcode(gcode,{nativeBambu});
    const renderBuffers=buildPathBuffers({segments});
    // Transfer packed GPU data, not hundreds of thousands of segment objects.
    const transfer=renderBuffers.flatMap(buffer=>[buffer.positions.buffer,buffer.starts.buffer,buffer.widths.buffer,buffer.heights.buffer]);
    self.postMessage({key,preview:{...preview,segmentCount:segments.length,renderBuffers}},{transfer});
  }
  catch (error) { self.postMessage({ key, error: (error as Error).message }); }
};
