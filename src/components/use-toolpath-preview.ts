import { useEffect, useState } from 'react';
import type { ToolpathPreview } from '../adapters/toolpaths';
import type {PathBuffer} from './toolpath-buffers';
export type RenderToolpathPreview=Omit<ToolpathPreview,'segments'>&{segmentCount:number;renderBuffers:PathBuffer[]};

/** Superseded parses terminate immediately; old replies can never replace a new job. */
export function useToolpathPreview(key: string, gcode?: string,nativeBambu=false) {
  const [result, setResult] = useState<{ key: string; preview?: RenderToolpathPreview; error?: string }>();
  useEffect(() => {
    if (!gcode) return;
    let disposed = false;
    let worker: Worker;
    try {
      worker = new Worker(new URL('./toolpath-preview.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = event => {
        if (!disposed && event.data.key === key) setResult(event.data);
      };
      worker.onerror = () => { if (!disposed) setResult({ key, error: 'Layer preview could not load. Try Show layers again or reopen the job.' }); };
      worker.postMessage({ key, gcode,nativeBambu });
    } catch (error) { setResult({ key, error: `Cannot start layer preview: ${(error as Error).message}` }); }
    return () => { disposed = true; worker?.terminate(); };
  }, [key, gcode,nativeBambu]);
  return { preview: gcode && result?.key === key ? result.preview : undefined,
    error: gcode && result?.key === key ? result.error : undefined,
    loading: !!gcode && result?.key !== key };
}
