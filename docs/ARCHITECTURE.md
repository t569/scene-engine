# Specifications & Architecture: `@t569/scene-engine`

> This is the package's design contract.

## 1. Philosophy

A lightweight, frontend-first rendering library for interactive scenes, widgets
and animations. Mental model: Manim or Blender, but browser-native, and aimed at
standalone interactive artifacts rather than rendered video.

Three constraints shape everything else:

1. **Frontend-first, zero latency.** State and the render loop live entirely on
   the client. Nothing renders on a server, and no frame waits on a network call.
2. **SVG by default.** Vector output, real DOM nodes, real pointer events,
   accessible, debuggable in devtools. Canvas/WebGL is the exception, not the
   baseline, and when it arrives it arrives *inside* the SVG (§5).
3. **One clock.** The `Scene` owns a single `requestAnimationFrame` loop. No
   object, and no plugin, owns a timer. This is the constraint the whole design
   is built around, because it is the one that cannot be retrofitted.

Like `ai-assistant/`, this package is a **black box**: it imports no host code —
no Redux, no router, no API client, no React. It takes a spec and an element,
and gives back a `Scene`. Zero `any`.

## 2. Blueprint & directory structure

```
scene-engine/
├─ src/
│  ├─ types.ts     Core     — the entire contract: schema, Scene, BaseObject, lifecycle
│  ├─ scene.ts     Core     — the clock master: rAF loop, deltaTime, add/remove/paint order
│  ├─ objects.ts   Renderers + Inputs
│  │                        — BaseObject, shape factories, interaction presets
│  ├─ parse.ts     Parsers  — SceneSpec validation, asset registry, spec -> objects
│  ├─ index.ts              — the public surface, and nothing else
│  └─ plugins/
│     └─ dicebear.ts Plugins — opt-in, reached as `@t569/scene-engine/dicebear`
├─ demo.html               — the PoC
└─ specifications_and_architecture.md
```

The brief's five modules (Core, Renderers, Parsers, Inputs, Plugins) are all
here, a file each. Renderers and Inputs share `objects.ts` because a shape
factory is six lines and a preset is twenty — splitting them across directories
would add navigation cost and buy nothing. Split when a second renderer backend
exists.

`plugins/` is a folder rather than a file because each plugin is opt-in and
independently importable; nothing in `src/` outside that folder may import from
it, or the core stops being dependency-free by accident.

## 3. The schema

```jsonc
{
  "width": 600,
  "height": 400,
  "background": "#ffffff",

  // Declared once, referenced by asset_id. Heavy things don't get repeated
  // across forty nodes.
  "assets": [
    { "id": "display", "kind": "font", "src": "/fonts/display.woff2", "family": "Display" }
  ],

  // Array order IS z-order. Later entries paint over earlier ones.
  "objects": [
    { "id": "box", "type": "rect", "x": 200, "y": 200, "width": 120, "height": 120,
      "rx": 16, "fill": "#0B03EC", "draggable": true },
    { "id": "dot", "type": "circle", "x": 400, "y": 200, "radius": 56,
      "fill": "#4ADE80", "hover_scale": 1.2 },
    { "type": "text", "x": 300, "y": 340, "text": "Flash sale", "asset_id": "display" }
  ]
}
```

Four DX rules, each load-bearing:

- **Implicit z-index.** Render order is array order, strictly. There is no `z`
  property and there will not be one. It is implemented by DOM append order in
  `Scene.add` — so there is no sorting pass, no index to keep consistent, and
  no way for the JSON and the screen to disagree.
- **Flat transforms.** `x`, `y`, `scale`, `rotation`, `opacity` sit at the top
  level of every node. A nested `transform: {}` object is one more level for a
  non-programmer to get wrong, and buys nothing.
- **Asset registry.** `assets` declares heavy resources once; nodes reference
  them by `asset_id`. Fonts become an `@font-face` block inside the scene's own
  `<svg>`, so they are torn down with the scene rather than leaking into the
  host page's `<head>`.
- **High-level presets.** `draggable: true` and `hover_scale: 1.1` are flags,
  not code. The author says what they want, not how to wire pointer capture.

**Discriminated union.** `NodeSpec` is discriminated on `type`, so the `switch`
in `createObject` is exhaustive against a `never` default. Adding a node type
breaks the build until it is handled — which is the point — and the same
`default` doubles as the runtime guard for hand-written JSON.

### Validation is not optional

`validateSceneSpec` is a real runtime guard, and stays one. Specs arrive from a
backend campaign record, a hand-edited file, or a model's output — TypeScript
has nothing to say about any of those at runtime. Every field the renderer will
dereference is checked, and errors name the path (`scene.objects[2] has unknown
type "hexagon"`). The alternative is a silently blank scene and no clue why.

## 4. The clock

```ts
private readonly tick = (now: number): void => {
  const dt = this.last ? clampDelta(now - this.last) : 0;
  this.last = now;
  this.elapsed += dt;

  for (const node of this.nodes) {
    node.onUpdate?.(dt, this.elapsed);
    node.applyTransform();
  }

  this.raf = requestAnimationFrame(this.tick);
};
```

Three invariants:

1. **One loop, one pass.** Every node — native or plugin-wrapped — is advanced
   inside the same iteration, with the same `dt`. That is what makes a Rive
   character and an SVG shape beside it frame-exact instead of merely
   approximately in step.
