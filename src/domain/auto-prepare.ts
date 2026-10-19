import { Euler, Matrix4 } from 'three';
import type { Job, JobItem, Project } from './model';
import { layoutItem, validateDimensions } from './invariants';
import { parseSTL } from '../adapters/geometry';

type Rect = { x: number; y: number; w: number; h: number };
const intersects = (a: Rect, b: Rect) => a.x < b.x + b.w - .001 && a.x + a.w > b.x + .001 && a.y < b.y + b.h - .001 && a.y + a.h > b.y + .001;

/** All-or-nothing packing of the existing, versioned copy grids. Rotations,
 * geometry and quantities remain the operator's inputs. */
export function arrangePlate(project: Project, job: Job): JobItem[] {
  if (!job.items.length) throw new Error('Add at least one make part to this plate.');
  const gap = Math.max(8, job.settings.brimWidth * 2 + 4, job.settings.supports ? 24 : 0), margin = 5 + job.settings.brimWidth + (job.settings.supports?10:0);
  const [width, depth, height] = job.printer.buildVolume;
  if (![width, depth, height, margin, gap].every(Number.isFinite) || margin < 0 || width <= 2 * margin || depth <= 2 * margin) throw new Error('Check the printer volume and brim width before arranging.');
  const groups = job.items.map(item => {
    const part = project.parts.find(part => part.id === item.partId);
    const total = item.quantity + item.spareQuantity;
    if (!part || !Number.isInteger(total) || total < 1 || total > 1000 || item.orientation.some(value => !Number.isFinite(value))) throw new Error('Correct missing parts, quantities or rotations before arranging.');
    validateDimensions(part.geometry.dimensions);
    const spacing=Math.max(item.copySpacing??8,gap),preparedItem={...item,copySpacing:spacing};
    const dimensions = layoutItem(part, preparedItem)[0].dimensions;
    if (dimensions[2] > height) throw new Error(`${part.name} is taller than the printer volume in its selected rotation. Rotate it or split the job.`);
    const columns = Math.ceil(Math.sqrt(total)), rows = Math.ceil(total / columns);
    return { item:preparedItem, dimensions, w: columns * dimensions[0] + (columns - 1) * spacing, h: rows * dimensions[1] + (rows - 1) * spacing };
  }).sort((a, b) => b.w * b.h - a.w * a.h || a.item.partId.localeCompare(b.item.partId));
  let free: Rect[] = [{ x: margin, y: margin, w: width - 2 * margin + gap, h: depth - 2 * margin + gap }];
  const placed = new Map<string, { item: JobItem; rect: Rect }>();
  for (const group of groups) {
    const w = group.w + gap, h = group.h + gap;
    const space = free.filter(rect => w <= rect.w + .001 && h <= rect.h + .001)
      .sort((a, b) => Math.min(a.w - w, a.h - h) - Math.min(b.w - w, b.h - h) || a.y - b.y || a.x - b.x)[0];
    if (!space) throw new Error('These copies do not fit on one plate with the selected rotations and clearance. Reduce quantities or split the job; no partial arrangement was applied.');
    const used = { x: space.x, y: space.y, w, h };
    const split: Rect[] = [];
    for (const rect of free) {
      if (!intersects(rect, used)) { split.push(rect); continue; }
      if (used.x > rect.x) split.push({ ...rect, w: used.x - rect.x });
      if (used.x + w < rect.x + rect.w) split.push({ ...rect, x: used.x + w, w: rect.x + rect.w - used.x - w });
      if (used.y > rect.y) split.push({ ...rect, h: used.y - rect.y });
      if (used.y + h < rect.y + rect.h) split.push({ ...rect, y: used.y + h, h: rect.y + rect.h - used.y - h });
    }
    free = split.filter((rect, i) => rect.w > .001 && rect.h > .001 && !split.some((other, j) => j !== i && other.x <= rect.x && other.y <= rect.y && other.x + other.w >= rect.x + rect.w && other.y + other.h >= rect.y + rect.h && (j < i || other.w > rect.w || other.h > rect.h)));
    if (free.length > 4096) throw new Error('This plate is too complex for automatic packing. Split it into smaller jobs.');
    placed.set(group.item.partId, { item: { ...group.item, orientation: [...group.item.orientation], position: [space.x + group.dimensions[0] / 2, space.y + group.dimensions[1] / 2, 0] }, rect: { x: space.x, y: space.y, w: group.w, h: group.h } });
  }
  const all = [...placed.values()], minX = Math.min(...all.map(p => p.rect.x)), minY = Math.min(...all.map(p => p.rect.y));
  const maxX = Math.max(...all.map(p => p.rect.x + p.rect.w)), maxY = Math.max(...all.map(p => p.rect.y + p.rect.h));
  const dx = (width - maxX - minX) / 2, dy = (depth - maxY - minY) / 2;
  return job.items.map(item => { const result = placed.get(item.partId)!.item; result.position[0] += dx; result.position[1] += dy; return result; });
}

