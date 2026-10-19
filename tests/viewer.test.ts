import { describe, expect, it } from 'vitest';
import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';
import { installedTransformMatrix, manufacturingGeometry, geometryDimensions } from '../src/components/viewer-geometry';
import { rotatedDimensions } from '../src/domain/invariants';

describe('manufacturing viewer geometry', () => {
  it('applies XYZ orientation in millimetres without modifying source geometry', () => {
    const original = new BoxGeometry(10, 20, 30);
    original.translate(70, -40, 90);
    original.computeBoundingBox();
    const originalBounds = original.boundingBox!.clone();
    const oriented = manufacturingGeometry(original, [90, 0, 0]);
    expect(geometryDimensions(oriented)).toEqual([10, 30, 20]);
    expect(oriented.boundingBox!.min.toArray()).toEqual([-5, -15, 0]);
    expect(original.boundingBox!.equals(originalBounds)).toBe(true);
    expect(geometryDimensions(original)).toEqual([10, 20, 30]);
    original.dispose(); oriented.dispose();
  });
  it('uses the same Euler convention as manifest placement and conservative fit checks', () => {
    const dimensions: [number,number,number] = [13, 29, 7];
    const orientation: [number,number,number] = [21, 37, 68];
    const source = new BoxGeometry(...dimensions);
    const actual = geometryDimensions(manufacturingGeometry(source, orientation));
    const fit = rotatedDimensions(dimensions, orientation);
    actual.forEach((value, i) => expect(value).toBeCloseTo(fit[i], 5));
    source.dispose();
  });
  it('seats actual asymmetric geometry rather than silently repairing or scaling it', () => {
    const source = new BufferGeometry();
    source.setAttribute('position', new Float32BufferAttribute([0,0,0, 20,0,0, 0,10,0, 0,0,0, 0,10,0, 0,0,30], 3));
    const sourceVertices = [...source.getAttribute('position').array];
    const oriented = manufacturingGeometry(source, [36, 12, 4]);
    expect(oriented.boundingBox!.min.z).toBeCloseTo(0, 5);
    expect([...source.getAttribute('position').array]).toEqual(sourceVertices);
    const sourcePositions = source.getAttribute('position'), rotatedPositions = oriented.getAttribute('position');
    const distance = (a: typeof sourcePositions) => Math.hypot(a.getX(1)-a.getX(0),a.getY(1)-a.getY(0),a.getZ(1)-a.getZ(0));
    expect(distance(rotatedPositions)).toBeCloseTo(distance(sourcePositions), 5);
    source.dispose(); oriented.dispose();
  });
  it('rejects nonfinite manual angles', () => {
    expect(() => manufacturingGeometry(new BoxGeometry(1, 2, 3), [0, NaN, 0])).toThrow('finite');
  });
});


describe('installed assembly translation units', () => {
  it('converts native metre translations once and preserves rotation', () => {
    const transform = [0,-1,0,.012, 1,0,0,.034, 0,0,1,.056, 0,0,0,1];
    const original = [...transform];
    const point = new Vector3(10, 0, 0).applyMatrix4(installedTransformMatrix(transform));
    expect(point.x).toBeCloseTo(12); expect(point.y).toBeCloseTo(44); expect(point.z).toBeCloseTo(56);
    expect(transform).toEqual(original);
  });
  it('keeps explicitly normalized millimetre translations unchanged', () => {
    const transform = [0,-1,0,12, 1,0,0,34, 0,0,1,56, 0,0,0,1];
    const point = new Vector3(10, 0, 0).applyMatrix4(installedTransformMatrix(transform, 'mm'));
    expect(point.toArray()).toEqual([12,44,56]);
  });
  it('rejects incomplete or nonfinite occurrence transforms', () => {
    expect(() => installedTransformMatrix([1,0,0])).toThrow('sixteen finite');
    expect(() => installedTransformMatrix([1,0,0,NaN, 0,1,0,0, 0,0,1,0, 0,0,0,1])).toThrow('sixteen finite');
  });
});
