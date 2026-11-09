import { Box3, BufferGeometry, Float32BufferAttribute, Matrix4, Vector3 } from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export const MAX_TRIANGLES = 80000;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

// Strip unused appearance before loading: importing a shape must not fetch its
// textures, remote buffers, or original material extensions.
export function geometryOnlyGLB(buffer) {
  if (buffer.byteLength < 20) throw new Error('올바른 GLB 파일이 아니에요.');
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== buffer.byteLength) {
    throw new Error('GLB 2.0 파일을 선택해 주세요.');
  }
  let json, binary;
  for (let offset = 12; offset < buffer.byteLength;) {
    if (offset + 8 > buffer.byteLength) throw new Error('GLB 파일이 손상됐어요.');
    const length = view.getUint32(offset, true), type = view.getUint32(offset + 4, true);
    if (length % 4 || offset + 8 + length > buffer.byteLength) throw new Error('GLB 파일이 손상됐어요.');
    const chunk = buffer.slice(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
    if (type === 0x004e4942) binary = chunk;
    offset += length + 8;
  }
  if (!json || !binary) throw new Error('모델 데이터가 포함된 GLB 파일을 선택해 주세요.');
  if (json.buffers?.some(b => b.uri)) throw new Error('외부 파일 없이 내보낸 GLB가 필요해요.');
  let triangles = 0;
  for (const mesh of json.meshes || []) for (const primitive of mesh.primitives || []) {
    if (primitive.mode !== undefined && primitive.mode !== 4) throw new Error('삼각형 표면으로 내보낸 모델이 필요해요.');
    triangles += (json.accessors?.[primitive.indices ?? primitive.attributes?.POSITION]?.count || 0) / 3;
    delete primitive.material;
    if (primitive.extensions) delete primitive.extensions.KHR_materials_variants;
  }
  if (triangles > MAX_TRIANGLES) throw new Error('모델이 너무 복잡해요. 삼각형 8만 개 이하로 줄여 주세요.');
  delete json.materials; delete json.textures; delete json.images; delete json.samplers;
  delete json.animations;
  const appearance = name => name.startsWith('KHR_materials_') || ['KHR_texture_basisu', 'EXT_texture_webp', 'EXT_texture_avif', 'KHR_texture_transform'].includes(name);
  for (const key of ['extensionsUsed', 'extensionsRequired']) if (json[key]) json[key] = json[key].filter(name => !appearance(name));
  const bytes = new TextEncoder().encode(JSON.stringify(json));
  const padded = Math.ceil(bytes.length / 4) * 4;
  const output = new ArrayBuffer(12 + 8 + padded + 8 + binary.byteLength);
  const header = new DataView(output);
  header.setUint32(0, 0x46546c67, true); header.setUint32(4, 2, true); header.setUint32(8, output.byteLength, true);
  header.setUint32(12, padded, true); header.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(output, 20, padded).fill(32); new Uint8Array(output, 20, bytes.length).set(bytes);
  header.setUint32(20 + padded, binary.byteLength, true); header.setUint32(24 + padded, 0x004e4942, true);
  new Uint8Array(output, 28 + padded).set(new Uint8Array(binary));
  return output;
}

