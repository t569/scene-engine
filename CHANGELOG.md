# Changelog

## Unreleased

- `ThreeNode.sharedRenderer`: many views, one WebGL context. Views made while it is set draw into
  their own render target (`output`, `version`, `background`) for a host to composite
  onto its canvas, instead of each holding one of the browser's ~16 contexts. The README has the details.
- `ThreeNode.onDraw`: called whenever a shared view has drawn, so a host composites in the same
  frame. Compositing from the host's own animation frame showed the frame before: a drag answered late.
- The resolution governor judges frames against the display's own period (measured once, at the first
  view), never less than the 20 ms budget. Unchanged at 60 Hz; at 30 Hz (battery saver, some displays)
  every frame used to read as slow and every view sat at its lowest resolution.
- Far over budget (3x), the governor decides in three frames and drops straight to the scale that would
  fit (cost goes with scale squared), rather than 20 % per twenty-frame window: at 200 ms a frame, that
  was half a minute of stalls.
- `ThreeNode.setClearColor`: the clear colour kept per view and restored before each shared frame.
  `scene3d`'s `background` uses it; it was lost on a shared renderer.
- `scene3d` particles are sized by what they are drawn into, not the renderer's canvas (three's
  `PointsMaterial` reads the canvas). Unchanged alone; on a shared renderer they were too big.
- `disposeObject` also disposes textures held in a `ShaderMaterial`'s uniforms. Losing a view's own
  context used to free them; a shared context keeps them until something disposes them.

- `scene3d`: `bloom` and a `particles` object (`count`, `radius`, `shape`, `size`, `speed`, `colors`), both
  validated and capped (50 000 points per scene). Points move in the vertex shader from the time alone:
  seekable, no CPU per frame, deterministic seeding so a still frame is the same on every load.
- Fix: a stopped scene (reduced motion: one `seek`) never drew what arrived later — the bloom code, a
  model — so its still frame stayed plain or empty. `ThreeNode` now repaints itself at the scene's time,
  and also when it scrolls into view: one that mounted off screen had skipped its only frame (black).
- Fix: an overlay `ThreeNode` placed its canvas before its own transform was written. A scene that
  drew one frame (a `seek`) and then paused showed the canvas half a box up and left, over the page.
- `ThreeNode` `bloom: { strength, radius, threshold }`: glow via EffectComposer + UnrealBloomPass +
  OutputPass, imported only when set (views without it pay nothing), sized by the resolution
  governor, disposed on destroy.
- `space3d` polyhedra: `tetrahedron`, `cube`, `octahedron`, `cuboctahedron`, `icosahedron`,
  `dodecahedron`, as named shapes a spec can use. Edges are derived (vertex pairs at the shortest
  distance), drawn as a new `EdgesItem`, depth-faded like any line.
- `ThreeNode` `minResolution`: the adaptive-resolution floor, for fill-bound shaders (a deep-zoom
  fractal on a full-screen quad) that want to drop further while moving. Default unchanged, 0.75.
- `ThreeNode.moving(ms)`: code-driven input (drag, wheel, keys) draws at the resolution floor
  and sharpens when it stops. Input arrives in bursts, which the governor never saw as motion.
- Settling sharpens in steps (×1.6 scale), each only if the last frame's measured cost predicts
  under 250 ms. One full-resolution frame of a deep fractal took 6 s and tripped the GPU watchdog.
- `ThreeNode.frameCost`: the last drawn frame's cost, for callers that adapt their own work.

## 0.6.0: 3D, fast, and as data

`@t569/scene-engine/three`, tuned for phones and integrated laptop GPUs first.

- **`scene3d`**: a 3D scene in a SceneSpec: camera, orbit, studio environment, shadow floor, lights,
  models and primitives, validated at the same trust boundary as 2D (caps on objects, lights, shadow
  casters, nesting, segments; web URLs only; host `resolveAsset`, default same-origin). Params drive it:
  `bind` (position, rotation, scale, light intensity), `color_by`, `variant_by` (KHR_materials_variants),
  `visible_when`, and `on_click` on 3D objects. Animated models play a clip.
- **`ThreeNode`**: draws on demand (`invalidate('world' | 'view')`; an idle viewer renders nothing,
  shadows are redrawn only when the world changed); adaptive resolution (`ResolutionGovernor`, floor
  0.75 real px per CSS px, sharp on settle); pauses off screen; `orbit()` wired to all of it;
  `pick`, `groundPoint`, `loadModel`; disposes GPU memory and its context on destroy.
- **Overlay layering** by default: the canvas under the SVG, SVG on top and passing pointer events
  through. Measured a third of the janky frames of a canvas in a `<foreignObject>`; `layer: 'inline'`
  keeps exact array-order paint.
- **Models**: glTF cached per URL and copied per use (`instantiate`, skinned meshes included);
  Meshopt, KTX2 and Draco decoders fetched only when a file uses them (`gltfExtensions` sniffs the
  bytes; `configureLoaders` for decoder paths); `loadGLTF` for variants and clips.
- **`mergeStatic(root)`**: one draw call per material per part. On a PCB model (Intel Iris Plus),
  279 → 100 calls and the CPU cost of an animated frame 7.1 → 4.5 ms. Not visible in fps on that
  laptop, which had headroom; it is for weaker devices.
