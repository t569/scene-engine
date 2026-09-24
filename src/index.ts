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
  path,
  polyline,
  rect,
  text,
  toSceneCoords,
} from './objects.js';
export { createObject, type BuildOptions } from './factory.js';
export { parseScene, validateSceneSpec, SceneSpecError, LIMITS } from './parse.js';
export { EASES, ANIMATABLE, compileAnimate, sampleSegments, localTime, type AnimatedValues } from './timeline.js';
export {
  Space3D,
  SHAPES,
  DEFAULT_CAMERA,
  project,
  itemFromSpec,
  buildPrimitives,
  bandByDepth,
  toPathData,
  type Camera,
  type CurveItem,
  type Primitive,
  type Space3DOptions,
  type SpaceItem,
  type SurfaceItem,
  type Vec3,
} from './space.js';
export { texElement, type TexBox, type TexRenderer } from './tex.js';

export type {
  AnimatableProp,
  AnimateSpec,
  AssetSpec,
  BaseNodeSpec,
  CameraSpec,
  CircleSpec,
  EaseName,
  Lifecycle,
  NodeSpec,
  PathSpec,
  PolylineSpec,
  RectSpec,
  SceneLike,
  SceneNode,
  SceneSpec,
  Segment,
  Space3DItemSpec,
  Space3DSpec,
  StrokeSpec,
  TexSpec,
  TextSpec,
  Vec2,
} from './types.js';
