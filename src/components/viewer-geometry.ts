import { Box3, BufferGeometry, Euler, Matrix4, MathUtils, Vector3 } from 'three';

/**
 * Derives display geometry without changing the original STL. Coordinates remain
 * millimetres. Rotate XYZ about the original bounding-box centre, preserve that
 * centre in XY, then seat the actual lowest vertex at Z=0. Item.position supplies
 * the bottom-centre placement on the build plate after this transform.
 */
export function manufacturingGeometry(source: BufferGeometry, orientation: readonly [number, number, number]): BufferGeometry {
  if (orientation.some(angle => !Number.isFinite(angle))) throw new Error('Orientation must contain finite angles.');
  const geometry = source.clone();
  geometry.computeBoundingBox();
  if (!geometry.boundingBox || geometry.boundingBox.isEmpty()) { geometry.dispose(); throw new Error('Geometry has no valid bounds.'); }
  const center = geometry.boundingBox.getCenter(new Vector3());
  geometry.translate(-center.x, -center.y, -center.z);
  geometry.applyMatrix4(new Matrix4().makeRotationFromEuler(new Euler(...orientation.map(MathUtils.degToRad) as [number, number, number], 'XYZ')));
  geometry.computeBoundingBox();
  const minZ = geometry.boundingBox!.min.z;
  geometry.translate(0, 0, -minZ);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function geometryDimensions(geometry: BufferGeometry): [number, number, number] {
  geometry.computeBoundingBox();
  const dimensions = (geometry.boundingBox ?? new Box3()).getSize(new Vector3());
  return [dimensions.x, dimensions.y, dimensions.z];
}

/** Equivalent exact manufacturing transform without cloning/re-uploading any vertices. */
export function manufacturingFrame(source:BufferGeometry,orientation:readonly [number,number,number]){
  if(orientation.some(angle=>!Number.isFinite(angle)))throw new Error('Orientation must contain finite angles.');
  if(!source.boundingBox)source.computeBoundingBox();
  if(!source.boundingBox||source.boundingBox.isEmpty())throw new Error('Geometry has no valid bounds.');
  const center=source.boundingBox.getCenter(new Vector3());
  const matrix=new Matrix4().makeRotationFromEuler(new Euler(...orientation.map(MathUtils.degToRad) as [number,number,number],'XYZ')).multiply(new Matrix4().makeTranslation(-center.x,-center.y,-center.z));
  const bounds=new Box3(),point=new Vector3(),position=source.getAttribute('position');
  for(let i=0;i<position.count;i++)bounds.expandByPoint(point.fromBufferAttribute(position,i).applyMatrix4(matrix));
  matrix.elements[14]-=bounds.min.z;bounds.translate(new Vector3(0,0,-bounds.min.z));
  return {matrix,bounds};
}

/** Convert only installed translation units; native Onshape row-major transforms use metres. */
export function installedTransformMatrix(transform: readonly number[], units: 'm' | 'mm' = 'm'): Matrix4 {
  if (transform.length !== 16 || transform.some(value => !Number.isFinite(value))) throw new Error('Installed transform must contain sixteen finite values.');
  if (units !== 'm' && units !== 'mm') throw new Error('Installed transform units must be m or mm.');
  const values = [...transform];
  const factor = units === 'm' ? 1000 : 1;
  values[3] *= factor; values[7] *= factor; values[11] *= factor;
  return new Matrix4().set(...values as Parameters<Matrix4['set']>);
}
