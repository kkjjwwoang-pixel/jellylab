import * as THREE from 'three/webgpu';
import {
  Fn, float, vec3, uniform, positionGeometry, normalGeometry, mx_noise_float,
  varying, transformNormalToView, negateOnBackSide,
  positionWorld, cameraPosition, pmremTexture, reflect, refract, mix, texture as textureNode,
} from 'three/tsl';
import { JellyPhysics, clamp } from './physics.js';
import { JellyBody } from './body-physics.js';
import { peeledFraction, smoothRange } from './contact.js';
import deskBackgroundUrl from './assets/desk-background.png';

const $ = (selector) => document.querySelector(selector);
const viewport = $('#viewport');
const state = new JellyPhysics();
const body = new JellyBody();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let paused = reducedMotion.matches;
let dragging = false;
let ready = false;
let renderer, scene, camera, jelly, proxy, material, shadow;
let currentPalette = 'rose';
let bubbles, bubbleLocations, hitDirections;
const bubbleTransform = new THREE.Object3D();
const displacedPoint = new THREE.Vector3();
let activePointer = null;
let lastTime = 0, lastFrameTime = 0, slowFrames = 0, qualityChecked = false;
let disposed = false;
let rearInterface, defaultGeometry, defaultHitGeometry, defaultHitDirections;
let uploadedModel = null, modelLoading = false;
const listenerController = new AbortController();
const listen = (target, type, callback, options = {}) => target.addEventListener(type, callback, { ...options, signal: listenerController.signal });
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const dragPlane = new THREE.Plane();
const dragStart = new THREE.Vector3();
const dragPoint = new THREE.Vector3();
const localPoint = new THREE.Vector3();
const dragVector = new THREE.Vector3();
const cameraDirection = new THREE.Vector3();
const inverseBodyRotation = new THREE.Quaternion();
const surfaceContact = new THREE.Vector3();
const palettes = {
  rose: { color: '#fff7fb', absorption: '#ad0039', scatter: '#ff94bb', accent: '#aa4864', number: '01' },
  jade: { color: '#f1fff8', absorption: '#175d47', scatter: '#a4e4c8', accent: '#548c73', number: '02' },
  amber: { color: '#fffbed', absorption: '#865008', scatter: '#ffdd8c', accent: '#bd914b', number: '03' },
};
const colorTarget = new THREE.Color(palettes.rose.color);
const absorptionTarget = new THREE.Color(palettes.rose.absorption);
const scatterTarget = new THREE.Color(palettes.rose.scatter);
const uniforms = {
  time: uniform(0), squash: uniform(0), shear: uniform(new THREE.Vector2()),
  twist: uniform(0), morph: uniform(0),
  grabPoint: uniform(new THREE.Vector3(0, .7, 1)),
  grabOffset: uniform(new THREE.Vector3()),
  scatter: uniform(new THREE.Color(palettes.rose.scatter)),
  bodyPosition: uniform(new THREE.Vector3(0, 1.09, 0)),
  bodyRotation: uniform(new THREE.Matrix3()),
  bodyInverseRotation: uniform(new THREE.Matrix3()),
  bodyScale: uniform(1),
  viewDirection: uniform(new THREE.Vector3(.45, .28, .85)),
  clearance: uniform(0),
  adhesion: uniform(1),
  peel: uniform(0),
  peelDirection: uniform(new THREE.Vector3(0, 0, 1)),
  customShape: uniform(0),
  shapeHalfHeight: uniform(1.05),
  rippleStrength: uniform(1),
};
const rotationMatrix = new THREE.Matrix4();

