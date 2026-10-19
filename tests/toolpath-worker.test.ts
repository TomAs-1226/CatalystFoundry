import { expect, it } from 'vitest';
import { build } from 'esbuild';
import { Worker } from 'node:worker_threads';
import { parseGcode } from '../src/adapters/toolpaths';
import {buildPathBuffers} from '../src/components/toolpath-buffers';

it('executes the production preview worker off-thread, preserving parser warnings and request identity', async () => {
  const bundled = await build({ entryPoints: ['src/components/toolpath-preview.worker.ts'], bundle: true, write: false, format: 'cjs', platform: 'browser' });
  // Only the browser message transport is shimmed; the actual production worker is bundled and executed.
  const worker = new Worker(`const {parentPort}=require('node:worker_threads');global.self={postMessage:(value,options)=>parentPort.postMessage(value,options?.transfer)};${bundled.outputFiles[0].text};parentPort.on('message',data=>self.onmessage({data}));`, { eval: true });
  const request = (key: string, gcode: string) => new Promise<any>((resolve, reject) => {
    worker.once('message', resolve); worker.once('error', reject); worker.postMessage({ key, gcode });
  });
  try {
    const gcode = 'G28\nG21\nG90\nM83\nG0 Z.2\n;TYPE:Outer wall\nG1 X10 E1\nG0 Z.4\nG1 X20 E1';
    const result = await request('job-A:result-1', gcode);
    const {segments,...metadata}=parseGcode(gcode);
    expect(result.key).toBe('job-A:result-1'); expect(result.preview).toEqual({...metadata,segmentCount:segments.length,renderBuffers:buildPathBuffers({segments})});
    expect(result.preview.segments).toBeUndefined();expect(result.preview.renderBuffers[0].positions).toBeInstanceOf(Float32Array);
    expect(result.preview.canApprove).toBe(false); expect(result.preview.layers).toHaveLength(2);
    const invalid = await request('job-B:result-2', 'not a toolpath');
    expect(invalid.key).toBe('job-B:result-2'); expect(invalid.error).toMatch(/No supported extrusion/); expect(invalid.preview).toBeUndefined();
  } finally { await worker.terminate(); }
});
