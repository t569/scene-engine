# Roadmap

Where this is going: **a small Manim/Blender for the web.** Manim for scenes that
explain mathematics, choreographed and seekable. Blender for the idea that a
scene is a document you can build, inspect and edit, not code you have to
write. The web part is the constraint that shapes both: it has to be light
enough to put on a blog page, and interactive, because a reader can do more with
a scene than watch it.

Manim and Blender describe the *authoring* ambition, not the only audience.
Advertising came first: campaign heroes whose animation is data on the campaign
record. It stays a first-class use, with characters, explanations and
generated pages beside it (see the README's "What it's for"). A feature that
serves the math scenes must not make an ad heavier, slower to load or harder
to theme.

The engine's own rule still holds: **add on evidence.** Every item below is
tied to a real scene that needs it, and lands when that scene is built.

## Now: 0.1 (extracted)

Clock, SVG shapes, `draggable` / `hover_scale`, JSON parsing, DiceBear plugin.

## Next: 0.2, the Manim layer

Driven by three scenes: an animated character (the Karlsefni assistant), a
Klein bottle you can orbit and scrub, and a gallery of math animations.

| Feature | Needed by | Shape |
|---|---|---|
| `character` plugin | animated assistant with emotions | `CharacterNode(render(emotion) → svg)`, one motion row per emotion, amplitudes eased |
| `path` / `polyline` nodes | every curve | schema + validator members |
| Seekable time | scroll-driven Klein bottle, scrubbers | `scene.seek(t)`, manual clock mode |
| `timeline` | choreographed explanations | pure function of `t`, so seeking is free: Manim's `play()` |
| 3D: `camera`, `surface3d`, `curve3d`, `orbit` preset | Klein bottle, surfaces | per-frame projection, depth sort, depth shading |
| `tex` plugin | labels with real mathematics | host supplies the renderer (KaTeX); engine wraps in `<foreignObject>` |

## Done: 0.3, the interactive layer

Brilliant-style figures as data: `params`, a safe expression language,
`bind`, `plot`, `slider`, `control` handles, live text templates and
`visible_when` goals. See ARCHITECTURE §9.

Still to come for interactives, on evidence: point-on-curve handles (drag
along a plotted curve, not just an axis), a `vector` node for fields, and a
`check` block that reports a goal met to the host (for progress/scoring).

## Done: 0.4, the graph plugin

A physical, Obsidian-style graph (`@t569/scene-engine/graph`), driven by a
blog's site index: pages and sections as stars, links and nearest-by-meaning
as lines. Not seekable — the one deliberate exception to the clock's rule.

## After that, on evidence

1. **Scenes as data, end to end.** Every node above expressible in `SceneSpec`,
   so a person *or a model* can author a simulation as JSON. The validator is
   the trust boundary that makes machine-authored scenes safe to mount.
2. **Canvas / WebGL nodes** via `<foreignObject>`, when an SVG scene measurably
   can't keep up (dense particle systems, large meshes).
3. **A visual editor page**: the Blender half. Select, move and key objects;
   what it saves is a `SceneSpec`. Built on the engine, not beside it.
4. **Export**: a scene to video/GIF via stepping `seek(t)` frame by frame,
   which is why seekable time comes first.

## Deliberately not planned

- A physics engine. Integrate in `onUpdate`; import one as a plugin if needed.
- A React wrapper in core. Mounting is three lines in a `useEffect`; see the README.
