# @t569/scene-engine

An SVG-first scene graph for the web. Describe a scene as JSON (or build it in
TypeScript), hand it one clock, and get interactive, frame-exact animation with
**zero runtime dependencies** and no framework.

The long-term aim is a small Manim/Blender for websites: scenes that explain
mathematics, simulations people (and models) can author as data, and interactive
pages built from the same parts. See [`docs/ROADMAP.md`](docs/ROADMAP.md).

```ts
import { parseScene } from '@t569/scene-engine';

const scene = parseScene(
  {
    width: 600,
    height: 400,
    background: '#fff',
    objects: [
      { type: 'rect', x: 200, y: 200, width: 120, height: 120, rx: 16, draggable: true },
      { type: 'circle', x: 400, y: 200, radius: 56, fill: '#4ADE80', hover_scale: 1.2 },
    ],
  },
  document.getElementById('stage')!,
);
scene.start();
```

Drag the square, hover the circle. Neither behaviour is code you wrote: the spec
says `draggable` and `hover_scale`.

## Install

```bash
npm install github:t569/scene-engine        # or copy it in with git subtree
```

The package ships TypeScript source under `src/` and builds to `dist/` with `npm run build`.

## Concepts

| Idea | Rule |
|---|---|
| **One clock** | `Scene` owns the only `requestAnimationFrame` loop. Objects never run timers or CSS transitions; they get `onUpdate(dt, elapsed)`. That is what keeps plugins wrapping other engines frame-exact with native nodes. |
| **Clamped time** | `dt` is capped at `MAX_DELTA` (0.1s), so a backgrounded tab resumes as a slow frame instead of a teleport. |
| **Paint order = array order** | No `z` field, ever. Later objects paint over earlier ones. |
| **Scene units** | Coordinates are in the `viewBox`, not pixels. The svg scales to its box; `toSceneCoords` converts pointer events. |
| **Centred origins** | Shapes are drawn about their own origin, so `rotation` and `scale` pivot about the middle. |
| **Validate at the boundary** | `parseScene` validates untrusted JSON and throws `SceneSpecError` naming the bad path (`scene.objects[3] (rect) needs numeric width and height`). |

## Schema

```ts
interface SceneSpec {
  width: number;
  height: number;
  background?: string;
  assets?: { id: string; kind: 'font' | 'image'; src: string; family?: string }[];
  objects: NodeSpec[];                 // paint order
}

// Every node: id?, x?, y?, scale?, rotation? (degrees), opacity?,
//             draggable?, hover_scale?
type NodeSpec =
  | { type: 'rect'; width: number; height: number; fill?: string; rx?: number }
  | { type: 'circle'; radius: number; fill?: string }
  | { type: 'text'; text: string; fill?: string; fontSize?: number; asset_id?: string };
```

Fonts in `assets` are registered inside the scene's own `<svg>`, so they leave
with the scene rather than leaking into the page.

## API

| Export | What it is |
|---|---|
| `parseScene(spec, mount)` | Validate, build and paint a scene. Call `.start()` to animate. |
| `validateSceneSpec(spec)` | The guard on its own (assertion function). |
| `Scene` | `add(node, id?)`, `remove`, `find(id)`, `start`, `stop`, `destroy`, `elapsed`. |
| `BaseObject` | A transform `<g>` around one child. Subclass it for behaviour. |
| `rect` / `circle` / `text` | Element factories used by the parser. |
| `approach(current, target, rate, dt)` | Frame-rate-independent exponential easing. |
| `applyPresets`, `toSceneCoords`, `clampDelta` | The pieces behind the presets and the clock. |

### Writing behaviour

```ts
import { BaseObject, Scene, circle } from '@t569/scene-engine';

class Orbiter extends BaseObject {
  override onUpdate(dt: number, t: number) {
    super.onUpdate(dt, t);              // keep presets easing
    this.x = 300 + 120 * Math.cos(t);
    this.y = 200 + 120 * Math.sin(t);
  }
}

const scene = new Scene({ width: 600, height: 400 }, el);
scene.add(new Orbiter(circle({ type: 'circle', radius: 12 })));
scene.start();
```

## Plugins

A plugin is a `BaseObject` subclass (or anything implementing `SceneNode`) that
advances a foreign thing inside `onUpdate`. Plugins are separate entry points and
are never re-exported from the core, so importing `Scene` pulls in none of them.

- **`@t569/scene-engine/dicebear`**: adopts a DiceBear SVG string as a node. It
  takes markup rather than a DiceBear instance, so the engine keeps no dependency;
  `dicebearOptions({ inScene: true })` turns off DiceBear's own CSS animation so
  the scene's clock is the only one.

## Development

```bash
npm install
npm test            # vitest
npm run typecheck
npm run build       # → dist/
npx http-server -p 8200 .   # then open /demo.html (after a build)
```

Design contract, plugin seam and deliberate absences: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Origin

Written for [Quickuder](https://quickuder-1.onrender.com/)'s shopping
assistant and campaign heroes, then extracted so other projects can use it. MIT.