export interface SupportRecommendation { style: 'normal' | 'tree'; reason: string; overhangArea: number; ruleVersion: 'overhang-v1'; }
/** Advisory mesh rule, not a claim of optimal support, strength or contact quality.
 * Bambu generates the actual support paths using the exact selected process. */
export async function recommendSupports(project: Project, job: Job): Promise<SupportRecommendation> {
  let totalArea = 0, largestRoof = 0, triangles = 0;
  const threshold = Math.cos((job.settings.supportThreshold ?? 45) * Math.PI / 180);
  for (const item of job.items) {
    const part = project.parts.find(part => part.id === item.partId);
    if (!part) throw new Error('An included part is missing.');
    const vertices = part.geometry.vertices ?? (await parseSTL(part.geometry.stl, 'mm')).vertices!;
    triangles += vertices.length / 9 * (item.quantity + item.spareQuantity);
    if (triangles > 250_000) throw new Error('Split this plate: copies exceed the 250,000 triangle slicing limit.');
    const matrix = new Matrix4().makeRotationFromEuler(new Euler(...item.orientation.map(v => v * Math.PI / 180) as [number, number, number], 'XYZ')).elements;
    const rotated = new Float64Array(vertices.length); let bottom = Infinity;
    for (let i = 0; i < vertices.length; i += 3) {
      const x = vertices[i], y = vertices[i + 1], z = vertices[i + 2];
      rotated[i] = matrix[0] * x + matrix[4] * y + matrix[8] * z;
      rotated[i + 1] = matrix[1] * x + matrix[5] * y + matrix[9] * z;
      rotated[i + 2] = matrix[2] * x + matrix[6] * y + matrix[10] * z;
      bottom = Math.min(bottom, rotated[i + 2]);
    }
    let flatArea = 0;
    for (let i = 0; i < rotated.length; i += 9) {
      if (Math.max(rotated[i + 2], rotated[i + 5], rotated[i + 8]) <= bottom + Math.max(.05, job.settings.layerHeight * 1.5)) continue;
      const ux = rotated[i + 3] - rotated[i], uy = rotated[i + 4] - rotated[i + 1], uz = rotated[i + 5] - rotated[i + 2];
      const vx = rotated[i + 6] - rotated[i], vy = rotated[i + 7] - rotated[i + 1], vz = rotated[i + 8] - rotated[i + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const length = Math.hypot(nx, ny, nz); if (!length || nz / length >= -threshold) continue;
      const area = Math.abs(nz) / 2; totalArea += area * (item.quantity + item.spareQuantity);
      if (nz / length < -.98) flatArea += area;
    }
    largestRoof = Math.max(largestRoof, flatArea);
  }
  const style = largestRoof >= 225 ? 'normal' : totalArea > 1 ? 'tree' : 'normal';
  return { style, overhangArea: totalArea, ruleVersion: 'overhang-v1', reason: largestRoof >= 225
    ? 'Broad downward-facing roofs: normal automatic support is the starting point.'
    : totalArea > 1 ? 'Smaller downward-facing regions: tree automatic support is the starting point.'
    : 'No significant elevated downward faces were flagged. The slicer still evaluates support needs.' };
}
