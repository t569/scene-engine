# @t569/scene-engine

An SVG-first scene graph for the web. Describe a scene as JSON (or build it in
TypeScript), hand it one clock, and get interactive, frame-exact animation: 2D
shapes, keyframed choreography you can scrub, 3D surfaces you can orbit, typeset
math, and characters with emotions. **Zero runtime dependencies**, no framework.

## What it's for

One engine, several jobs. None of them is the "real" one; the design has to
serve all of them, and a change that helps one by breaking another is wrong.

| Use | What it looks like | Why a scene engine and not a video or a component |
|---|---|---|
| **Advertising and campaigns** | Promo heroes, flash-sale banners, product showcases, animated ads | The campaign record carries its own `SceneSpec`, so marketing ships a new animation by changing data, with no code change or deploy. Its first production use was [Quickuder](https://quickuder-1.onrender.com/)'s campaign heroes. Unlike a video it stays crisp, tiny, themeable (`fill`/`background` come from the campaign's colours) and interactive. |
| **Characters** | Animated assistants and mascots with emotions | One clock drives the face, the motion and anything beside it, so nothing drifts out of sync. See the `character` plugin. |
| **Explanations and simulations** | Math animations, diagrams you can drag and scrub, Brilliant-style puzzles | Manim-style choreography plus live params, plots, sliders and goals: the reader changes a number and the figure answers. |
| **Generated interactive pages** | Model- or tool-authored widgets: a size chart, a comparison, a simulation | A scene is data, so a model can write one; `validateSceneSpec` is the trust boundary that makes that safe to mount. |

The long-term aim is a small Manim/Blender for websites, where any of the above
can be authored as a document rather than as code. See [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Sixty seconds

```ts
import { parseScene } from '@t569/scene-engine';

const banner = parseScene(
  {
    width: 900,
    height: 300,
    background: '#0f172a',
    objects: [
      {
        type: 'text', text: 'FLASH SALE', x: 330, y: 130, fontSize: 64, fill: '#f8fafc', scale: 0,
        animate: { loop: 4, scale: [{ at: 0.1, dur: 0.6, to: 1, ease: 'outBack' }] },
      },
      {
        type: 'path', d: 'M150 175 L510 175', stroke: '#f59e0b', strokeWidth: 6, draw: 0,
        animate: { loop: 4, draw: [{ at: 0.6, dur: 0.8, to: 1 }] },
      },
      { type: 'circle', x: 720, y: 150, radius: 80, fill: '#f59e0b', hover_scale: 1.1 },
    ],
  },
  document.getElementById('stage')!,
);
banner.start();
```

A looping ad: the headline pops in, the underline draws itself, the badge
responds to hover. None of it is code you wrote. Open [`demo.html`](demo.html)
for five live examples (presets, an ad, a scrubbed choreography, a 3D Klein
bottle, a character).

## Install

```bash
npm install github:t569/scene-engine        # or copy it in with git subtree
```

Source is TypeScript under `src/`; `npm run build` emits ESM + types to `dist/`.

## Concepts

| Idea | Rule |
|---|---|
| **One clock** | `Scene` owns the only `requestAnimationFrame` loop. Objects never run timers or CSS transitions; they get `onUpdate(dt, elapsed)`. That keeps plugins wrapping other engines frame-exact with native nodes. |
| **Time is seekable** | Keyframes are a pure function of time, so `scene.seek(t)` paints any moment exactly: scroll can drive a scene, a slider can scrub it, an exporter can step it. |
| **Clamped time** | While playing, `dt` is capped at 0.1s, so a backgrounded tab resumes as a slow frame instead of a teleport. |
| **Paint order = array order** | No `z` field, ever. Later objects paint over earlier ones. (Inside `space3d`, depth sorts.) |
| **Scene units** | Coordinates are in the `viewBox`, not pixels. The svg scales to its box. |
| **Centred origins** | Shapes are drawn about their own origin, so `rotation` and `scale` pivot about the middle. |
| **Validate at the boundary** | `parseScene` validates untrusted JSON, caps anything whose cost grows with a number, and throws `SceneSpecError` naming the bad path. |

## Schema

```ts
interface SceneSpec {
  width: number;
  height: number;
  background?: string;
  assets?: { id: string; kind: 'font' | 'image'; src: string; family?: string }[];
  objects: NodeSpec[];                     // paint order
}
```

**Every node** takes `id?`, `x?`, `y?`, `scale?`, `rotation?` (degrees),
`opacity?`, the presets `draggable?` and `hover_scale?`, `animate?`, and the
interactive `bind?`, `control?` and `visible_when?`. A scene may declare `params`.

| `type` | Fields |
|---|---|
| `rect` | `width`, `height`, `fill?`, `rx?`, stroke† |
| `circle` | `radius`, `fill?`, stroke† |
| `text` | `text`, `fill?`, `fontSize?`, `asset_id?` (a font from `assets`) |
| `path` | `d` (SVG path data), `fill?` (default none), stroke† |
| `polyline` | `points: [x, y][]`, `closed?`, `fill?`, stroke† |
| `tex` | `tex`, `width`, `height`, `color?`, `fontSize?`: needs `renderTex` (below) |
| `plot` | `expr`, `domain`, `range`, `width`, `height`, `samples?`, `stroke?`, `strokeWidth?`, `axes?` |
| `slider` | `param`, `width`, `label?`, `color?`, `track?`, `textColor?` |
| `space3d` | `items`, `camera?`, `orbit?`, `spin?` (see 3D) |

† stroke = `stroke?`, `strokeWidth?`, `draw?` (0–1 reveal).

### Animation

```jsonc
"animate": {
  "loop": 4,                                        // optional: repeat every 4s
  "x":       [{ "at": 0, "dur": 1, "to": 200 }, { "at": 2, "dur": 1, "to": 0 }],
  "opacity": [{ "at": 3, "dur": 0.5, "to": 0, "ease": "in" }],
  "draw":    [{ "at": 0, "dur": 2, "to": 1 }]       // stroke reveal: Manim's Create
}
```

Animatable: `x`, `y`, `scale`, `rotation`, `opacity`, `draw`. A segment runs
from wherever the property was (or `from`) to `to`, over `dur` seconds from
`at`, so a list reads like a script. Before its first segment a property holds
its spec value; after its last it holds the last `to`.

Easings: `smooth` (default), `linear`, `step`, `in`, `out`, `inOut`,
`outBack`, `inOutSine`, `rushInto`, `rushFrom`, `thereAndBack`, `wiggle`.
The last two go out and come back, the shape of a pulse or a shake. `smooth`,
`rushInto`, `rushFrom`, `thereAndBack` and `wiggle` are Manim's rate functions;
`step` is Blender's CONSTANT interpolation.

### 3D

```jsonc
{
  "type": "space3d", "x": 300, "y": 200, "orbit": true, "spin": 0.25,
  "camera": { "yaw": 0.6, "pitch": 0.55, "zoom": 38, "distance": 12 },
  "items": [
    { "shape": "klein8", "stroke": "#1e293b", "fill": "#6366f1", "fillOpacity": 0.16 },
    { "shape": "torusKnot", "params": { "p": 2, "q": 3 }, "stroke": "#e11d48", "strokeWidth": 2 }
  ]
}
```

Surfaces: `klein8`, `torus`, `sphere`, `mobius`. Curves: `helix`, `torusKnot`,
`lissajous`. All items share one camera and are depth-sorted together, so a
curve can pass behind a surface and out again. Omit `distance` for
orthographic. `steps` sets resolution. Shapes are named, not formula strings,
because a spec may come from a model and a formula string would be code. In
TypeScript, `Space3D.add` takes any function (`SurfaceItem` / `CurveItem`),
with `reveal` (a surface filling in along u), `highlight` (one bold ring,
coloured by `highlightStroke`), `draw` (a curve drawing itself) and
`strokeOpacity` (for a figure that sits quietly beside text).

### Interactive: params, formulas, sliders, handles, goals

The interactive layer (0.3) is modelled on what makes Brilliant's and
Desmos's figures teach: the reader changes a number, and everything that
depends on it answers at once. All of it is data.

```jsonc
{
  "width": 600, "height": 400,
  "params": {
    "a": { "value": 0.2, "min": 0, "max": 1.5, "step": 0.05 },
    "b": { "value": 2, "min": 1, "max": 8, "step": 0.5 }
  },
  "objects": [
    { "type": "plot", "x": 300, "y": 140, "width": 520, "height": 200,
      "domain": [0, 8], "range": [-1, 1], "expr": "exp(-a*x)*sin(b*x)" },
    { "type": "slider", "param": "a", "x": 170, "y": 300, "width": 220, "label": "decay a = {a:2}" },
    { "type": "circle", "radius": 10, "y": 355, "control": { "x": { "param": "b", "range": [40, 560] } } },
    { "type": "text", "x": 500, "y": 20, "text": "Matched ✓",
      "visible_when": [{ "expr": "abs(a - 0.6)", "max": 0.001 }, { "expr": "abs(b - 5)", "max": 0.001 }] }
  ]
}
```

| Piece | What it does |
|---|---|
| `params` | Named knobs with `value`, `min`, `max`, `step`. One store: every control writes it, everything else reads it. |
| Expressions | `exp(-a*x)*sin(b*x)`, `300 + 40*a`, `90*sin(t)`: numbers, params, `t` (seconds), `x` (in a plot), `+ − * / % ^`, and whitelisted functions (`sin cos tan asin acos atan atan2 sinh cosh tanh exp ln log log2 sqrt cbrt abs sign floor ceil round pow mod clamp lerp min max hypot`) and constants (`pi e tau`). |
| `bind` | Any animatable property from an expression, every frame: `{ "bind": { "x": "300 + 40*a" } }`. Wins over `animate`. |
| `plot` | y = f(x) in a box, re-plotted when a param changes (every frame if it uses `t`). Breaks at poles instead of drawing through them. |
| `slider` | A slider drawn in the scene, bound to a param; `label` is a template. |
| `control` | Turns any node into a handle: its position *is* a param, and dragging it sets the param, so the param's range and step constrain the drag. |
| Templates | Text with `{expr}` or `{expr:digits}` holes updates live: `"period = {2*pi/b:2} s"`. |
| `visible_when` | Show a node only while `min ≤ expr ≤ max` (all conditions, if a list): goals, hints, step-by-step reveals. |

**Why a parser and not `eval`.** A spec may be written by a model or a
stranger. Formulas go through a small hand-written parser that knows only
the grammar above; every name is checked when the spec loads, lookups go
through `Map`s so `constructor` or `__proto__` reach nothing, and length and
nesting are capped. A bad formula is a `SceneSpecError` naming its path, at
load time.

In code: `scene.params.set('a', 1)`, `scene.params.on((name, value) => …)`,
and `compile(src, vars)` / `compileTemplate(src, vars)` for your own nodes.
A scene that is not playing repaints on any param change, so controls work
under reduced motion too.

### Math

```ts
import katex from 'katex';
parseScene(spec, el, { renderTex: (tex) => katex.renderToString(tex) });
```

`{ "type": "tex", "tex": "e^{i\\pi} + 1 = 0", "width": 200, "height": 40 }`
then renders in a `<foreignObject>`. The renderer's output is inserted as
HTML: safe with KaTeX's default `trust: false`, not with a renderer that
passes input through.

### Limits

`LIMITS` caps objects (2000), polyline points (5000), segments per property
(200), surface grid (200 per side), curve samples (4000) and 3D items (32).
Font references with quote, backslash, newline or angle-bracket characters are
refused: they are spliced into an `@font-face` rule, and a `<style>` inside an
svg styles the whole page.

## API

| Export | What it is |
|---|---|
| `parseScene(spec, mount, { renderTex? })` | Validate, build and paint a scene. `.start()` to play. |
| `validateSceneSpec(spec)`, `SceneSpecError`, `LIMITS` | The guard on its own. |
| `Scene` | `add(node, id?)`, `remove`, `find(id)`, `start`, `stop`, `seek(t)`, `destroy`, `elapsed`. |
| `BaseObject` | A transform `<g>` around one child; `x y scale rotation opacity draw`. Subclass for behaviour. |
| `rect` `circle` `text` `path` `polyline` `texElement` | Element factories. |
| `createObject(spec, font?, options?)` | One `NodeSpec` → node. |
| `compileAnimate`, `sampleSegments`, `localTime`, `EASES` | The timeline, pure. |
| `Space3D`, `SHAPES`, `project`, `itemFromSpec`, `buildPrimitives`, `bandByDepth`, `toPathData` | 3D, pure except `Space3D`. |
| `approach(current, target, rate, dt)` | Frame-rate-independent exponential easing. |

### Writing behaviour

```ts
import { BaseObject, Scene, circle } from '@t569/scene-engine';

class Orbiter extends BaseObject {
  override onUpdate(dt: number, t: number) {
    super.onUpdate(dt, t);              // keep presets and `animate` working
    this.x = 300 + 120 * Math.cos(t);   // a function of t, so it also seeks
    this.y = 200 + 120 * Math.sin(t);
  }
}

const scene = new Scene({ width: 600, height: 400 }, el);
scene.add(new Orbiter(circle({ type: 'circle', radius: 12 })));
scene.start();
```

Write motion as a function of `elapsed` where you can; then `seek` works. Something
that integrates `dt` (velocity, physics) plays fine but holds still on a seek.

### In React

```tsx
useEffect(() => {
  const scene = parseScene(spec, ref.current!);
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) scene.start();
  return () => scene.destroy();
}, [spec]);
```

## Plugins

Separate entry points, never re-exported from the core, so importing `Scene`
pulls in none of them.

### `@t569/scene-engine/character`

```ts
import { CharacterNode } from '@t569/scene-engine/character';

const karl = scene.add(new CharacterNode({ x: 300, y: 200, size: 180, render: (emotion) => svgMarkup(emotion) }));
karl.setEmotion('thinking');
```

`render` returns `<svg>` markup for an emotion (DiceBear, hand-drawn,
anything) and is called once per emotion. Each emotion also has a motion row
(breath, bob, tilt, shake, lean, angle) that is **eased** into, so a change of
mood is a gesture winding down into another rather than a cut. Built in:
`idle`, `listening`, `thinking`, `speaking`, `happy`, `sleeping`, `error`, and
the shopping-assistant set `awaiting_approval`, `syncing`, `escalated`. Add or
override rows with `motions`. `easeMotion` and `pose` are exported, pure.

### `@t569/scene-engine/graph`

A living graph, Obsidian-style: stars repel, links pull like springs, the
layout cools and then stops computing. Drag a star (its neighbours follow),
drag empty space to pan, wheel or pinch to zoom, hover to light up a
neighbourhood, click to open.

```ts
import { GraphNode } from '@t569/scene-engine/graph';

const graph = scene.add(new GraphNode({
  width: 800, height: 600,
  nodes: [{ id: '/notes', label: 'Notes', kind: 'page', weight: 5 }, …],
  edges: [{ source: '/notes#s1', target: '/notes', kind: 'part' }, …],
  kinds: { page: { fill: '#6366f1', radius: 9, label: 'always' }, section: { fill: '#94a3b8', radius: 4, label: 'zoom' } },
  edgeKinds: { part: { stroke: '#94a3b8', width: 1, opacity: 0.6, length: 34, strength: 0.9 }, … },
  onOpen: (node) => navigate(node.id),
}));
graph.focus('/notes');            // fly the camera to a star
graph.setHighlight(['/lab']);     // ring stars, e.g. "these were the sources"
graph.fit();                      // everything in view
```

`stepForces`, `spiralLayout`, `neighbours` and `zoomAt` are exported pure.
The one node that doesn't seek: a force layout integrates, so its state at
`t` depends on every frame before it.

### `@t569/scene-engine/dicebear`

Adopts a DiceBear SVG string as a node. It takes markup rather than a DiceBear
instance, so the engine keeps no dependency; `dicebearOptions({ inScene: true })`
turns off DiceBear's own CSS animation so the scene's clock is the only one.

## Development

```bash
npm install
npm test            # vitest, DOM-free: timeline, projection, validation, motion
npm run typecheck
npm run build       # → dist/
npx http-server -p 8200 .   # then open /demo.html (after a build)
```

Design contract, plugin seam, the Manim layer and deliberate absences:
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Where it's going:
[`docs/ROADMAP.md`](docs/ROADMAP.md).

## Credits

Easing names and the `smooth` family are adapted from
[Manim Community](https://github.com/ManimCommunity/manim) (MIT). The keyframe
model borrows Blender's F-curve idea and its CONSTANT interpolation; no Blender
code is used. Written for [Quickuder](https://quickuder-1.onrender.com/)'s
shopping assistant and campaign heroes, then extracted. MIT.
