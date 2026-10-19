import { describe, expect, it } from 'vitest';
import { Box3, PerspectiveCamera, Vector3 } from 'three';
import { cameraFrameForBounds, resizedCameraFrame, type CameraFrame, type CameraInsets } from '../src/components/camera-frame';
import { installedTransformMatrix } from '../src/components/viewer-geometry';

const insets: CameraInsets = { left: 68, right: 20, top: 46, bottom: 42 };
const views = [
  { name: 'isometric', direction: new Vector3(1, -1.45, 1.12) },
  { name: 'top', direction: new Vector3(0, -.001, 1) },
  { name: 'front', direction: new Vector3(0, -1, .001) },
];
const viewports = [
  { name: 'desktop', width: 1120, height: 640 },
  { name: 'compact desktop', width: 640, height: 560 },
  { name: 'narrow', width: 312, height: 480 },
];

function projections(bounds: Box3, frame: CameraFrame): Vector3[] {
  // Assert against Three.js's actual perspective projection, independently of the
  // helper's distance calculation (including its asymmetric optical centre).
  const camera = new PerspectiveCamera(34, frame.aspect, frame.near, frame.far);
  camera.up.copy(frame.up); camera.position.copy(frame.position); camera.lookAt(frame.target);
  camera.setViewOffset(frame.viewport.width, frame.viewport.height, frame.viewOffset.x, frame.viewOffset.y, frame.viewport.width, frame.viewport.height);
  camera.updateMatrixWorld(true);
  const result: Vector3[] = [];
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
    const projected = new Vector3(x, y, z).project(camera);
    result.push(new Vector3((projected.x + 1) * frame.viewport.width / 2, (1 - projected.y) * frame.viewport.height / 2, projected.z));
  }
  return result;
}

function expectInsideUsableArea(bounds: Box3, frame: CameraFrame) {
  const points = projections(bounds, frame);
  for (const point of points) {
    expect(point.x).toBeGreaterThanOrEqual(insets.left - 1e-6);
    expect(point.x).toBeLessThanOrEqual(frame.viewport.width - insets.right + 1e-6);
    expect(point.y).toBeGreaterThanOrEqual(insets.top - 1e-6);
    expect(point.y).toBeLessThanOrEqual(frame.viewport.height - insets.bottom + 1e-6);
    expect(point.z).toBeGreaterThan(-1); expect(point.z).toBeLessThan(1);
  }
  return points;
}

describe('complete perspective framing', () => {
  for (const view of views) for (const viewport of viewports) {
    it(`keeps all eight corners visible in ${view.name} at ${viewport.name} width`, () => {
      for (const bounds of [
        new Box3(new Vector3(0, 0, 0), new Vector3(256, 256, 10)),
        new Box3(new Vector3(-12, -180, 0), new Vector3(12, 180, 220)),
        new Box3(new Vector3(500, -80, 20), new Vector3(900, -20, 32)),
      ]) {
        const original = bounds.clone();
        const frame = cameraFrameForBounds(bounds, { viewport, direction: view.direction, insets });
        const points = expectInsideUsableArea(bounds, frame);
        const occupiedX = (Math.max(...points.map(point => point.x)) - Math.min(...points.map(point => point.x))) / (viewport.width - insets.left - insets.right);
        const occupiedY = (Math.max(...points.map(point => point.y)) - Math.min(...points.map(point => point.y))) / (viewport.height - insets.top - insets.bottom);
        expect(Math.max(occupiedX, occupiedY)).toBeGreaterThan(.78);
        expect(bounds.equals(original)).toBe(true);
      }
    });
  }

  it('uses a useful plate scale without a blanket conservative distance multiplier', () => {
    const bounds = new Box3(new Vector3(0, 0, 0), new Vector3(256, 256, 10));
    const viewport = { width: 1000, height: 650 };
    const frame = cameraFrameForBounds(bounds, { viewport, direction: views[0].direction, insets });
    const points = expectInsideUsableArea(bounds, frame);
    const height = Math.max(...points.map(point => point.y)) - Math.min(...points.map(point => point.y));
    expect(height / (viewport.height - insets.top - insets.bottom)).toBeGreaterThan(.8);
  });

  it('frames exact pole views and point bounds without singular or zero-distance cameras', () => {
    const bounds = new Box3(new Vector3(12, 24, 8), new Vector3(12, 24, 8));
    const frame = cameraFrameForBounds(bounds, { viewport: viewports[2], direction: new Vector3(0, 0, 1), insets });
    expect(frame.position.toArray().every(Number.isFinite)).toBe(true);
    expect(frame.distance).toBeGreaterThan(5); expect(frame.near).toBeGreaterThan(0); expect(frame.far).toBeGreaterThan(frame.near);
    expectInsideUsableArea(bounds, frame);
  });

  it('uses finite recovery framing for empty bounds, invalid dimensions and direction', () => {
    const frame = cameraFrameForBounds(new Box3(), {
      viewport: { width: 0, height: NaN }, direction: new Vector3(NaN, 0, 0),
    });
    expect(frame.position.toArray().every(Number.isFinite)).toBe(true);
    expect(frame.aspect).toBe(1); expect(frame.viewport).toEqual({ width: 1, height: 1 });
    expect(frame.distance).toBeGreaterThan(0); expect(frame.far).toBeGreaterThan(frame.near);
  });
});

