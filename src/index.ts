/**
 * Public surface of `@t569/scene-engine`.
 *
 * Two ways in, same types behind both: hand a `SceneSpec` to `parseScene`, or
 * build `BaseObject`s yourself and `scene.add` them. Nothing else is exported —
 * if something here isn't enough to do the job, that is a gap in the design,
 * not a reason to reach into `src/`.
 */
export { Scene, clampDelta, MAX_DELTA, SVG_NS } from './scene.ts';
export {
  BaseObject,
  applyPresets,
  approach,
  capturePointer,
  circle,
  path,
  polyline,
  rect,
  text,
  toSceneCoords,
} from './objects.ts';
export { createObject, type BuildOptions } from './factory.ts';
export { parseScene, validateSceneSpec, SceneSpecError, LIMITS } from './parse.ts';
export { EASES, ANIMATABLE, compileAnimate, sampleSegments, localTime, type AnimatedValues } from './timeline.ts';
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
} from './space.ts';
export { texElement, type TexBox, type TexRenderer } from './tex.ts';

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
} from './types.ts';

/* The interactive layer (0.3): params, a safe expression language, live nodes. */
export { compile, compileTemplate, isTemplate, isReservedName, ExprError, EXPR_LIMITS, type Compiled, type Env } from './expr.ts';
export { Params, type ParamSpec } from './params.ts';
export {
  PlotNode,
  SliderNode,
  TemplateText,
  plotPath,
  sliderValueAt,
  type PlotBox,
  type PlotOptions,
  type SliderOptions,
} from './interactive.ts';
export type { ControlAxis, PlotSpec, SliderSpec, VisibleWhen } from './types.ts';