- Core: **plugin node types** (`registerNodeType`, `NodeTypeMap` augmentation, `SpecContext` with the
  core's own checks), and `BuildOptions.resolveAsset`.
- `three` is an optional peer dependency.

## 0.5.0: buttons and colour choices

Driven by a shirt designer: pick a style, a colour, a print.

- **`on_click: { set }`** on any node: click, Enter or Space sets params. `role="button"`, focusable.
- **`fill_by: { param, palette }`**: fill is `palette[round(param)]`; repainted only when a param changes.
  Palette entries are validated as inert colour strings.
- Installing from GitHub works: a `prepare` script builds `dist/` on install. Before, `npm install
  github:t569/scene-engine` gave a package with no code, since `dist/` isn't committed.

Performance: the per-frame path now does no work a frame doesn't need. Measured per frame, same machine,
before → after: 2000 static nodes 3.3 → 0.14 ms; 300 live texts + 300 bound nodes 2.1 → 0.14 ms;
1000 animated nodes 2.0 → 1.1 ms.

- `applyTransform` dirty-checks: a node writes `transform`, `opacity` and the stroke reveal only when
  they changed. In SVG even an identical attribute write can invalidate style and paint.
- Bindings, `visible_when` and text templates are re-evaluated only when a param changed, unless they
  read `t`. `usesTime(f)` (exported) says which do; plots use it too, replacing a regex that took the
  `t` in `sqrt` for time.
- Function calls in expressions no longer allocate an argument array per evaluation.
- `compileAnimate`'s sampler returns one reused object, overwritten each call, instead of a new one per
  frame. Read it before the next call.

## 0.4.0: the graph plugin

- `@t569/scene-engine/graph`: a force-directed graph node — repulsion, springs, gravity,
  frame-rate-independent friction, cooling to rest (then no work per frame). Pan, wheel and
  pinch zoom, drag with reheat, hover neighbourhoods, click to open, `focus()`, `fit()`,
  `setHighlight()`. Pure physics (`stepForces`) and camera maths (`zoomAt`), tested.
- `demo.html` gains a living graph.
- Gentler star sizes (log, capped), `fit(padding, maxZoom)`, `labelZoom`.
- `capturePointer`: pointer capture that doesn't throw when the pointer is already gone;
  every drag in the engine uses it.

## 0.3.0: the interactive layer

Modelled on Brilliant's and Desmos's figures. Additive: every 0.2 spec behaves as before.

- **`params`** on a scene: named knobs with min / max / step, one store (`scene.params`), change events.
- **Expressions** (`expr.ts`): a small, hand-written, whitelisted math language — no `eval`. Checked at load time.
- **`bind`**: any animatable property from an expression, every frame.
- **`plot`** node: y = f(x) with params and `t`, live; breaks at poles.
- **`slider`** node: in-scene, bound to a param, templated label.
- **`control`**: any node becomes a handle whose position is a param.
- **Text templates**: `{expr}` / `{expr:digits}` holes update live.
- **`visible_when`**: goals, hints and reveals.
- A stopped scene repaints on param change; `parseScene` paints the t = 0 frame of every node.
- `demo.html` gains a match-the-curve puzzle written entirely as JSON.
- Dragging is continuous: a slider knob or `control` handle follows the pointer exactly,
  between steps too, and glides onto the snapped value on release. `Scene.playing`, and
  `elapsed` on `SceneLike`.


- 3D items take `strokeOpacity` (lines fade from it with depth, default 1), and
  surfaces take `highlightStroke` (the lit ring's own colour, default `stroke`).

## 0.2.0: the Manim layer

Additive: every 0.1 spec and export behaves as before.

- **`animate`** on every node: keyframe segments per property (`x y scale rotation opacity draw`),
  optional `loop`. A pure function of time.
- **`scene.seek(t)`**: paint any moment exactly; scroll, sliders or exporters can own time.
- **Easings**: Manim's `smooth` (new default), `rushInto`, `rushFrom`, `thereAndBack`, `wiggle`;
  Blender's `step`; `linear`, `in`, `out`, `inOut`, `outBack`, `inOutSine`.
- **`draw`**: stroke reveal via `pathLength="1"`; `stroke`/`strokeWidth` on shapes.
- **Nodes**: `path`, `polyline`, `tex` (host-supplied renderer in `<foreignObject>`), `space3d`.
- **3D**: camera (yaw, pitch, zoom, perspective), named surfaces and curves, depth-banded SVG,
  `orbit` and seekable `spin`. `Space3D` accepts any parametric function in code.
- **Plugin `@t569/scene-engine/character`**: emotions as face + eased motion.
- **Limits** on spec-driven cost (`LIMITS`), and font references that could inject CSS are refused.
- `createObject` moved to `factory.ts` (same export from the package root) and takes build options.
- `demo.html` shows presets, an ad, a scrubbed choreography, a 3D Klein bottle and a character.

## 0.1.0 — extracted

First release as a standalone repository, extracted from [Quickuder](https://quickuder-1.onrender.com/)'s
shopping assistant avatar and campaign heroes.

- `Scene`: one `requestAnimationFrame` clock, clamped deltas, paint order = array order.
- `BaseObject` with `rect` / `circle` / `text` shapes; `approach()` easing.
- Presets: `draggable`, `hover_scale`.
- `parseScene` / `validateSceneSpec`: JSON in, running scene out, with path-named errors.
- Plugin: `@t569/scene-engine/dicebear`.