// The same smooth surface function drives vertices and their differentiated normals.
// Localized pulling sits on top of volume-conscious global elastic modes.
const deform = Fn(([direction]) => {
  const n = direction.div(direction.length().max(.00001)).toVar();
  const power = float(4.4).sub(uniforms.morph.mul(2.15));
  const norm = n.x.abs().pow(power).add(n.y.abs().pow(power)).add(n.z.abs().pow(power)).pow(float(1).div(power));
  const original = n.div(norm.max(.00001)).mul(vec3(1.48, 1.05, 1.16));
  const imported = direction.mul(vec3(float(1).add(uniforms.morph.mul(.08)), float(1).sub(uniforms.morph.mul(.12)), float(1).add(uniforms.morph.mul(.04))));
  const p = mix(original, imported, uniforms.customShape).toVar();
  const noise = mx_noise_float(p.mul(1.5).add(vec3(0, uniforms.time.mul(.105), uniforms.time.mul(.035))));
  const undulation = p.x.mul(3).add(p.z.mul(2.6)).add(uniforms.time.mul(.48)).sin().mul(.022);
  const anchor = p.y.add(uniforms.shapeHalfHeight).div(uniforms.shapeHalfHeight.mul(2)).clamp(0, 1).toVar();
  p.addAssign(n.mul(noise.mul(.115).add(undulation)).mul(anchor.mul(.8).add(.2)).mul(uniforms.rippleStrength));
  const squashScale = float(1).add(uniforms.squash);
  const lateralScale = squashScale.sqrt().reciprocal();
  p.x.mulAssign(lateralScale);
  p.z.mulAssign(lateralScale);
  p.y.mulAssign(squashScale);
  const twistAngle = uniforms.twist.mul(anchor);
  const x = p.x.mul(twistAngle.cos()).sub(p.z.mul(twistAngle.sin())).toVar();
  p.z.assign(p.x.mul(twistAngle.sin()).add(p.z.mul(twistAngle.cos())));
  p.x.assign(x);
  p.x.addAssign(uniforms.shear.x.mul(anchor.pow(1.4)));
  p.z.addAssign(uniforms.shear.y.mul(anchor.pow(1.4)));
  const dist = p.sub(uniforms.grabPoint).length();
  const relativeWorld = uniforms.bodyRotation.mul(p).toVar();
  const baseHeight = relativeWorld.y.add(uniforms.bodyPosition.y.div(uniforms.bodyScale));
  const peelCoordinate = relativeWorld.dot(uniforms.peelDirection).div(1.7);
  const peelFront = float(1.15).sub(uniforms.peel.mul(2.55));
  const peeled = peelCoordinate.smoothstep(peelFront.sub(.22), peelFront.add(.22))
    .mul(uniforms.peel.smoothstep(0, .12)).toVar();
  const localWeight = dist.mul(dist).mul(-.24).exp();
  // Distributed upper-body stretch leaves a broad, immobile foot. The wider
  // Gaussian remains well behaved at the larger displacement required to peel.
  const bondedWeight = localWeight.mul(.25).add(baseHeight.smoothstep(.12, 1.75).mul(.75))
    .mul(baseHeight.smoothstep(.08, .62));
  const weight = mix(localWeight, bondedWeight, uniforms.adhesion.mul(float(1).sub(peeled)));
  p.addAssign(uniforms.grabOffset.mul(weight));
  // Curl the released lip upward even for a horizontal drag. The opposite lip
  // remains on the floor; no whole-face on/off mask is used during peeling.
  const curl = peeled.mul(uniforms.peel).mul(uniforms.adhesion).mul(.45)
    .mul(float(1).sub(baseHeight.smoothstep(.08, 1.15)));
  p.addAssign(uniforms.bodyInverseRotation.mul(vec3(0, curl, 0)));
  // Contact follows the world floor, never the object's original bottom face.
  const world = uniforms.bodyRotation.mul(p.mul(uniforms.bodyScale)).add(uniforms.bodyPosition).toVar();
  world.y.assign(world.y.max(.004));
  return uniforms.bodyInverseRotation.mul(world.sub(uniforms.bodyPosition)).div(uniforms.bodyScale);
});

const surfaceNormal = Fn(() => {
  const n = normalGeometry.normalize();
  const reference = n.y.abs().greaterThan(.95).select(vec3(1, 0, 0), vec3(0, 1, 0));
  const tangent = reference.cross(n).normalize();
  const bitangent = n.cross(tangent).normalize();
  const center = deform(positionGeometry).toVar();
  const cross = deform(positionGeometry.add(tangent.mul(.002))).sub(center)
    .cross(deform(positionGeometry.add(bitangent.mul(.002))).sub(center));
  return cross.length().greaterThan(.00000001).select(cross.normalize(), n);
});

// An explicit rear optical interface is rendered into the opaque transmission
// buffer. The front lens can now refract the moving opposite wall, not just the
// blank floor. This is a two-interface approximation, not recursive ray tracing.
function makeRearInterface() {
  const rear = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
  rear.positionNode = deform(positionGeometry);
  const outward = varying(uniforms.bodyRotation.mul(surfaceNormal()), 'vRearNormal').normalize();
  const incident = positionWorld.sub(cameraPosition).normalize();
  const inward = outward.negate();
  const transmitted = refract(incident, inward, float(1.47));
  const reflected = reflect(incident, inward);
  const tir = transmitted.length().lessThan(.001);
  const exitDirection = tir.select(reflected, transmitted);
  const fresnel = float(1).sub(incident.dot(outward).abs()).pow(5).mul(.96).add(.04);
  const through = pmremTexture(scene.environment, exitDirection, float(.025));
  const bounce = pmremTexture(scene.environment, reflected, float(.035));
  rear.colorNode = mix(through, bounce, tir.select(float(1), fresnel)).mul(.95);
  return rear;
}

function makeMaterial() {
  const gel = new THREE.MeshSSSNodeMaterial({
    side: THREE.FrontSide,
    color: palettes.rose.color,
    metalness: 0,
    roughness: .085,
    transmission: 1,
    thickness: 2.6,
    ior: 1.47,
    attenuationColor: palettes.rose.absorption,
    attenuationDistance: 2.25,
    clearcoat: 1,
    clearcoatRoughness: .028,
    dispersion: .035,
    envMapIntensity: 1.15,
  });
  // positionLocal is overwritten by positionNode. All surface evaluations must
  // start from immutable geometry coordinates, including normal/thickness samples.
  gel.positionNode = deform(positionGeometry);
  const normal = varying(transformNormalToView(surfaceNormal()), 'vJellyNormal').normalize();
  gel.normalNode = negateOnBackSide(normal);
  gel.clearcoatNormalNode = negateOnBackSide(normal);
  // Chord-length approximation gives the center depth and leaves luminous thin edges.
  gel.thicknessNode = varying(normalGeometry.normalize().dot(uniforms.viewDirection).abs()).mul(3.4).add(.18);
  gel.thicknessColorNode = uniforms.scatter;
  gel.thicknessDistortionNode = float(.18);
  gel.thicknessAmbientNode = float(.002);
  gel.thicknessAttenuationNode = float(.02);
  gel.thicknessPowerNode = float(3);
  gel.thicknessScaleNode = float(1.4);
  return gel;
}

