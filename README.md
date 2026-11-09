# Soft Matter

A minimal interactive material study: translucent jelly, an off-white studio, editorial typography, and responsive spring motion. Built in a separate directory to preserve the existing Margin Quest application.

## Run

Requires Node.js 22.13+ (or a current Node.js 24 release).

```sh
cd jelly-lab
npm install
npm run dev
```

Open the local URL shown by Vite (normally http://127.0.0.1:5174). In the existing workspace, dependencies are also available from the parent folder, so `npm run dev` works without another install.

```sh
npm test
npm run build
npm run preview
```

`dist/` is the complete static production output. Serve it over HTTPS (or localhost) for WebGPU. The site also runs on a subdirectory thanks to relative asset paths. No backend or API keys are required.

## Interaction

- Move over the scene for a gentle attraction toward the pointer.
- Click the material for a localized dimple and soft compression.
- Drag a point to stretch the surface and progressively peel the nearest lip off the floor. Ground contact is checked against the deformed picking surface: when its final contact lifts, the body immediately follows the pull instead of remaining pinned until a fixed peel threshold. The pointer target has no distance cap; only local deformation is limited. Landing and re-gripping creates a fresh contact patch without resetting the pose.
- Scroll over the sculpture to morph between a cushion and a rounded form. The lower “Material in motion” button also changes the form.
- Choose Rose, Jade, or Amber and adjust softness and clarity.
- Nudge, pause/resume, and reset are available on desktop and mobile.
- Focus the canvas and use Space to nudge, arrow keys to deform, or R to reset.
- Reduced-motion preference starts the simulation paused. Explicitly pressing Nudge or Resume enables it.

## GLB shapes

Use **Upload GLB** in the material panel to replace the specimen with a local model. The file stays in the browser; no account, API, or server upload is involved. Its original colors and textures are replaced by the current jelly material. The filename button picks a replacement, **×** restores the default jelly, and Reset keeps the selected model while resetting its motion and material controls. Reloading the page returns to the default shape.

Files must be self-contained GLB 2.0, up to 25 MB and 80,000 triangles. Draco and Meshopt decoders are configured locally. Imported hierarchy transforms, mirrored meshes, instances, and the initial skinned/morph pose are baked into a centered shape and fitted to the scene. Animation playback is not imported. Sparse meshes are subdivided within the triangle budget so their faces can stretch. Invalid or oversized imports show a short message and preserve the existing specimen.

The same jelly deformation and refraction run on the imported surface, preserving holes and silhouettes. Ground support is computed from the uploaded vertices in the current orientation. Scroll adds a subtle proportional shape change. This remains an approximate soft body: multiple disconnected mesh parts move as one specimen, and open surfaces or very thin/complex overlapping geometry may not look like a sealed volume. Closed, moderately detailed meshes give the best result.

`npm test` includes import validation, shape preservation, and repeated custom-shape contact cycles. `node qa-model-upload.mjs` exercises actual file selection, rendering, two lift/land cycles, failed-import recovery, repeated replacement, reset, geometry cleanup, and mobile layout in the local preview on port 5176, using WebGPU and WebGL 2.

## Rendering and motion

- Three.js r185 `WebGPURenderer`, with automatic WebGL 2 fallback. The status indicator reports the actual renderer. Add `?webgl` to exercise the fallback deliberately.
- TSL vertex deformation of a smooth superellipsoid, combining low-frequency noise, near-volume-preserving squash, shear, twist, and a wide Gaussian grab field. Bonded pulling distributes stretch through the upper body while keeping a compressed contact patch fixed. Bonded stretch has twice the previous range; downward compression is bounded independently.
- Differentiated surface normals use immutable geometry coordinates, preventing double deformation and gray reflection artifacts during large pulls.
- Two optical interfaces: the deforming rear wall samples the studio environment using exit refraction, Fresnel reflection, and total internal reflection. It renders into the opaque transmission buffer, then the physical front surface refracts that image. This creates visible opposite-wall distortion and deep bright/dark folds instead of only refracting a blank floor. This is a real-time screen-space approximation, not recursive ray tracing; rear transmission samples the studio rather than arbitrary scene objects. Dispersion, clearcoat, color absorption, and restrained subsurface scattering complete the front surface.
- Procedural studio reflections, a refracted floor grid, soft contact shadow, a subtle transmitted color pool, and moving air inclusions. No downloaded 3D models or environment maps.
- Fixed 120 Hz spring integration plus a moving center of mass, quaternion rotation, off-center grip forces, gravity, and frictional ground contact. A continuous peel front advances across the world-space footprint according to tensile displacement and grab direction, blending per-point adhesion and curling the released lip upward. The last edge releases only after the front has crossed the patch; there is no whole-face timer switch or sudden change of displacement cap. A ground re-grip restores contact even with residual rolling, while airborne re-grips remain free. Passive re-bonding also works after landing with low tension. Low restitution and strong ground damping give weight without disabling rolling. The picking shell and internal bubbles use the same contact field. This is a physically inspired hybrid simulation, not a finite-element or fluid solver. Contact shadows and the light pool are artistic approximations, not ray-traced caustics.
- Pixel ratio capped at 1.75 desktop / 1.5 mobile with a conservative adaptive reduction on slower devices. Mobile uses fewer vertices. Rendering stops in hidden tabs and slows while paused. Graphics resources are disposed when the page is left.
- Fonts: Instrument Serif and DM Sans, loaded from Google Fonts with local serif/sans-serif fallbacks.

The supplied video informed the rounded gel shape, local pulling interaction, sparse layout, and specimen controls. It is not included in the production site.

## Verification

`npm test` checks compression and rebound at different firmness settings, recovery after dragging, frame-rate-independent integration, small-pull resistance, rolling under larger pulls, lifting and landing, retained rotation, and bounded motion under extreme input.

Browser QA exercised real WebGPU rendering in Edge, forced WebGL 2 rendering, drag and recovery, click/touch impact, scroll morph, both material sliders, all palettes, pause/nudge/reset, keyboard controls, the About dialog, a 390 px mobile layout, and reduced-motion behavior. Screenshots and the machine-readable run report are in the local `qa/` directory; these are excluded from production.

The browser QA scripts use the Codex environment's Playwright installation. For another machine, install Playwright and replace their import path. They are development utilities, not dependencies of the site.

References: [Three.js WebGPURenderer](https://threejs.org/manual/en/webgpurenderer), [MeshPhysicalNodeMaterial](https://threejs.org/docs/pages/MeshPhysicalNodeMaterial.html).
