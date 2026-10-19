import { writeFile } from 'node:fs/promises';
import { buildPathBuffers, pathDrawRanges } from '../../src/components/toolpath-buffers';

const segments = Array.from({ length: 250_000 }, (_, index) => ({
  from: [index % 200, 0, index / 250] as const, to: [index % 200, 1, index / 250] as const,
  feature: (index % 2 ? 'infill' : 'wall') as 'infill' | 'wall', layer: Math.floor(index / 250),
}));
const started = performance.now(), buffers = buildPathBuffers({ segments }), built = performance.now();
let vertices = 0;
for (let index = 0; index < 10_000; index++) for (const buffer of buffers)
  vertices += pathDrawRanges(buffer, index % 1000).active.count;
const report = { recordedAt: new Date().toISOString(), runtime: process.version, platform: process.platform,
  sourceSegments: segments.length, layers: 1000, featureBuffers: buffers.length,
  positionBufferBytes: buffers.reduce((sum, buffer) => sum + buffer.positions.byteLength, 0),
  indexBuildMilliseconds: built - started, drawRangeUpdates: 10_000 * buffers.length,
  drawRangeMilliseconds: performance.now() - built, activeVerticesChecksum: vertices,
  scope: 'Synthetic CPU buffer/index measurement only. No browser UI, GPU, frame rate or low-end laptop validation.' };
await writeFile(process.argv[2] ?? 'preview-benchmark.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