// Refine coarse triangle meshes without rounding away the uploaded silhouette.
// Shared edge midpoints keep the mesh watertight and make simple boxes stretchy.
function refine(geometry) {
  let positions = Array.from(geometry.attributes.position.array);
  let indices = Array.from(geometry.index.array);
  for (let pass = 0; pass < 6 && indices.length / 3 * 4 <= MAX_TRIANGLES; pass++) {
    let longest = 0;
    for (let i = 0; i < indices.length; i += 3) for (let edge = 0; edge < 3; edge++) {
      const a = indices[i + edge] * 3, b = indices[i + (edge + 1) % 3] * 3;
      longest = Math.max(longest, (positions[a] - positions[b]) ** 2 + (positions[a + 1] - positions[b + 1]) ** 2 + (positions[a + 2] - positions[b + 2]) ** 2);
    }
    if (longest < .18 ** 2 || indices.length / 3 >= 16000) break;
    const edges = new Map(), next = [];
    const midpoint = (a, b) => {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (edges.has(key)) return edges.get(key);
      const index = positions.length / 3;
      for (let axis = 0; axis < 3; axis++) positions.push((positions[a * 3 + axis] + positions[b * 3 + axis]) / 2);
      edges.set(key, index); return index;
    };
    for (let i = 0; i < indices.length; i += 3) {
      const [a, b, c] = indices.slice(i, i + 3);
      const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
      next.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
    }
    indices = next;
  }
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

export function prepareModel(root) {
  root.updateMatrixWorld(true);
  const positions = [], indices = [];
  const point = new Vector3(), instance = new Matrix4(), world = new Matrix4();
  root.traverseVisible(mesh => {
    if (!mesh.isMesh) return;
    mesh.skeleton?.update();
    const source = mesh.geometry, position = source.attributes.position;
    if (!position) return;
    const count = source.index?.count ?? position.count;
    const instances = mesh.isInstancedMesh ? mesh.count : 1;
    if ((indices.length + count * instances) / 3 > MAX_TRIANGLES || positions.length / 3 + position.count * instances > 240000) {
      throw new Error('모델이 너무 복잡해요. 삼각형 8만 개 이하로 줄여 주세요.');
    }
    for (let n = 0; n < instances; n++) {
      world.copy(mesh.matrixWorld);
      if (mesh.isInstancedMesh) { mesh.getMatrixAt(n, instance); world.multiply(instance); }
      const offset = positions.length / 3;
      for (let i = 0; i < position.count; i++) {
        mesh.getVertexPosition(i, point).applyMatrix4(world);
        if (![point.x, point.y, point.z].every(Number.isFinite)) throw new Error('모델 좌표를 읽을 수 없어요.');
        positions.push(point.x, point.y, point.z);
      }
      const mirrored = world.determinant() < 0;
      for (let i = 0; i < count; i += 3) {
        const a = source.index ? source.index.getX(i) : i;
        const b = source.index ? source.index.getX(i + 1) : i + 1;
        const c = source.index ? source.index.getX(i + 2) : i + 2;
        if (![a, b, c].every(v => Number.isInteger(v) && v >= 0 && v < position.count)) throw new Error('모델 표면 데이터가 손상됐어요.');
        indices.push(offset + a, offset + (mirrored ? c : b), offset + (mirrored ? b : c));
      }
    }
  });
  if (!indices.length) throw new Error('GLB 안에 사용할 수 있는 3D 표면이 없어요.');
  const raw = new BufferGeometry();
  raw.setAttribute('position', new Float32BufferAttribute(positions, 3)); raw.setIndex(indices);
  raw.computeBoundingBox();
  const box = new Box3().copy(raw.boundingBox), size = box.getSize(new Vector3());
  const longest = Math.max(size.x, size.y, size.z);
  if (longest < 1e-8 || Math.min(size.x, size.y, size.z) / longest < .002) {
    raw.dispose(); throw new Error('두께가 있는 입체 모델을 선택해 주세요.');
  }
  const center = box.getCenter(new Vector3());
  raw.translate(-center.x, -center.y, -center.z); raw.scale(3 / longest, 3 / longest, 3 / longest);
  const geometry = mergeVertices(raw, .00001); raw.dispose();
  const supportPositions = new Float32Array(geometry.attributes.position.array);
  refine(geometry);
  return { geometry, supportPositions, size: size.multiplyScalar(3 / longest) };
}

export function disposeImportedScene(root) {
  const geometries = new Set(), materials = new Set();
  root?.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    for (const m of (Array.isArray(object.material) ? object.material : [object.material])) if (m) materials.add(m);
    object.skeleton?.dispose();
  });
  geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
}
