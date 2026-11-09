import { LoadingManager } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import dracoWrapper from 'three/addons/libs/draco/gltf/draco_wasm_wrapper.js?url';
import dracoWasm from 'three/addons/libs/draco/gltf/draco_decoder.wasm?url';
import { MAX_FILE_BYTES, geometryOnlyGLB, prepareModel, disposeImportedScene } from './model-geometry.js';

export async function loadJellyModel(file) {
  if (!/\.glb$/i.test(file.name)) throw new Error('GLB 파일을 선택해 주세요.');
  if (file.size > MAX_FILE_BYTES) throw new Error('25MB 이하의 GLB 파일을 선택해 주세요.');
  const buffer = geometryOnlyGLB(await file.arrayBuffer());
  const manager = new LoadingManager();
  manager.setURLModifier(url => {
    if (url === 'jelly-draco/draco_wasm_wrapper.js') return dracoWrapper;
    if (url === 'jelly-draco/draco_decoder.wasm') return dracoWasm;
    throw new Error('외부 파일 없이 내보낸 GLB가 필요해요.');
  });
  const draco = new DRACOLoader(manager).setDecoderPath({ js: 'jelly-draco/draco_wasm_wrapper.js', wasm: 'jelly-draco/draco_decoder.wasm' }).setWorkerLimit(1);
  const loader = new GLTFLoader(manager).setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
  let gltf;
  try {
    gltf = await loader.parseAsync(buffer, '');
    return prepareModel(gltf.scene);
  } finally {
    for (const scene of gltf?.scenes || []) disposeImportedScene(scene);
    draco.dispose();
  }
}