function createStudio() {
  const studio = new THREE.Scene();
  studio.background = new THREE.Color(.22, .235, .21);
  const backdrop = document.createElement('canvas'); backdrop.width = backdrop.height = 256;
  const context = backdrop.getContext('2d');
  const gradient = context.createLinearGradient(0, 0, 180, 256);
  gradient.addColorStop(0, '#e5e1e5'); gradient.addColorStop(.32, '#9e969f');
  gradient.addColorStop(.62, '#807786'); gradient.addColorStop(1, '#c9c4ce');
  context.fillStyle = gradient; context.fillRect(0, 0, 256, 256);
  const backdropTexture = new THREE.CanvasTexture(backdrop); backdropTexture.colorSpace = THREE.SRGBColorSpace;
  const room = new THREE.Mesh(new THREE.BoxGeometry(30, 22, 30), new THREE.MeshBasicMaterial({ map: backdropTexture, side: THREE.BackSide }));
  studio.add(room);
  const panel = (position, size, intensity, tint = '#ffffff') => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(...size), new THREE.MeshBasicMaterial({ color: new THREE.Color(tint).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.set(...position); m.lookAt(0, 0, 0); studio.add(m);
  };
  panel([-5, 6, 4], [3, 5], 5.5);
  panel([6, 3, 1], [.85, 6], 3.5);
  panel([0, 8, -3], [5, 3], 4.5);
  panel([-3, 1, -7], [3.8, 5], 3, '#fff4ee');
  panel([3, -2, -7], [4, 1.4], 2.7);
  panel([1, 2, -9], [5.5, 4], .85, '#fff8fa');
  panel([1, 0, 8], [.55, 4], 2);
  // Negative fill produces dark, crisp contours rather than a milky all-white shell.
  panel([4, 1, 8], [1.8, .85], .08, '#29202a');
  panel([-6, 1.5, 3], [.75, 4], .08, '#201922');
  panel([0, 3.5, -7], [2.8, .6], .06, '#201922');
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(studio, .035, .1, 100, { size: 256 });
  scene.environment = target.texture;
  studio.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
  backdropTexture.dispose();
  pmrem.dispose();
  return target;
}

let deskBgTexture = null;

function setupDeskBackground() {
  const loader = new THREE.TextureLoader();
  deskBgTexture = loader.load(deskBackgroundUrl, (texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    scene.background = texture;
    updateBackgroundAspect();
  });
}

function updateBackgroundAspect() {
  if (!deskBgTexture?.image) return;
  const canvasAspect = viewport.clientWidth / viewport.clientHeight;
  const imageAspect = deskBgTexture.image.width / deskBgTexture.image.height;
  if (canvasAspect > imageAspect) {
    deskBgTexture.repeat.set(1, imageAspect / canvasAspect);
    deskBgTexture.offset.set(0, (1 - imageAspect / canvasAspect) * 0.5);
  } else {
    deskBgTexture.repeat.set(canvasAspect / imageAspect, 1);
    deskBgTexture.offset.set((1 - canvasAspect / imageAspect) * 0.5, 0);
  }
}

function makeFloor() {
  const shadowCanvas = document.createElement('canvas'); shadowCanvas.width = shadowCanvas.height = 512;
  const s = shadowCanvas.getContext('2d');
  // Deeper contact ambient occlusion with rich falloff
  const gradient = s.createRadialGradient(256, 256, 10, 256, 256, 256);
  gradient.addColorStop(0, 'rgba(15, 8, 4, 1.0)');
  gradient.addColorStop(0.28, 'rgba(28, 14, 7, 0.95)');
  gradient.addColorStop(0.52, 'rgba(45, 24, 12, 0.75)');
  gradient.addColorStop(0.75, 'rgba(65, 35, 18, 0.40)');
  gradient.addColorStop(0.9, 'rgba(75, 40, 20, 0.12)');
  gradient.addColorStop(1, 'rgba(75, 40, 20, 0)');
  s.fillStyle = gradient; s.fillRect(0, 0, 512, 512);
  const shadowTexture = new THREE.CanvasTexture(shadowCanvas);
  shadow = new THREE.Mesh(new THREE.PlaneGeometry(6.6, 5.4), new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false, opacity: 1 }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.set(.12, -.015, .1); scene.add(shadow);

  const glowCanvas = document.createElement('canvas'); glowCanvas.width = glowCanvas.height = 128;
  const g = glowCanvas.getContext('2d');
  const glow = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  glow.addColorStop(0, 'rgba(255,216,205,.25)'); glow.addColorStop(.5, 'rgba(255,195,177,.10)'); glow.addColorStop(1, 'rgba(255,195,177,0)');
  g.fillStyle = glow; g.fillRect(0, 0, 128, 128);
  const caustic = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 3.8), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(glowCanvas), transparent: true, depthWrite: false, color: palettes.rose.color }));
  caustic.rotation.x = -Math.PI / 2; caustic.position.set(.7, -.01, .35); scene.add(caustic);
  return caustic;
}

function addInclusions() {
  // Tiny air inclusions sit within the material and are refracted by its front surface.
  const geometry = new THREE.SphereGeometry(1, 16, 12);
  const bubbleMaterial = new THREE.MeshPhysicalNodeMaterial({ color: '#f8e9ee', metalness: .32, roughness: .09, clearcoat: 1, envMapIntensity: 1.2 });
  bubbles = new THREE.InstancedMesh(geometry, bubbleMaterial, 13);
  const transform = new THREE.Object3D();
  bubbleLocations = [
    [-.68,-.3,.54,.065],[-.82,-.18,.35,.024],[-.53,-.6,.64,.034],[.56,.26,.6,.047],
    [.65,.4,.34,.021],[.45,.14,.55,.017],[.18,-.4,.82,.03],[-.2,.42,.18,.036],
    [.76,-.55,.2,.026],[-.4,.08,.68,.019],[.4,-.65,.56,.023],[-.87,.32,.12,.016],[.05,-.12,.85,.014],
  ];
  bubbleLocations.forEach(([x,y,z,r],i) => { transform.position.set(x,y,z);transform.scale.set(r,r*1.15,r);transform.updateMatrix();bubbles.setMatrixAt(i,transform.matrix); });
  bubbles.frustumCulled = false;
  jelly.add(bubbles);
}

