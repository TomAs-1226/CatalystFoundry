import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseGcode } from '../src/adapters/toolpaths';
const header = 'G21\nG90\nM83\nG0 X0 Y0 Z0.2\n';
describe('conservative actual G-code preview', () => {
  it('reads actual walls, infill, support and travel by layer', () => {
    const result = parseGcode(header + ';TYPE:Outer wall\nG1 X10 Y0 E1\n;TYPE:Sparse infill\nG1 X10 Y10 E1\n;TYPE:Support\nG1 X0 Y10 E1\nG0 Z0.4\nG1 X0 Y0 E1');
    expect(result.canApprove).toBe(true); expect(result.layers.map(layer => layer.z)).toEqual([0.2, 0.4]);
    expect(result.segments.map(segment => segment.feature)).toEqual(['travel', 'wall', 'infill', 'support', 'travel', 'support']);
    expect(result.extrusionMm).toBe(4); expect(result.layers[1].startSegment).toBe(5);
  });
  it('converts explicit inch coordinates, relative motion and extrusion to mm exactly', () => {
    const result = parseGcode('G20\nG90\nM83\nG0 Z0.01\nG1 X1 E0.1\nG91\nG1 Y0.5 E0.1');
    expect(result.segments.at(-1)?.to).toEqual([25.4, 12.7, 0.254]);
    expect(result.extrusionMm).toBeCloseTo(5.08); expect(result.sourceUnits).toEqual(['inch']);
    expect(result.canApprove).toBe(true);
  });
  it('keeps physical XYZ fixed on G92 and handles absolute E reset and retractions', () => {
    const result = parseGcode('G21\nG90\nM82\nG0 X10 Z0.2\nG1 X20 E1\nG92 X0 E0\nG1 X5 E1\nG1 X7 E0.5');
    expect(result.segments[2].from).toEqual([20, 0, 0.2]); expect(result.segments[2].to).toEqual([25, 0, 0.2]);
    expect(result.segments.at(-1)?.feature).toBe('travel'); expect(result.extrusionMm).toBe(2);
  });
  it('handles compact syntax, comments, line numbers and checksums', () => {
    const result = parseGcode('N1 G21*1\nG90\nM83\nG0Z.2\n; FEATURE: Outer wall\nN5 G1X10Y5E.5F1200*42');
    expect(result.segments.at(-1)).toMatchObject({ to: [10, 5, 0.2], feature: 'wall', feedrateMmMin: 1200 });
  });
  it('blocks approval when units, extrusion mode or coordinate transforms are unsupported', () => {
    const missing = parseGcode('G0 Z0.2\nG1 X10 E1'); expect(missing.canApprove).toBe(false);
    expect(missing.blockingIssues.join(' ')).toMatch(/G20\/G21/); expect(missing.blockingIssues.join(' ')).toMatch(/M82\/M83/);
    const arcs = parseGcode(header + 'G1 X10 E1\nG2 X20 I5 E2\nG54');
    expect(arcs.unsupportedCommands).toEqual(['G54']); expect(arcs.canApprove).toBe(false);
  });
  it('does not hide nonplanar or descending extrusion or unrecognized parameters', () => {
    const result = parseGcode(header + 'G1 X10 Z0.3 E1\nG1 X15 Z0.1 E1\nG1 X20 A50 E1');
    expect(result.canApprove).toBe(false); expect(result.blockingIssues.join(' ')).toMatch(/Nonplanar|descends/);
    expect(result.blockingIssues.join(' ')).toMatch(/parameters A/);
  });
  it('does not confuse z-hop travel with an extrusion layer', () => {
    const result = parseGcode(header + 'G1 X10 E1\nG0 Z1\nG0 X15\nG0 Z0.2\nG1 X20 E1');
    expect(result.layers).toHaveLength(1);
  });
  it('rejects empty, binary, oversized, invalid and nonextruding imports', () => {
    for (const value of ['', '\0G21', 'this is not gcode', 'G21\nG0 X10']) expect(() => parseGcode(value)).toThrow();
    expect(() => parseGcode(header + 'G1 X10 E1', { maxBytes: 10 })).toThrow(/limit/);
    expect(() => parseGcode(header + 'G1 X10 E1\nG1 X20 E1', { maxSegments: 1 })).toThrow(/segment/);
    expect(() => parseGcode(header + 'G1 X10 X20 E1')).toThrow(/Duplicate/);
    expect(() => parseGcode(header + 'G1 X100001 E1')).toThrow(/units/);
    expect(() => parseGcode(header + 'G1 X10 E1 F-20')).toThrow(/Negative/);
  });
  it('never executes machine commands and warns on omitted simulation', () => {
    const result = parseGcode(header + 'M104 S220\nM117 Hello world\nG1 X10 E1');
    expect(result.canApprove).toBe(true); expect(result.warnings.join(' ')).toMatch(/not simulated/);
  });
  it('keeps unsupported proprietary arguments blocking while still previewing supported movement',()=>{const result=parseGcode(header+'M970.3 Q0 A7 Q0\nG1 X10 E1');expect(result.canApprove).toBe(false);expect(result.unsupportedCommands).toContain('M970.3');expect(result.segments.at(-1)?.to).toEqual([10,0,0.2]);expect(()=>parseGcode(header+'G1 X10 X20 E1')).toThrow(/Duplicate/);});
  it('ignores bounded nonexecuting long metadata comments without admitting long executable lines or unsupported commands',()=>{
    const text='; machine_start_gcode = '+ 'G28 \n'.repeat(6000).replace(/\n/g,'\\n')+'\n'+header+'G1 X10 E1\n';
    expect(parseGcode(text).canApprove).toBe(true);
    expect(()=>parseGcode(header+'G1 X10 E1 ;'+'x'.repeat(17000))).toThrow(/too long/);
    expect(parseGcode(text+'G28\n').canApprove).toBe(false);
    expect(()=>parseGcode(text,{maxBytes:1000})).toThrow(/limit/);
  });
  it('labels manually authored demonstration fixture and reads its real paths', () => {
    const result = parseGcode(readFileSync(new URL('../public/fixtures/bracket-demo.gcode', import.meta.url), 'utf8'));
    expect(result.isDemonstration).toBe(true); expect(result.layers).toHaveLength(24);
    expect(result.canApprove).toBe(true); expect(result.warnings.join(' ')).toMatch(/not for machine use/);
    expect(new Set(result.segments.map(segment => segment.feature))).toEqual(new Set(['wall', 'infill', 'support', 'travel']));
  });
});