2. **`dt` is clamped** (`MAX_DELTA`, 100ms). A backgrounded tab stops firing
   rAF; on refocus the first gap is seconds long. Unclamped, every
   velocity-integrating object jumps a screen-width in one frame and the scene
   visibly teleports. Clamped, a long stall looks like a slow frame — the scene
   falls behind wall-clock time, which nobody notices.
3. **`elapsed` accumulates clamped deltas**, not wall-clock time. It is
   animation time. If you need wall-clock, ask the clock, not the scene.

**Easing runs on the clock, not on CSS.** `hover_scale` moves a *target*; the
scale itself is eased in `BaseObject.onUpdate` via `approach`, which is
frame-rate independent (`1 - e^(-rate·dt)`, not a fixed `× 0.2` per frame). A
fixed per-frame lerp eases twice as fast at 120Hz as at 60Hz. `scene.test.ts`
pins this: one 16ms step must equal two 8ms steps.

**Coordinates go through the CTM.** `toSceneCoords` converts pointer positions
via `svg.getScreenCTM().inverse()`. The `<svg>` is sized `100%`, so the moment
its box is any size other than `width × height` the two coordinate systems
diverge and raw `clientX/Y` deltas drift away from the cursor.

## 5. The plugin seam

An external engine (Rive, Lottie, a Canvas draw, a WASM kernel) becomes a
first-class scene object by **subclassing `BaseObject`**:

```ts
class RiveNode extends BaseObject {
  constructor(private rive: RiveInstance, spec: BaseNodeSpec) {
    super(riveCanvasInForeignObject(rive), spec);
  }
  override onUpdate(dt: number, elapsed: number) {
    super.onUpdate(dt, elapsed);   // keep clock-driven presets working
    this.rive.advance(dt);         // the foreign engine gets OUR dt, not its own rAF
    this.rive.draw();
  }
}
scene.add(new RiveNode(instance, { x: 300, y: 200 }));
```

That is the entire adapter pattern. The critical move is turning the foreign
engine's own loop **off** and advancing it by the scene's `dt` — an engine
running its own rAF beside ours is the desync the clock exists to prevent.

**Canvas/WebGL layering**, when it lands, goes through `<foreignObject>`: a
`<foreignObject>` inside the transform `<g>`, with the `<canvas>` inside that.
The canvas then inherits the node's transform and its position in the paint
order automatically — no absolute positioning, no separate z-index stack, no
second coordinate system to keep in sync with the first.

**`<foreignObject>` layering is not built yet**, on purpose — nothing needs a
Canvas node. The mechanism is written down so it gets implemented rather than
invented under pressure.

### The one that is built: DiceBear

`src/plugins/dicebear.ts`, reached as `@t569/scene-engine/dicebear`. It is
**not** re-exported from `src/index.ts`, so importing `Scene` never pulls it in,
and it imports nothing from `@dicebear/*` — it takes an SVG **string**, so the
engine's `dependencies` stay empty and the host decides how the markup was made.

```ts
import { dicebearNode, dicebearOptions } from '@t569/scene-engine/dicebear';

const opts = dicebearOptions({ style: 'shapes', seed: userId }, { inScene: true });
const svg = new Avatar(style, opts).toString();      // host's DiceBear
scene.add(dicebearNode(svg, { x: 150, y: 150, width: 120, height: 120 }));
```

It is **thinner than the Rive sketch above**, and the difference is worth
understanding: DiceBear returns markup, not an engine with a loop. There is no
foreign rAF to switch off — only a decision about whose clock animates the
character, which is what `dicebearOptions({ inScene })` encodes.

DiceBear's animation is CSS keyframes baked into the SVG, running on the
browser's compositor clock. Inside a scene that is a *second* clock beside
`Scene.tick`, so `inScene: true` forces `animationVariant: 'none'` and the scene
owns all motion. Outside a scene — a plain `<img>` avatar — there is no clock to
conflict with and the embedded loop is exactly right. That is why the assistant
avatar goes through a scene and the user's avatar does not.

**The registry is still absent**, and correctly so: one plugin means there is
nothing to route between by name.

## 6. Deliberate absences

| Absent | Why | Add when |
|---|---|---|
| YAML parsing | `JSON.parse` is stdlib; YAML is a dependency plus a build step | someone hand-authors scenes and wants comments and no trailing-comma errors |
| Plugin registry | `scene.add()` already takes any `SceneNode`; the one plugin is a plain import | a second plugin exists and something must choose by name |
| `<foreignObject>` layering | designed above, not coded | a Canvas/WASM node exists |
| A generic `ExternalAssetNode` base | the DiceBear plugin (§5) needed no shared base, and one subclass is not a pattern | a second external engine shows what the two genuinely share |
| Dirty-flag transforms | a dozen `setAttribute`s per frame costs nothing | a profiler says otherwise |
| A tween/timeline DSL | `onUpdate(dt, elapsed)` plus `approach` covers what exists so far | a scene needs sequenced, seekable choreography |
| Image nodes | no scene needs one yet, though `assets` already accepts `kind: 'image'` | one does |
| Bring-to-front on drag | it would silently contradict "array order is z-order" | someone asks, and we decide what the JSON should say afterwards |

## 7. Roadmap

1. **Now** — core clock, SVG shapes, `draggable` / `hover_scale`, JSON parsing.
2. **Next** — whichever integration
   comes first; each one is expected to reveal a missing node type rather than a
   missing abstraction.
3. **Later, on evidence** — timeline/sequencing, the first real plugin, Canvas
   via `<foreignObject>`. In that order, and each only once something needs it.