// Lightweight CPU counterparts for accurate picking and moving the air inclusions.
// Surface noise stays on the GPU; the picking shell follows all elastic modes.
function elasticPoint(x, y, z, result) {
  const halfHeight = uniforms.shapeHalfHeight.value;
  const anchor = clamp((y + halfHeight) / (halfHeight * 2), 0, 1);
  const scale = 1 + state.squash.value;
  x /= Math.sqrt(scale); z /= Math.sqrt(scale); y *= scale;
  const angle = state.twist.value * anchor;
  const rotatedX = x * Math.cos(angle) - z * Math.sin(angle);
  z = x * Math.sin(angle) + z * Math.cos(angle);
  x = rotatedX + state.shearX.value * anchor ** 1.4;
  z += state.shearZ.value * anchor ** 1.4;
  const p = uniforms.grabPoint.value;
  const distanceSquared = (x - p.x) ** 2 + (y - p.y) ** 2 + (z - p.z) ** 2;
  surfaceContact.set(x, y, z).multiplyScalar(uniforms.bodyScale.value).applyQuaternion(body.orientation).add(uniforms.bodyPosition.value);
  const baseHeight = surfaceContact.y / uniforms.bodyScale.value;
  const contactT = clamp((baseHeight - .08) / .54, 0, 1);
  const upperT = clamp((baseHeight - .12) / 1.63, 0, 1);
  const localWeight = Math.exp(-.24 * distanceSquared);
  const bondedWeight = (localWeight * .25 + upperT * upperT * (3 - 2 * upperT) * .75) * contactT * contactT * (3 - 2 * contactT);
  const relativeX = (surfaceContact.x - uniforms.bodyPosition.value.x) / uniforms.bodyScale.value;
  const relativeZ = (surfaceContact.z - uniforms.bodyPosition.value.z) / uniforms.bodyScale.value;
  const peeled = peeledFraction(relativeX, relativeZ, uniforms.peelDirection.value, uniforms.peel.value);
  const weight = localWeight + (bondedWeight - localWeight) * uniforms.adhesion.value * (1 - peeled);
  result.set(x + state.grab[0].value * weight, y + state.grab[1].value * weight, z + state.grab[2].value * weight);
  const curl = peeled * uniforms.peel.value * uniforms.adhesion.value * .45 * (1 - smoothRange(.08, 1.15, baseHeight));
  result.add(surfaceContact.set(0, curl, 0).applyQuaternion(inverseBodyRotation));
  surfaceContact.copy(result).multiplyScalar(uniforms.bodyScale.value).applyQuaternion(body.orientation).add(uniforms.bodyPosition.value);
  if (surfaceContact.y < .004) {
    surfaceContact.y = .004;
    result.copy(surfaceContact).sub(uniforms.bodyPosition.value).applyQuaternion(inverseBodyRotation).divideScalar(uniforms.bodyScale.value);
  }
  return result;
}

function updateHitSurface() {
  const attribute = proxy.geometry.attributes.position;
  const power = 4.4 - state.morph.value * 2.15;
  let minimumHeight = Infinity;
  for (let i = 0; i < attribute.count; i++) {
    const x = hitDirections[i * 3], y = hitDirections[i * 3 + 1], z = hitDirections[i * 3 + 2];
    if (uploadedModel) {
      const morph = state.morph.value;
      elasticPoint(x * (1 + morph * .08), y * (1 - morph * .12), z * (1 + morph * .04), displacedPoint);
    } else {
      const norm = Math.pow(Math.abs(x) ** power + Math.abs(y) ** power + Math.abs(z) ** power, 1 / power);
      elasticPoint(x / norm * 1.48, y / norm * 1.05, z / norm * 1.16, displacedPoint);
    }
    attribute.setXYZ(i, displacedPoint.x, displacedPoint.y, displacedPoint.z);
    // elasticPoint leaves surfaceContact at the final world-space position.
    minimumHeight = Math.min(minimumHeight, surfaceContact.y);
  }
  attribute.needsUpdate = true;
  proxy.geometry.boundingBox = null;
  proxy.geometry.computeBoundingSphere();
  return minimumHeight;
}

function createHitSurface() {
  const geometry = new THREE.SphereGeometry(1, 32, 24);
  hitDirections = new Float32Array(geometry.attributes.position.array);
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
}

function resize() {
  if (!renderer) return;
  const width = viewport.clientWidth, height = viewport.clientHeight;
  const mobile = width <= 900;
  camera.aspect = width / height;
  camera.fov = mobile ? 39 : 31;
  // A centered perspective camera locks the physical desk plane to the photo horizon.
  if (mobile) {
    const objectScale = Math.min(1, width / 430) * 1.04;
    jelly.scale.setScalar(objectScale); proxy.scale.copy(jelly.scale);
    camera.position.set(0, 3.1, 9.25);
    camera.lookAt(0, .72, 0);
  } else {
    jelly.scale.setScalar(1.25); proxy.scale.copy(jelly.scale);
    camera.position.set(0, 3.05, 9.75); camera.lookAt(0, .74, 0);
  }
  camera.updateProjectionMatrix();
  const ratio = jelly.scale.x / body.scale;
  body.position.multiplyScalar(ratio); body.velocity.multiplyScalar(ratio); body.scale = jelly.scale.x;
  renderer.setSize(width, height);
  updateBackgroundAspect();
  proxy.updateMatrixWorld(true);
}

