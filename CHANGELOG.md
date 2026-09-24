# Changelog

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
