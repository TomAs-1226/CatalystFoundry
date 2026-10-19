import { Box3, MathUtils, Vector3 } from 'three';

export interface CameraViewport { width: number; height: number }
export interface CameraInsets { top: number; right: number; bottom: number; left: number }
export interface CameraFrame {
  position: Vector3;
  target: Vector3;
  up: Vector3;
  distance: number;
  near: number;
  far: number;
  aspect: number;
  viewport: CameraViewport;
  /** Three.js setViewOffset arguments, preserving an optical centre in the usable area. */
  viewOffset: { x: number; y: number };
}
export interface CameraFrameOptions {
  viewport: CameraViewport;
  direction?: Vector3;
  target?: Vector3;
  up?: Vector3;
  fov?: number;
  insets?: Partial<CameraInsets>;
  padding?: number;
}

const finiteVector = (value: Vector3) => value.toArray().every(Number.isFinite);
const positive = (value: number, fallback: number) => Number.isFinite(value) && value > 0 ? value : fallback;

function safeBounds(source: Box3): Box3 {
  const bounds = !source.isEmpty() && finiteVector(source.min) && finiteVector(source.max)
    ? source.clone() : new Box3(new Vector3(0, 0, 0), new Vector3(256, 256, 20));
  // A point or empty import must never generate a zero-distance/NaN camera.
  // This only frames the view; it does not change or repair source geometry.
  if (bounds.getSize(new Vector3()).lengthSq() < 1e-12) bounds.expandByScalar(15);
  return bounds;
}

/**
 * Computes a perspective fit using every projected bounding-box corner. World
 * axis maxima alone do not cover oblique views or narrow aspect ratios. Insets
 * reserve actual viewport chrome; the projection centre moves into that area.
 * No source geometry, camera, or bounds are mutated.
 */
export function cameraFrameForBounds(source: Box3, options: CameraFrameOptions): CameraFrame {
  const bounds = safeBounds(source);
  const viewport = { width: positive(options.viewport.width, 1), height: positive(options.viewport.height, 1) };
  const inset = (value: number | undefined, dimension: number) => Math.min(Math.max(0, Number.isFinite(value) ? value! : 16), dimension * .35);
  const left = inset(options.insets?.left, viewport.width), right = inset(options.insets?.right, viewport.width);
  const top = inset(options.insets?.top, viewport.height), bottom = inset(options.insets?.bottom, viewport.height);
  const usableX = 1 - (left + right) / viewport.width, usableY = 1 - (top + bottom) / viewport.height;
  const direction = options.direction?.clone() ?? new Vector3(1, -1.45, 1.12);
  if (!finiteVector(direction) || direction.lengthSq() < 1e-12) direction.set(1, -1.45, 1.12);
  direction.normalize();
  const up = options.up?.clone() ?? new Vector3(0, 0, 1);
  if (!finiteVector(up) || up.lengthSq() < 1e-12) up.set(0, 0, 1);
  up.normalize();
  if (Math.abs(up.dot(direction)) > .9999999) {
    // Keep OrbitControls' fixed world-up convention at the poles. A negligible
    // tilt avoids a singular lookAt without switching the camera's up axis.
    const tangent = Math.abs(up.x) < .9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
    tangent.addScaledVector(up, -tangent.dot(up)).normalize();
    direction.addScaledVector(tangent, .001).normalize();
  }
  const horizontal = new Vector3().crossVectors(up, direction).normalize();
  const vertical = new Vector3().crossVectors(direction, horizontal).normalize();
  const target = options.target && finiteVector(options.target) ? options.target.clone() : bounds.getCenter(new Vector3());
  const fov = options.fov && options.fov > 0 && options.fov < 179 ? options.fov : 34;
  const tanY = Math.tan(MathUtils.degToRad(fov / 2)), aspect = viewport.width / viewport.height;
  const tanX = tanY * aspect;
  const padding = Math.max(1, positive(options.padding ?? 1.05, 1.05));
  const minimumDepth = Math.max(.1, bounds.getSize(new Vector3()).length() * .001);
  if (!options.target || !finiteVector(options.target)) {
    // Perspective makes the near half of a plate appear larger. Centre the
    // projected bounds, rather than leaving empty space above a centred world
    // box. For each corner, the admissible camera-target interval is
    // [x-k(D-z), x+k(D-z)]. Its intersection's midpoint is independent of D.
    // Keeping an explicitly supplied target skips this adjustment (pan/resize).
    const kx = tanX * usableX / padding, ky = tanY * usableY / padding;
    let maxLowerX = -Infinity, minUpperX = Infinity, maxLowerY = -Infinity, minUpperY = Infinity;
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
      const corner = new Vector3(x, y, z).sub(target);
      const cx = corner.dot(horizontal), cy = corner.dot(vertical), depth = corner.dot(direction);
      maxLowerX = Math.max(maxLowerX, cx + kx * depth); minUpperX = Math.min(minUpperX, cx - kx * depth);
      maxLowerY = Math.max(maxLowerY, cy + ky * depth); minUpperY = Math.min(minUpperY, cy - ky * depth);
    }
    target.addScaledVector(horizontal, (maxLowerX + minUpperX) / 2).addScaledVector(vertical, (maxLowerY + minUpperY) / 2);
  }
  let distance = 5;
  let minDepthOffset = Infinity, maxDepthOffset = -Infinity;
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
    const corner = new Vector3(x, y, z).sub(target);
    const depthOffset = corner.dot(direction);
    minDepthOffset = Math.min(minDepthOffset, depthOffset); maxDepthOffset = Math.max(maxDepthOffset, depthOffset);
    distance = Math.max(distance, depthOffset + minimumDepth,
      depthOffset + Math.abs(corner.dot(horizontal)) * padding / (tanX * usableX),
      depthOffset + Math.abs(corner.dot(vertical)) * padding / (tanY * usableY));
  }
  return {
    position: target.clone().addScaledVector(direction, distance), target, up, distance, aspect, viewport,
    near: Math.max(.01, (distance - maxDepthOffset) * .02),
    far: Math.max(1000, (distance - minDepthOffset) * 5),
    viewOffset: { x: (right - left) / 2, y: (bottom - top) / 2 },
  };
}

/** Preserve orbit, pan and zoom relative to a complete fit when the canvas resizes. */
export function resizedCameraFrame(source: Box3, options: CameraFrameOptions & {
  previousViewport: CameraViewport; previousInsets?: Partial<CameraInsets>; position: Vector3; target: Vector3;
}): CameraFrame {
  const direction = options.position.clone().sub(options.target);
  const currentDistance = direction.length();
  const previous = cameraFrameForBounds(source, { ...options, direction, viewport: options.previousViewport, insets: options.previousInsets ?? options.insets });
  const next = cameraFrameForBounds(source, { ...options, direction });
  const nextDirection = next.position.clone().sub(next.target).normalize();
  const ratio = positive(currentDistance, previous.distance) / previous.distance;
  next.distance = Math.max(5, next.distance * ratio);
  next.position.copy(next.target).addScaledVector(nextDirection, next.distance);
  // Zoom may intentionally clip geometry; keep the clipping planes far beyond it.
  next.near = Math.max(.01, Math.min(next.near, next.distance / 1000));
  next.far = Math.max(next.far, next.distance * 10);
  return next;
}