function pointerRay(event) {
  updateHitSurface();
  const bounds = renderer.domElement.getBoundingClientRect();
  pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
}

function release() {
  if (!dragging) return;
  dragging = false;
  body.release();
  state.grab.forEach(s => { s.target = 0; });
  state.squash.target = 0;
  state.twist.velocity += state.grab[0].value * .65;
  renderer.domElement.style.cursor = 'grab';
  if (activePointer !== null && renderer.domElement.hasPointerCapture(activePointer)) renderer.domElement.releasePointerCapture(activePointer);
  activePointer = null;
}

function bindInteraction() {
  const canvas = renderer.domElement;
  canvas.tabIndex = 0; canvas.setAttribute('role', 'application');
  canvas.setAttribute('aria-label', 'Jelly sculpture. Drag gently to stretch; pull farther to lift and roll. Click to squish, scroll to morph. Space nudges, arrow keys stretch, R resets.');
  listen(canvas, 'pointermove', event => {
    if (dragging && event.pointerId === activePointer && event.pointerType === 'mouse' && (event.buttons & 1) === 0) release();
    pointerRay(event);
    if (dragging && event.pointerId !== activePointer) return;
    if (dragging) {
      if (raycaster.ray.intersectPlane(dragPlane, dragPoint)) {
        // Limit deformation, not the cursor: the body must keep following after
        // it peels, however far the pointer travels from the original grip.
        body.target.copy(dragPoint);
        state.squash.target = -.035;
      }
    } else {
      const hovering = raycaster.intersectObject(proxy).length > 0;
      canvas.style.cursor = hovering ? 'grab' : 'default';
      state.hoverX.target = pointer.x * .075;
      state.hoverZ.target = pointer.y * -.05;
      state.shearX.target = pointer.x * .075;
      state.shearZ.target = pointer.y * -.05;
    }
  });
  listen(canvas, 'pointerdown', event => {
    if (paused || event.button !== 0 || dragging) return;
    pointerRay(event);
    const hit = raycaster.intersectObject(proxy)[0];
    if (!hit) return;
    event.preventDefault(); canvas.focus({ preventScroll: true });
    dragging = true; activePointer = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    dragStart.copy(hit.point);
    camera.getWorldDirection(cameraDirection);
    dragPlane.setFromNormalAndCoplanarPoint(cameraDirection, dragStart);
    localPoint.copy(hit.point); jelly.worldToLocal(localPoint);
    uniforms.grabPoint.value.copy(localPoint);
    body.beginGrip(localPoint, hit.point);
    state.impact(.38);
    const normal = localPoint.clone().normalize();
    state.grab[0].velocity -= normal.x * 1.25;
    state.grab[1].velocity -= normal.y * 1.25;
    state.grab[2].velocity -= normal.z * 1.25;
    canvas.style.cursor = 'grabbing';
  });
  listen(canvas, 'pointerup', event => { if (event.pointerId === activePointer) release(); });
  listen(window, 'pointerup', event => { if (event.pointerId === activePointer) release(); });
  listen(canvas, 'pointercancel', release);
  listen(canvas, 'lostpointercapture', release);
  listen(canvas, 'pointerleave', () => {
    if (!dragging) {
      state.hoverX.target = state.hoverZ.target = 0;
      state.shearX.target = state.shearZ.target = 0;
    }
  });
  listen(window, 'blur', release);
  listen(canvas, 'wheel', event => {
    pointerRay(event);
    if (paused || !raycaster.intersectObject(proxy).length) return;
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1);
    state.morph.target = clamp(state.morph.target + delta * .001, 0, 1);
  }, { passive: false });
  listen(canvas, 'keydown', event => {
    if (event.code === 'KeyR') { reset(); return; }
    if (paused) return;
    if (event.code === 'Space') { event.preventDefault(); nudge(); }
    if (event.code.startsWith('Arrow')) {
      event.preventDefault();
      if (event.code === 'ArrowLeft') state.shearX.velocity -= 1.8;
      if (event.code === 'ArrowRight') state.shearX.velocity += 1.8;
      if (event.code === 'ArrowUp') state.squash.velocity += 1.8;
      if (event.code === 'ArrowDown') state.squash.velocity -= 1.8;
    }
  });
}

function syncPauseUI() {
  $('#pause').setAttribute('aria-pressed', String(paused));
  $('#pause').setAttribute('aria-label', paused ? 'Resume motion' : 'Pause motion');
  $('#pause').title = paused ? 'Resume motion' : 'Pause motion';
  $('#pause').innerHTML = paused ? '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="m3 2 7 4-7 4Z" fill="currentColor"/></svg>' : '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M4 2v8M8 2v8" stroke="currentColor" stroke-width="1.5"/></svg>';
  $('#motion-status').textContent = paused ? 'PAUSED' : 'LIVE';
  $('#experiment').classList.toggle('is-paused', paused);
}

