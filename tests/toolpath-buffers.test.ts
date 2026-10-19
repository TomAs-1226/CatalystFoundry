import { expect, it } from 'vitest';
import { buildPathBuffers, pathDrawRanges } from '../src/components/toolpath-buffers';
import { parseGcode } from '../src/adapters/toolpaths';

it('keeps actual feature/layer geometry, including z-hop travel, and reuses buffers while scrubbing', () => {
  const path = parseGcode('G21\nG90\nM83\nG0 Z.2\n;TYPE:Outer wall\nG1 X10 E1\nG0 Z1\nG0 X15\nG0 Z.2\nG1 X20 E1\nG0 Z.4\n;TYPE:Sparse infill\nG1 X30 E1');
  const buffers = buildPathBuffers(path), walls = buffers.find(b => b.feature === 'wall')!, travel = buffers.find(b => b.feature === 'travel')!, infill = buffers.find(b => b.feature === 'infill')!;
  expect([...walls.positions]).toEqual(path.segments.filter(s => s.feature === 'wall').flatMap(s => [...s.from, ...s.to]).map(Math.fround));
  expect(pathDrawRanges(walls, 0)).toEqual({ context: { start: 0, count: 0 }, active: { start: 0, count: 4 } });
  expect(pathDrawRanges(walls, 1)).toEqual({ context: { start: 0, count: 4 }, active: { start: 4, count: 0 } });
  expect(pathDrawRanges(infill, 0).active.count).toBe(0); expect(pathDrawRanges(infill, 1).active.count).toBe(2);
  expect(pathDrawRanges(travel, 0).active.count).toBe(path.segments.filter(s => s.feature === 'travel').length * 2);
  const positions = walls.positions;
  for (let i = 0; i < 1000; i++) pathDrawRanges(walls, i % 2);
  expect(walls.positions).toBe(positions); expect(pathDrawRanges(walls).active.count).toBe(4);
});
it('indexes unordered input by layer without changing source coordinates', () => {
  const segments = [2, 0, 1].map(layer => ({ from: [layer, 0, 0] as const, to: [layer + 1, 0, 0] as const, layer, feature: 'wall' as const }));
  const [buffer] = buildPathBuffers({ segments });
  expect([...buffer.starts]).toEqual([0, 2, 4, 6]);
  expect([...buffer.positions]).toEqual([0,0,0,1,0,0,1,0,0,2,0,0,2,0,0,3,0,0]);
  expect(segments[0].layer).toBe(2);
});
it('bounds malformed layer allocations and empty paths', () => {
  expect(buildPathBuffers({ segments: [] })).toEqual([]);
  for (const layer of [NaN, Infinity, -1, .5, 1e9]) expect(() => buildPathBuffers({ segments: [{ from:[0,0,0], to:[1,0,0], feature:'wall', layer }] })).toThrow();
});
it('indexes the full supported segment limit once and scrubs without accessing source segments again', () => {
  const segments = Array.from({length:250000}, (_, i) => ({from:[i % 200,0,0] as const, to:[i % 200,1,0] as const, feature:'wall' as const, layer:Math.floor(i/250)}));
  const [buffer] = buildPathBuffers({ segments });
  expect(buffer.positions.byteLength).toBe(250000 * 6 * 4);
  Object.defineProperty(segments, '0', {get: () => { throw new Error('Scrubbing scanned source geometry'); }});
  for (let layer = 0; layer < 1000; layer++) {
    const ranges = pathDrawRanges(buffer, layer);
    expect(ranges.active.count).toBe(500); expect(ranges.context.count).toBe(layer * 500);
  }
});
