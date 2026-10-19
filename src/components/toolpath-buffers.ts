import type { ToolpathFeature, ViewerToolpath } from './WorkspaceViewer';

export interface PathBuffer {
  feature: ToolpathFeature;
  positions: Float32Array;
  /** Start vertex for each layer, plus a final sentinel. */
  starts: Uint32Array;
  widths: Float32Array;
  heights: Float32Array;
  bounds?: {min:[number,number,number];max:[number,number,number]};
}
export const pathFeatures = ['wall', 'infill', 'support', 'travel', 'other'] as const;

/** Allocate each feature once. Layer scrubbing changes draw ranges, never geometry. */
export function buildPathBuffers(path: ViewerToolpath): PathBuffer[] {
  if ((path.segments?.length??0) > 250_000) throw new Error('Toolpath exceeds preview limits.');
  for (const segment of path.segments??[]) {
    if (!Number.isInteger(segment.layer) || segment.layer < 0 || segment.layer > 250_000 || !pathFeatures.includes(segment.feature)
      || ![...segment.from, ...segment.to].every(Number.isFinite)) throw new Error('Invalid toolpath preview coordinates or layer.');
  }
  const segments=(path.segments??[]).filter(segment=>segment.printMove!==false);
  const layerCount = segments.reduce((count, segment) => Math.max(count, segment.layer + 1), 0);
  const buffers = pathFeatures.map(feature => {
    const starts = new Uint32Array(layerCount + 1);
    for (const segment of segments) if (segment.feature === feature) starts[segment.layer + 1] += 2;
    for (let i = 1; i < starts.length; i++) starts[i] += starts[i - 1];
    return { feature, starts, positions: new Float32Array(starts[layerCount] * 3),widths:new Float32Array(starts[layerCount]/2),heights:new Float32Array(starts[layerCount]/2),bounds:{min:[Infinity,Infinity,Infinity] as [number,number,number],max:[-Infinity,-Infinity,-Infinity] as [number,number,number]} };
  });
  const byFeature = new Map(buffers.map(buffer => [buffer.feature, { buffer, cursor: buffer.starts.slice() }]));
  for (const segment of segments) {
    const { buffer, cursor } = byFeature.get(segment.feature)!;
    const offset = cursor[segment.layer] * 3;
    buffer.positions.set(segment.from, offset); buffer.positions.set(segment.to, offset + 3);
    const index=cursor[segment.layer]/2;
    buffer.widths[index]=segment.width??0;buffer.heights[index]=segment.height??0;
    for(let axis=0;axis<3;axis++){buffer.bounds.min[axis]=Math.min(buffer.bounds.min[axis],segment.from[axis],segment.to[axis]);buffer.bounds.max[axis]=Math.max(buffer.bounds.max[axis],segment.from[axis],segment.to[axis]);}
    cursor[segment.layer] += 2;
  }
  return buffers.filter(buffer => buffer.positions.length > 0);
}

export function pathDrawRanges(buffer: PathBuffer, layer = Infinity) {
  const total = buffer.positions.length / 3;
  if (layer === Infinity) return { context: { start: 0, count: 0 }, active: { start: 0, count: total } };
  const index = Math.max(0, Math.floor(Number.isFinite(layer) ? layer : 0));
  const start = buffer.starts[Math.min(index, buffer.starts.length - 1)] ?? 0;
  const end = buffer.starts[Math.min(index + 1, buffer.starts.length - 1)] ?? total;
  return { context: { start: 0, count: start }, active: { start, count: end - start } };
}