function choosePalette(name) {
  currentPalette = name;
  const palette = palettes[name];
  colorTarget.set(palette.color); absorptionTarget.set(palette.absorption); scatterTarget.set(palette.scatter);
  document.documentElement.style.setProperty('--accent', palette.accent);
  document.querySelectorAll('[data-palette]').forEach(button => {
    const selected = button.dataset.palette === name;
    button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected));
  });
  if (!paused && ready) state.impact(.2);
}

function updateSlider(input) {
  $(`#${input.id}-value`).innerHTML = `${input.value}<span>%</span>`;
  input.style.setProperty('--progress', `${(Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min)) * 100}%`);
  if (input.id === 'softness') state.softness = Number(input.value) / 100;
  if (input.id === 'clarity' && material) {
    const clarity = Number(input.value) / 100;
    material.roughness = .008 + (1 - clarity) ** 2 * .16;
    material.transmission = .95 + clarity * .05;
    material.attenuationDistance = 4.2 + clarity * 2.2;
  }
}

function nudge() {
  if (!ready) return;
  if (paused) { paused = false; syncPauseUI(); }
  state.impact(.9);
}

function reset() {
  release(); state.reset(); body.reset(); choosePalette('rose');
  $('#softness').value = 68; $('#clarity').value = 76;
  document.querySelectorAll('input[type=range]').forEach(updateSlider);
  uniforms.grabPoint.value.set(0, .7, 1);
  paused = reducedMotion.matches; syncPauseUI();
}

function applyShape(model = null, name = '') {
  release();
  const previous = uploadedModel;
  const oldProxy = proxy.geometry;
  uploadedModel = model;
  jelly.geometry = rearInterface.geometry = model?.geometry ?? defaultGeometry;
  proxy.geometry = model ? model.geometry.clone() : defaultHitGeometry;
  hitDirections = model ? new Float32Array(model.geometry.attributes.position.array) : defaultHitDirections;
  uniforms.customShape.value = model ? 1 : 0;
  uniforms.shapeHalfHeight.value = model ? model.size.y / 2 : 1.05;
  uniforms.rippleStrength.value = model ? Math.min(.25, Math.min(model.size.x, model.size.y, model.size.z) * .2) : 1;
  const softness = state.softness;
  state.reset(); state.softness = softness;
  body.setShape(model?.supportPositions ?? null, model?.size.y ?? 2.1);
  uniforms.grabOffset.value.set(0, 0, 0); uniforms.grabPoint.value.set(0, 0, 0);
  uniforms.squash.value = uniforms.twist.value = uniforms.morph.value = uniforms.peel.value = 0;
  uniforms.shear.value.set(0, 0); uniforms.adhesion.value = 1;
  uniforms.bodyPosition.value.copy(body.position);
  uniforms.bodyRotation.value.identity(); uniforms.bodyInverseRotation.value.identity(); inverseBodyRotation.identity();
  jelly.position.copy(body.position); jelly.quaternion.identity();
  proxy.position.copy(body.position); proxy.quaternion.identity();
  jelly.updateMatrixWorld(true); proxy.updateMatrixWorld(true); updateHitSurface();
  bubbles.visible = !model;
  $('#model-upload-label').textContent = model ? name : 'Upload GLB';
  $('#model-upload').title = model ? `${name} · 다른 GLB 선택` : 'GLB · 최대 25MB';
  $('#model-clear').hidden = !model;
  $('#model-message').hidden = true;
  $('#model-file').value = '';
  if (previous) previous.geometry.dispose();
  if (oldProxy !== defaultHitGeometry) oldProxy.dispose();
}

async function uploadModel(file) {
  if (!file || !ready || modelLoading) return;
  release(); modelLoading = true;
  $('#model-upload').disabled = $('#model-clear').disabled = true;
  $('.model-controls').setAttribute('aria-busy', 'true');
  const previousLabel = $('#model-upload-label').textContent;
  $('#model-upload-label').textContent = 'Loading…';
  $('#model-message').hidden = true;
  try {
    const { loadJellyModel } = await import('./model-loader.js');
    const model = await loadJellyModel(file);
    if (disposed) { model.geometry.dispose(); return; }
    applyShape(model, file.name);
  } catch (error) {
    $('#model-upload-label').textContent = previousLabel;
    $('#model-message').textContent = /[가-힣]/.test(error.message) ? error.message : '이 GLB를 읽지 못했어요. 파일을 다시 내보낸 뒤 시도해 주세요.';
    $('#model-message').hidden = false;
  } finally {
    modelLoading = false;
    $('#model-upload').disabled = $('#model-clear').disabled = false;
    $('.model-controls').setAttribute('aria-busy', 'false');
    $('#model-file').value = '';
  }
}

listen($('#model-upload'), 'click', () => $('#model-file').click());
listen($('#model-file'), 'change', event => uploadModel(event.target.files[0]));
listen($('#model-clear'), 'click', () => applyShape());

document.querySelectorAll('[data-palette]').forEach(button => listen(button, 'click', () => choosePalette(button.dataset.palette)));
document.querySelectorAll('input[type=range]').forEach(input => { updateSlider(input); listen(input, 'input', () => updateSlider(input)); });
listen($('#nudge'), 'click', nudge);
listen($('#reset'), 'click', reset);
listen($('#pause'), 'click', () => { release(); paused = !paused; syncPauseUI(); });
listen($('#morph'), 'click', () => {
  if (paused) { paused = false; syncPauseUI(); }
  state.morph.target = state.morph.target > .5 ? 0 : 1;
});
listen(reducedMotion, 'change', () => { release(); paused = reducedMotion.matches; syncPauseUI(); });
if ($('#about-open')) listen($('#about-open'), 'click', () => { release(); $('#about-dialog').showModal(); });
if ($('#about-close')) listen($('#about-close'), 'click', () => $('#about-dialog').close());
if ($('#about-dialog')) listen($('#about-dialog'), 'click', event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.currentTarget.close(); } });
syncPauseUI();

