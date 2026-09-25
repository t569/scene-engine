# Changelog

## 0.5.0: buttons and colour choices

Driven by a shirt designer: pick a style, a colour, a print.

- **`on_click: { set }`** on any node: click, Enter or Space sets params. `role="button"`, focusable.
- **`fill_by: { param, palette }`**: fill is `palette[round(param)]`; repainted only when a param changes.
  Palette entries are validated as inert colour strings.

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
