> **History.** Written while the engine lived inside Quickuder; kept as the record of why it exists. Paths like `frontend-react/…` refer to that repo.

# Scene Engine — original brief

The prompt that started `scene-engine/`, kept verbatim, followed by what was
actually built and what was deliberately left out. Same role as
`PAYMENT.md` and `BACKEND_SECURITY.md` in this folder: the ask, preserved, so a
later reader can tell a gap from a decision.

---

## The brief, as given

**Act as an Expert Graphics Systems Architect and Frontend Engineer.**

I am building a lightweight, frontend-first rendering library designed to generate interactive scenes, widgets, and animations for the web. The mental model is similar to Manim or Blender, but optimized for the browser to create standalone, interactive web artifacts (similar to z.ai or v0).

Please review the architectural constraints and deliverables below, and generate the foundational codebase for this engine.

### 1. Engine & Architecture Constraints
* **Frontend-First & Zero Latency:** State management and the render loop live entirely on the client side. No backend rendering.
* **Hybrid Rendering Pipeline:** The default renderer is **SVG-based**. For heavy compute or CAD-like rendering (Canvas/WebGL/WASM), implement a layering mechanism that utilizes an SVG `<foreignObject>` tag. This allows Canvas/external nodes to obey the SVG's spatial bounds and Z-index naturally without absolute positioning nightmares.
* **The Clock Master:** The core `Scene` manages a single `requestAnimationFrame` (rAF) loop. All objects, including external plugins, must sync to this master clock via an `onUpdate(deltaTime)` hook to prevent tearing and desynchronization.

### 2. Developer Experience (DX) & Schema
* **Declarative Schema (YAML/JSON):** Non-programmers will configure scenes using a flat, intuitive schema. Key features:
  * *Implicit Z-Index:* Render order is strictly dictated by the array order.
  * *Asset Registry:* Heavy assets (fonts, .riv files) are declared in an `assets` block and referenced by `asset_id` in the `objects` block.
  * *High-Level Presets:* Complex interactions are abstracted into simple flags (e.g., `draggable: true`, `hover_scale: 1.1`).
  * *Flat Transforms:* `x`, `y`, `scale`, and `rotation` are top-level properties.
* **Programmatic API:** A robust TypeScript API (using discriminated unions for config parsing) for advanced users to manually chain animations or build custom components.

### 3. Plugin & Adapter System
* External rendering engines (like Rive or Lottie) must be treated as native objects via an **Adapter Pattern**.
* An `ExternalAssetNode` (extending `BaseObject`) must wrap the third-party instance, intercept the engine's `onUpdate`, and manually advance the external animation to sync with the main Scene clock.
* Provide a plugin registry (e.g., `Core.registerPlugin('rive', RivePlugin)`) so parsers are strictly opt-in to keep the core library minimal.

### 4. Required Deliverables

Please provide the following:

**A. Architectural Blueprint & Directory Structure**
Outline the module structure (Core, Renderers, Parsers, Inputs, Plugins).

**B. Core TypeScript Interfaces & Types**
Write the specific TS contracts for:
1. The JSON/YAML schema structure (using discriminated unions for different object types).
2. `Scene` (state manager, rAF loop handler).
3. `BaseObject` (spatial properties, lifecycle hooks like `onMount`, `onUpdate`).

**C. Core Render Loop & Clock Implementation**
Write the actual implementation for the `Scene` class, specifically focusing on how the `requestAnimationFrame` loop iterates over objects and manages `deltaTime`.

**D. Mini Proof-of-Concept (PoC)**
Write a functional Vanilla TS implementation that demonstrates:
1. Instantiating the `Scene`.
2. A parser taking a small JSON config containing one native shape (with `draggable: true`).
3. The engine successfully rendering the SVG element and applying the drag interaction automatically based on the preset.

---

## What was built

All four deliverables, in `scene-engine/`:

| Deliverable | Where |
|---|---|
| A — blueprint & structure | `scene-engine/specifications_and_architecture.md` §2 |
| B — schema, `Scene`, `BaseObject` contracts | `scene-engine/src/types.ts` |
| C — rAF loop and `deltaTime` | `scene-engine/src/scene.ts` |
| D — PoC | `scene-engine/demo.html` + `src/parse.ts` |

Confirmed in a real browser, not just by build: drag stays pixel-exact under a
0.5× CTM scale, `hover_scale` eases over several frames and freezes when
`scene.stop()` is called (proving it runs on the clock, not a CSS transition),
and paint order follows array order with no `z-index` anywhere.

## What was deliberately not built

Everything below is a decision, not an oversight. The engine's whole selling
point is being lightweight; the fastest way to lose that is to build the
extension points before anything extends them.

| Brief asked for | Decision | Add it when |
|---|---|---|
| YAML **and** JSON | JSON only — `JSON.parse` is stdlib, YAML is a dependency and a build step | a non-programmer actually hand-authors a scene file and complains about commas |
| `Core.registerPlugin('rive', …)` registry | Skipped. `scene.add(obj)` already accepts any `SceneNode`, so a plugin is an import away without a registry to route through | there are two plugins and something has to pick between them by name |
| `<foreignObject>` Canvas/WebGL layering | Designed in the spec, not coded | a Canvas or WASM node actually exists to put inside it |
| `ExternalAssetNode` adapter class | Not written — `BaseObject.onUpdate(dt)` **is** the adapter seam, and the class would be an empty subclass until a real engine is wired | Rive or Lottie is genuinely being integrated |
| Dirty-flag transform tracking | Skipped; the transform is written every frame | a profiler says the `setAttribute` calls cost something |

Each of these is marked with a `ponytail:` comment at the seam it affects, so the
decision is visible from the code rather than only from this file.

### One more thing worth knowing

`frontend-react` already depends on `motion@12`, which does drag, hover-scale and
springs perfectly well **inside React**. This engine is not a replacement for it
and should not be used where a React component would do. It earns its existence
in two places `motion` cannot reach: standalone non-React artifacts, and one
clock driving a third-party engine frame-for-frame alongside native nodes. See
`docs/scene-engine-architecture.md`.
