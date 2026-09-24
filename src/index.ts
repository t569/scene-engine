/**
 * Public surface of `@t569/scene-engine`.
 *
 * Two ways in, same types behind both: hand a `SceneSpec` to `parseScene`, or
 * build `BaseObject`s yourself and `scene.add` them. Nothing else is exported —
 * if something here isn't enough to do the job, that is a gap in the design,
 * not a reason to reach into `src/`.
 */
export { Scene, clampDelta, MAX_DELTA, SVG_NS } from './scene.js';
export {
  BaseObject,
  applyPresets,
  approach,
  circle,
  createObject,
  rect,
  text,
  toSceneCoords,
} from './objects.js';
export { parseScene, validateSceneSpec, SceneSpecError } from './parse.js';

export type {
  AssetSpec,
  BaseNodeSpec,
  CircleSpec,
  Lifecycle,
  NodeSpec,
  RectSpec,
  SceneLike,
  SceneNode,
  SceneSpec,
  TextSpec,
  Vec2,
} from './types.js';
