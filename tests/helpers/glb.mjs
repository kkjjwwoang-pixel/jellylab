export function makeGLB(geometry, edit = () => {}) {
  const positions = new Float32Array(geometry.attributes.position.array);
  const indices = new Uint32Array(geometry.index?.array ?? Array.from({ length: positions.length / 3 }, (_, i) => i));
  geometry.computeBoundingBox();
  const json = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    buffers: [{ byteLength: positions.byteLength + indices.byteLength }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength }, { buffer: 0, byteOffset: positions.byteLength, byteLength: indices.byteLength }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: positions.length / 3, type: 'VEC3', min: geometry.boundingBox.min.toArray(), max: geometry.boundingBox.max.toArray() },
      { bufferView: 1, componentType: 5125, count: indices.length, type: 'SCALAR' },
    ],
  };
  edit(json);
  const bytes = new TextEncoder().encode(JSON.stringify(json)), padded = Math.ceil(bytes.length / 4) * 4;
  const binaryLength = positions.byteLength + indices.byteLength;
  const output = new ArrayBuffer(28 + padded + binaryLength), view = new DataView(output);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, output.byteLength, true);
  view.setUint32(12, padded, true); view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(output, 20, padded).fill(32); new Uint8Array(output, 20, bytes.length).set(bytes);
  view.setUint32(20 + padded, binaryLength, true); view.setUint32(24 + padded, 0x004e4942, true);
  new Uint8Array(output, 28 + padded, positions.byteLength).set(new Uint8Array(positions.buffer));
  new Uint8Array(output, 28 + padded + positions.byteLength).set(new Uint8Array(indices.buffer));
  return output;
}
