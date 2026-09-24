# Roadmap

Where this is going: **a small Manim/Blender for the web.** Manim for scenes that
explain mathematics, choreographed and seekable. Blender for the idea that a
scene is a document you can build, inspect and edit, not code you have to
write. The web part is the constraint that shapes both: it has to be light
enough to put on a blog page, and interactive, because a reader can do more with
a scene than watch it.

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
