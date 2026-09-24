> **History.** Written while the engine lived inside Quickuder; kept as the record of why it exists. Paths like `frontend-react/…` refer to that repo.

# The Scene Engine: why it's here and what it plugs into

`scene-engine/` is a rendering library in an e-commerce repo, which needs
explaining. This document is the *why* and the *where it goes*. For the
package's own design contract — schema, clock invariants, plugin seam — read
[`../ARCHITECTURE.md`](../ARCHITECTURE.md).

## 1. First, the honest objection

`frontend-react` already depends on `motion@12`. It does drag, hover-scale,
springs and layout animation, well, today, with no new code. **Inside React, use
it.** If a component needs a draggable card, this engine is the wrong answer.

The engine covers two things `motion` structurally cannot:

- **Rendering with no React at all** — a standalone artifact, an `<svg>` dropped
  into an email preview, a scene rendered from a JSON blob that arrived over the
  wire. `motion` is a React library; a `SceneSpec` is data.
- **One clock across foreign engines** — advancing a Rive or Lottie or Canvas
  instance by the *same* `dt`, in the *same* pass, as the shapes beside it. Two
  independent rAF loops drift, and the drift is visible.

Everything below is one of those two. Nothing below is "we could animate this
nicely" — that is what `motion` is for.

## 2. Three places it plugs in

**Two of the three are now wired.** §2.1 and §2.2 shipped together with the
avatar work; §2.3 is still ahead. As predicted, neither revealed a missing
abstraction — §2.1 needed no new code in the engine at all, and §2.2 needed one
plugin that turned out to be forty lines.

### 2.1 Promo and flash-sale heroes — *done*

`PromotionTheme.animationStyle` in `frontend-react/src/types/data.d.ts:141`:

```ts
animationStyle: 'confetti' | 'slide-up' | 'neon-glow';
```

The backend seeds it (`backend/api/management/commands/populate_products.py:247,260`).
The frontend **reads it nowhere**. It is a promise that never shipped, and the
shape of it is the problem: a closed enum means every new campaign animation
needs a new union member, a new branch in `PromoPage.tsx`, and a frontend deploy
before marketing can use it.

A `SceneSpec` on the promotion record replaces the enum with an open format:
the campaign carries its own hero, the frontend renders whatever arrived, and
"we want a different animation this week" stops being a code change. The
existing `theme.primaryColor` / `variant` fields feed straight into the spec's
`fill` and `background`.

**How it shipped.** `theme.scene` holds a `SceneSpec`;
`backend/api/management/commands/populate_products.py` seeds one per campaign via
`_hero_scene()`, and `PromoPage` renders it through
`components/ui/SceneCanvas.tsx`, falling back to `heroImageUrl` when it is absent
or invalid. Because `theme` is a `JSONField` serialized wholesale, this needed
**no migration, no serializer change and no new endpoint** — the total backend
diff is seed data.

`animationStyle` is now marked `@deprecated` rather than deleted: removing it is
a separate, checkable change once every campaign carries a scene.

### 2.2 The assistant avatar — *done*

`ai-assistant/src/components/Avatar.tsx` renders an empty `<div>` and says so:

> The avatar's own rendering is just a deterministic state→className mapping.
> The actual sprite/animation/model per `avatarStyle`+`AvatarStatus` combination
> is the host's CSS/Lottie/whatever to attach via these class and
> data-attribute hooks.

That "whatever" is this engine's slot. `AvatarStatus` (`idle`, `thinking`,
`awaiting_approval`, `syncing`, `error`, `escalated`) is already a clean state
machine; a scene per status, or one scene whose objects read the status, drops
straight in.

**How it shipped.** `frontend-react/src/ai-assistant/AssistantAvatarScene.tsx`
holds a `MOTION` table with one row per `AvatarStatus`, mirroring the one in
`stateMachine.ts` whose descriptions are its brief. Amplitudes are eased toward
their targets rather than jumped to, so a status change cross-fades between
gestures instead of cutting one off mid-sine.