let environmentTarget, caustic;
const observer = new ResizeObserver(resize);

async function initialize() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(31, 1, .1, 60);
  // Three's unified renderer automatically uses WebGL 2 when WebGPU is unavailable.
  renderer = new THREE.WebGPURenderer({ antialias: true, alpha: false, forceWebGL: new URLSearchParams(location.search).has('webgl') });
  // Keep the hero sculpture crisp on high-density screens. The cap is still
  // conservative enough for the live physics and WebGPU transmission pass.
  renderer.setPixelRatio(Math.min(devicePixelRatio, innerWidth <= 900 ? 1.75 : 2));
  renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1.25;
  await renderer.init();
  viewport.appendChild(renderer.domElement);
  environmentTarget = createStudio();
  setupDeskBackground();
  caustic = makeFloor();
  const hemisphere = new THREE.HemisphereLight('#fff5df', '#76543d', 1.25); scene.add(hemisphere);
  const key = new THREE.DirectionalLight('#fff2d4', 2.1); key.position.set(-4, 6, 4); scene.add(key);
  const rim = new THREE.DirectionalLight('#f3c8b4', 1.5); rim.position.set(4, 3, -4); scene.add(rim);
  material = makeMaterial();
  updateSlider($('#clarity'));
  const segments = innerWidth <= 900 ? 96 : 144;
  const geometry = new THREE.SphereGeometry(1, segments, Math.round(segments * .75));
  jelly = new THREE.Mesh(geometry, material); jelly.position.y = 1.055; jelly.frustumCulled = false; scene.add(jelly);
  defaultGeometry = geometry;
  rearInterface = new THREE.Mesh(geometry, makeRearInterface());
  rearInterface.frustumCulled = false;
  jelly.add(rearInterface);
  addInclusions();
  proxy = createHitSurface(); proxy.position.copy(jelly.position); updateHitSurface();
  defaultHitGeometry = proxy.geometry; defaultHitDirections = hitDirections;
  resize(); observer.observe(viewport);
  bindInteraction();
  await renderer.compileAsync(scene, camera);
  renderer.render(scene, camera);
  ready = true;
  $('#model-upload').disabled = false;
  const backend = renderer.backend.isWebGPUBackend ? 'WEBGPU' : 'WEBGL 2';
  $('#renderer-status').textContent = backend;
  $('#scene-loading').classList.add('loaded');
  if (!paused) state.impact(.2);
  // Read-only diagnostics make rendering, settling, and resource checks inspectable.
  window.__softMatter = {
    get backend() { return backend; },
    get model() { return { custom: !!uploadedModel, loading: modelLoading, vertices: jelly.geometry.attributes.position.count, triangles: (jelly.geometry.index?.count ?? jelly.geometry.attributes.position.count) / 3, size: uploadedModel?.size.toArray() ?? [2.96, 2.1, 2.32] }; },
    get state() { return { ready, paused, dragging, palette: currentPalette, softness: state.softness, morph: state.morph.value, squash: state.squash.value, velocity: state.squash.velocity, grab: state.grab.map(s => s.value), bodyPosition: body.position.toArray(), orientation: body.orientation.toArray(), angularVelocity: body.angularVelocity.toArray(), clearance: body.clearance, grounded: body.grounded, attached: body.attached, adhesionLoad: body.adhesionLoad, peel: body.peel, pixelRatio: renderer.getPixelRatio(), time: state.time }; },
    get contactInspection() {
      updateHitSurface();
      const positions = proxy.geometry.attributes.position;
      let near = Infinity, far = Infinity;
      const point = new THREE.Vector3();
      for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i).applyMatrix4(proxy.matrixWorld);
        const coordinate = (point.x - body.position.x) * body.peelDirection.x + (point.z - body.position.z) * body.peelDirection.z;
        if (coordinate > .65 * body.scale) near = Math.min(near, point.y);
        if (coordinate < -.65 * body.scale) far = Math.min(far, point.y);
      }
      point.copy(jelly.position).project(camera);
      const rect = renderer.domElement.getBoundingClientRect();
      return { near, far, screen: [rect.left + (point.x + 1) * rect.width / 2, rect.top + (1 - point.y) * rect.height / 2] };
    },
    get renderInfo() { return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures }; },
  };
  renderer.setAnimationLoop(animate);
}

