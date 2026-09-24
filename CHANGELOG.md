# Changelog

## 0.1.0 — extracted

First release as a standalone repository. Extracted unchanged from Quickuder,
where it was written and used for the shopping assistant's avatar and campaign
heroes. Scope renamed `@quickuder/scene-engine` → `@t569/scene-engine`.

- `Scene`: one `requestAnimationFrame` clock, clamped deltas, paint order = array order.
- `BaseObject` with `rect` / `circle` / `text` shapes; `approach()` easing.
- Presets: `draggable`, `hover_scale`.
- `parseScene` / `validateSceneSpec`: JSON in, running scene out, with path-named errors.
- Plugin: `@t569/scene-engine/dicebear`.