This is where the plugin seam earned its keep — though not the way the spec
guessed. The prediction was a Rive-style engine whose own loop had to be taken
over. DiceBear turned out to return *markup*, so there was no foreign loop at
all, only a decision about whose clock animates it: `dicebearOptions({ inScene })`
forces `animationVariant: 'none'` inside a scene. The generic
`ExternalAssetNode` base was therefore **not** built — one subclass is not a
pattern — and the registry stayed absent, because one plugin is just an import.

The boundary holds in both directions: `ai-assistant/` imports no host code, and
this engine imports no React, so the wiring lives in
`frontend-react/src/ai-assistant/` where the other host glue already is.

### 2.3 Standalone AI artifacts — *still ahead*

`ai-backend/` already streams structured JSON to the widget. A `SceneSpec` is
just another payload shape: the model describes a scene, the client renders it,
nothing round-trips. A size chart, an outfit diagram, a delivery-route sketch, a
"here's how these three jackets compare" widget — all data, all client-rendered,
all zero-latency after the JSON lands.

This is the case with no React in it at all, and the one that generalises past
this repo: the same engine renders the same spec in a standalone page, an
embedded widget, or another product entirely. Which is also why
`validateSceneSpec` is thorough — a model-authored spec is exactly the input
that will be malformed, and a named error beats a blank rectangle.

## 3. One frame, end to end

```
requestAnimationFrame
  └─ Scene.tick(now)
       ├─ dt = clampDelta(now - last)        seconds, capped at 100ms
       ├─ elapsed += dt                      animation time, not wall clock
       └─ for each node, in array order:
            ├─ node.onUpdate(dt, elapsed)    ← the only seam plugins get
            │    ├─ BaseObject: eases scale toward scaleTarget (approach)
            │    └─ a plugin node would advance its foreign engine by THIS dt
            └─ node.applyTransform()         writes transform + opacity onto <g>
  └─ browser paints, in DOM order = array order = z-order
```

Pointer input sits outside the loop and only ever writes state: `draggable`
converts screen coordinates through `getScreenCTM().inverse()` and sets `x`/`y`;
`hover_scale` sets `scaleTarget` and nothing else. Neither touches the DOM
directly. Every visible change goes through the frame above — which is why
`scene.stop()` genuinely freezes everything, including a half-finished hover.

## 4. Deliberate absences

Full table in the package spec (§6). The load-bearing ones:

- **No YAML.** `JSON.parse` is stdlib.
- **No plugin registry and no `ExternalAssetNode` base.** There is exactly one
  plugin (DiceBear) and it is a plain import, so a lookup table would have one
  entry and a shared base class would have one subclass.
- **No `<foreignObject>` Canvas layering yet.** The mechanism is designed in the
  spec so it gets implemented rather than invented, but nothing needs it.
- **No timeline/tween DSL.** `onUpdate(dt, elapsed)` plus `approach` covers what
  exists.

## 5. When it misbehaves

- **Everything teleports after switching tabs.** `clampDelta` is being bypassed,
  or something integrates against wall-clock time instead of the `dt` it was
  given. Objects must never read `performance.now()` themselves.
- **Drag drifts away from the cursor.** Something is using raw `clientX/clientY`
  instead of `toSceneCoords`. It looks fine only while the `<svg>`'s CSS box
  happens to equal its `viewBox`; resize the window and it breaks.
- **A hover snaps instead of easing, or eases at different speeds on different
  machines.** `approach` was replaced with a fixed per-frame lerp. The
  frame-rate-independence assert in `scene.test.ts` exists to catch exactly this.
- **A subclass's presets stopped working.** It overrode `onUpdate` without
  calling `super.onUpdate(dt, elapsed)`.
- **A plugin's animation stutters against the SVG beside it.** The foreign
  engine is still running its own rAF. Turn its loop off and advance it from
  `onUpdate`.
- **An avatar judders or double-animates.** A DiceBear character was put in a
  scene without `animationVariant: 'none'`, so its embedded CSS keyframes are
  running on the compositor clock while `Scene.tick` also transforms it. Go
  through `dicebearOptions({ inScene: true })`, which is the one place that
  decision is made.
- **A campaign hero is blank.** `SceneCanvas` caught an invalid spec and fell
  back; the console carries the offending path from `validateSceneSpec`.
- **Stacking order is wrong.** Reorder the `objects` array. There is no `z`
  property, and adding one would give the JSON and the screen a way to disagree.
