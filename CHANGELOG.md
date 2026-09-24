# Changelog

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

First release as a standalone repository. Extracted unchanged from Quickuder,
where it was written and used for the shopping assistant's avatar and campaign
heroes. Scope renamed `@quickuder/scene-engine` → `@t569/scene-engine`.

- `Scene`: one `requestAnimationFrame` clock, clamped deltas, paint order = array order.
- `BaseObject` with `rect` / `circle` / `text` shapes; `approach()` easing.
- Presets: `draggable`, `hover_scale`.
- `parseScene` / `validateSceneSpec`: JSON in, running scene out, with path-named errors.
- Plugin: `@t569/scene-engine/dicebear`.