describe('responsive framing preserves user camera choices', () => {
  it('retains orbit, pan and relative zoom across narrow resize and back', () => {
    const bounds = new Box3(new Vector3(0, 0, 0), new Vector3(256, 256, 80));
    const wide = viewports[0], narrow = viewports[2];
    const target = new Vector3(148, 103, 32), direction = new Vector3(.43, -1, .72).normalize();
    const initial = cameraFrameForBounds(bounds, { viewport: wide, direction, target, insets });
    const position = target.clone().addScaledVector(direction, initial.distance * 1.4);
    const resized = resizedCameraFrame(bounds, { previousViewport: wide, viewport: narrow, insets, position, target });
    expect(resized.target.equals(target)).toBe(true);
    expect(resized.position.clone().sub(target).normalize().dot(direction)).toBeCloseTo(1, 12);
    expectInsideUsableArea(bounds, resized);
    const narrowFit = cameraFrameForBounds(bounds, { viewport: narrow, direction, target, insets });
    expect(resized.distance / narrowFit.distance).toBeCloseTo(1.4, 12);
    const restored = resizedCameraFrame(bounds, { previousViewport: narrow, viewport: wide, insets, position: resized.position, target });
    expect(restored.position.distanceTo(position)).toBeLessThan(1e-8);
  });

  it('retains an intentional detail zoom rather than forcing a full fit on resize', () => {
    const bounds = new Box3(new Vector3(0, 0, 0), new Vector3(256, 256, 50));
    const wide = viewports[0], narrow = viewports[2], direction = views[0].direction.clone().normalize();
    const full = cameraFrameForBounds(bounds, { viewport: wide, direction, insets });
    const position = full.target.clone().addScaledVector(direction, full.distance * .65);
    const resized = resizedCameraFrame(bounds, { previousViewport: wide, viewport: narrow, insets, position, target: full.target });
    const narrowFull = cameraFrameForBounds(bounds, { viewport: narrow, direction, target: full.target, insets });
    expect(resized.distance / narrowFull.distance).toBeCloseTo(.65, 12);
  });
});

describe('installed assembly framing uses normalized millimetres', () => {
  it('fits native metre translations and explicit mm transforms identically without scaling part dimensions', () => {
    const source = new Box3(new Vector3(-5, -10, 0), new Vector3(5, 10, 30));
    const native = [0,-1,0,.1, 1,0,0,.2, 0,0,1,.05, 0,0,0,1];
    const normalized = [0,-1,0,100, 1,0,0,200, 0,0,1,50, 0,0,0,1];
    const nativeBounds = source.clone().applyMatrix4(installedTransformMatrix(native, 'm'));
    const normalizedBounds = source.clone().applyMatrix4(installedTransformMatrix(normalized, 'mm'));
    expect(nativeBounds.equals(normalizedBounds)).toBe(true);
    expect(nativeBounds.getSize(new Vector3()).toArray()).toEqual([20, 10, 30]);
    const frame = cameraFrameForBounds(nativeBounds, { viewport: viewports[2], direction: views[0].direction, target: nativeBounds.getCenter(new Vector3()), insets });
    const equivalent = cameraFrameForBounds(normalizedBounds, { viewport: viewports[2], direction: views[0].direction, target: normalizedBounds.getCenter(new Vector3()), insets });
    expect(frame.position.toArray()).toEqual(equivalent.position.toArray());
    expect(frame.target.toArray()).toEqual([100, 200, 65]);
    expectInsideUsableArea(nativeBounds, frame);
  });
});