function animate(now) {
  if (disposed) return;
  const elapsed = lastTime ? (now - lastTime) / 1000 : 1 / 60;
  lastTime = now;
  if (document.hidden) { release(); return; }
  // Paused scenes still respond to material changes, at a lighter 15 Hz cadence.
  if (paused && now - lastFrameTime < 66) return;
  lastFrameTime = now;
  if (!paused) {
    body.advance(elapsed, { softness: state.softness, morph: state.morph.value, squash: state.squash.value, scale: jelly.scale.x });
    if (body.impact > 0) state.squash.velocity -= body.impact * .3;
    if (dragging) {
      inverseBodyRotation.copy(body.orientation).invert();
      dragVector.copy(body.target).sub(body.position).applyQuaternion(inverseBodyRotation).divideScalar(jelly.scale.x).sub(body.grip).clampLength(0, 2.1);
      // Limit downward compression in world coordinates, also when rolled over.
      dragVector.applyQuaternion(body.orientation);
      dragVector.y = Math.max(-.55, dragVector.y);
      dragVector.applyQuaternion(inverseBodyRotation);
      state.grab[0].target = dragVector.x; state.grab[1].target = dragVector.y; state.grab[2].target = dragVector.z;
    }
    state.advance(elapsed);
    // Keep the local field invertible; excess pull has already moved the body.
    const length = Math.hypot(...state.grab.map(s => s.value));
    if (length > 2.25) state.grab.forEach(s => { s.value *= 2.25 / length; s.velocity *= .8; });
  }
  uniforms.time.value = state.time;
  uniforms.squash.value = state.squash.value;
  uniforms.shear.value.set(state.shearX.value, state.shearZ.value);
  uniforms.twist.value = state.twist.value;
  uniforms.morph.value = state.morph.value;
  uniforms.grabOffset.value.set(...state.grab.map(s => s.value));
  jelly.position.copy(body.position);
  // Pointer attraction is already carried by the shear springs. Adding a
  // free-body-only position offset made reattachment jump back in one frame.
  jelly.quaternion.copy(body.orientation);
  inverseBodyRotation.copy(body.orientation).invert();
  uniforms.bodyPosition.value.copy(jelly.position);
  uniforms.bodyScale.value = jelly.scale.x;
  uniforms.clearance.value = body.clearance;
  uniforms.adhesion.value = THREE.MathUtils.lerp(uniforms.adhesion.value, body.attached ? 1 : 0, paused ? 1 : 1 - Math.exp(-elapsed * 14));
  uniforms.peel.value = body.peel;
  uniforms.peelDirection.value.copy(body.peelDirection);
  rotationMatrix.makeRotationFromQuaternion(body.orientation);
  uniforms.bodyRotation.value.setFromMatrix4(rotationMatrix);
  uniforms.bodyInverseRotation.value.copy(uniforms.bodyRotation.value).transpose();
  uniforms.viewDirection.value.copy(camera.position).sub(jelly.position).normalize().applyQuaternion(inverseBodyRotation);
  proxy.position.copy(jelly.position); proxy.quaternion.copy(jelly.quaternion);
  jelly.updateMatrixWorld(true); proxy.updateMatrixWorld(true);
  if (dragging || (!body.attached && body.grounded)) body.observeSurfaceContact(updateHitSurface());
  if (!uploadedModel) bubbleLocations.forEach(([x, y, z, r], index) => {
    const compact = 1 - state.morph.value * .14;
    elasticPoint(x * compact, y * compact, z * compact, bubbleTransform.position);
    bubbleTransform.scale.set(r, r * (1 + state.squash.value), r);
    bubbleTransform.updateMatrix(); bubbles.setMatrixAt(index, bubbleTransform.matrix);
  });
  bubbles.instanceMatrix.needsUpdate = true;
  const colorEase = paused || reducedMotion.matches ? 1 : 1 - Math.exp(-elapsed * 4);
  material.color.lerp(colorTarget, colorEase); material.attenuationColor.lerp(absorptionTarget, colorEase);
  uniforms.scatter.value.lerp(scatterTarget, colorEase); caustic.material.color.lerp(colorTarget, colorEase);
  const spread = 1 - state.squash.value * .25 + body.clearance * .2;
  shadow.scale.set(spread * jelly.scale.x, spread * jelly.scale.x, 1);
  shadow.position.x = jelly.position.x + .12;
  shadow.position.z = jelly.position.z + .1;
  shadow.material.opacity = 1.0 / (1 + body.clearance * 1.6);
  caustic.position.set(jelly.position.x + .7, -.01, jelly.position.z + .35);
  renderer.render(scene, camera);
  // One conservative quality adjustment after warmup; never oscillate resolution.
  if (!paused && !qualityChecked && state.time > 3 && state.time < 8) {
    if (elapsed > .028) slowFrames++;
    if (slowFrames > 65 && renderer.getPixelRatio() > (innerWidth <= 900 ? 1.45 : 1.6)) {
      // Preserve a sharp image when a device is busy rather than falling all
      // the way back to a visibly soft 1× canvas.
      renderer.setPixelRatio(innerWidth <= 900 ? 1.45 : 1.6); qualityChecked = true; resize();
    }
  }
  if (state.time >= 8) qualityChecked = true;
}

listen(document, 'visibilitychange', () => { lastTime = 0; if (document.hidden) release(); });
listen(window, 'pagehide', event => {
  if (event.persisted) return;
  disposed = true; renderer?.setAnimationLoop(null); observer.disconnect(); listenerController.abort();
  const textures = new Set(), materials = new Set(), geometries = new Set();
  scene?.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.material) {
      materials.add(object.material);
      for (const value of Object.values(object.material)) if (value?.isTexture) textures.add(value);
    }
  });
  textures.forEach(t => t.dispose()); materials.forEach(m => m.dispose()); geometries.forEach(g => g.dispose());
  proxy?.geometry.dispose(); proxy?.material.dispose(); environmentTarget?.dispose(); deskBgTexture?.dispose(); renderer?.dispose();
  defaultGeometry?.dispose(); defaultHitGeometry?.dispose();
});

initialize().catch(error => {
  console.error('Soft Matter could not initialize:', error);
  $('#scene-loading').hidden = true; $('#render-error').hidden = false;
  $('#renderer-status').textContent = 'UNAVAILABLE'; $('#motion-status').textContent = 'OFFLINE';
});
