# Changelog

## 0.1.0 — extracted

First release as a standalone repository, extracted from [Quickuder](https://quickuder-1.onrender.com/)'s
shopping assistant avatar and campaign heroes.

- `Scene`: one `requestAnimationFrame` clock, clamped deltas, paint order = array order.
- `BaseObject` with `rect` / `circle` / `text` shapes; `approach()` easing.
- Presets: `draggable`, `hover_scale`.
- `parseScene` / `validateSceneSpec`: JSON in, running scene out, with path-named errors.
- Plugin: `@t569/scene-engine/dicebear`.
