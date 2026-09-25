/**
 * The whole contract, in one file — schema, scene, object.
 *
 * Two audiences share it: a human (or a backend, or a model) authoring a
 * `SceneSpec` as JSON, and a TypeScript caller driving the engine by hand.
 * Both must describe the same scene, so the schema types below ARE the
 * programmatic types. There is no second "internal" representation.
 */

/** A point in scene space — the `viewBox` coordinate system, not screen pixels. */
export interface Vec2 {
  x: number;
  y: number;
}

/**
 * Flat transforms and high-level interaction presets, shared by every node.
 *
 * Transforms are deliberately flat (`x`, `y`, `scale`, `rotation`) rather than
 * nested under a `transform: {}` key: the schema is meant to be legible to
 * non-programmers, and one level of nesting is one more thing to get wrong.
 */
export interface BaseNodeSpec {
  /** Optional handle for `scene.find(id)`. Not required, and not a React key. */
  id?: string;
  x?: number;
  y?: number;
  /** Uniform scale. 1 = natural size. */
  scale?: number;
  /** Degrees, clockwise, about the node's own origin. */
  rotation?: number;
  opacity?: number;

  /** Preset: pointer-drag the node around the scene. */
  draggable?: boolean;
  /** Preset: ease to this scale while hovered, ease back on leave. */
  hover_scale?: number;

  /**
   * Properties computed from expressions every frame, e.g.
   * `{ x: "300 + 60*a", rotation: "90*sin(t)" }`. Variables: the scene's
   * params, and `t` (seconds). See `expr.ts` for the language.
   */
  bind?: Partial<Record<AnimatableProp, string>>;

  /**
   * Show the node only while every condition holds — a "Correct!" that appears
   * when the answer is right, a step that appears when the last one is done.
   */
  visible_when?: VisibleWhen | VisibleWhen[];

  /**
   * Make the node a handle for params: its position *is* the param's value
   * (mapped onto `range`, in scene units), and dragging it sets the param.
   * The param's own min/max/step constrain the drag.
   */
  control?: { x?: ControlAxis; y?: ControlAxis };

  /**
   * Make the node a button: a click (or Enter/Space) sets these params. The
   * swatch, the tab, the "next step" — anything that picks rather than drags.
   */
  on_click?: { set: Record<string, number> };

  /**
   * Fill from a param: `palette[round(param)]`, clamped to the palette. How a
   * colour follows a choice, since params are numbers and colours are not.
   * Ignored by nodes without a fill of their own (plot, slider, tex, space3d).
   */
  fill_by?: FillBy;

  /**
   * Keyframed properties, as data. Each property gets its own list of segments;
   * the value at time `t` is a pure function of `t`, so `scene.seek(t)` lands
   * every animated node exactly where it would have been. See `timeline.ts`.
   */
  animate?: AnimateSpec;
}

/** Visible while `min ≤ expr ≤ max`. With neither bound: while `expr` is non-zero. */
export interface VisibleWhen {
  expr: string;
  min?: number;
  max?: number;
}

export interface FillBy {
  param: string;
  palette: string[];
}

/** One axis of a handle: which param, and where its min and max sit in scene units. */
export interface ControlAxis {
  param: string;
  range: [number, number];
}

/** The properties `animate` can drive. `draw` reveals a stroke from 0 to 1. */
export type AnimatableProp = 'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'draw';

/** Named easing curves. Names rather than functions so a spec stays JSON. */
export type EaseName =
  | 'smooth'
  | 'linear'
  | 'step'
  | 'in'
  | 'out'
  | 'inOut'
  | 'outBack'
  | 'inOutSine'
  | 'rushInto'
  | 'rushFrom'
  | 'thereAndBack'
  | 'wiggle';

/**
 * One move: from wherever the property is at `at` (or `from`, if given), to
 * `to`, over `dur` seconds.
 */
export interface Segment {
  at: number;
  dur: number;
  to: number;
  from?: number;
  ease?: EaseName;
}

export type AnimateSpec = Partial<Record<AnimatableProp, Segment[]>> & {
  /**
   * Repeat every `loop` seconds: the clock seen by the segments wraps. The
   * shape an ad or a banner wants, and why it is a number, not a boolean — the
   * period is part of the choreography.
   */
  loop?: number;
};

/** Stroke styling shared by everything that has an outline. */
export interface StrokeSpec {
  stroke?: string;
  strokeWidth?: number;
  /**
   * Initial stroke reveal, 0–1. Setting it (here or in `animate`) is what makes
   * a node drawable — it is normalised to `pathLength="1"` at build time.
   */
  draw?: number;
}

export interface RectSpec extends BaseNodeSpec, StrokeSpec {
  type: 'rect';
  width: number;
  height: number;
  fill?: string;
  /** Corner radius. */
  rx?: number;
}

export interface CircleSpec extends BaseNodeSpec, StrokeSpec {
  type: 'circle';
  radius: number;
  fill?: string;
}

export interface TextSpec extends BaseNodeSpec {
  type: 'text';
  /** Literal, or a template with `{expr}` / `{expr:digits}` holes that update live. */
  text: string;
  fill?: string;
  fontSize?: number;
  /** References an `AssetSpec` of kind `'font'` in the scene's `assets` block. */
  asset_id?: string;
}

/** Raw SVG path data. `fill` defaults to none: a path is usually a line. */
export interface PathSpec extends BaseNodeSpec, StrokeSpec {
  type: 'path';
  d: string;
  fill?: string;
}

/** Points joined by straight segments, in the node's own coordinates. */
export interface PolylineSpec extends BaseNodeSpec, StrokeSpec {
  type: 'polyline';
  points: Array<[number, number]>;
  /** Join the last point back to the first. */
  closed?: boolean;
  fill?: string;
}

/**
 * Typeset mathematics. Rendered by a function the host passes to `parseScene`
 * (`renderTex`, e.g. KaTeX's `renderToString`), so the engine stays dependency-free.
 */
export interface TexSpec extends BaseNodeSpec {
  type: 'tex';
  tex: string;
  /** Box the formula is laid out in, in scene units. */
  width: number;
  height: number;
  color?: string;
  fontSize?: number;
}

/** One thing in a 3D space, named rather than written as a formula — see `space.ts`. */
export interface Space3DItemSpec {
  /** A built-in surface (`klein8`, `torus`, …) or curve (`helix`, `torusKnot`, …). */
  shape: string;
  params?: Record<string, number>;
  /** Grid resolution: [u steps, v steps] for a surface, [samples] for a curve. */
  steps?: number[];
  stroke?: string;
  fill?: string;
  /** 0–1: how opaque the nearest face is; farther faces fade. Surfaces only. */
  fillOpacity?: number;
  strokeWidth?: number;
}

export interface Space3DSpec extends BaseNodeSpec {
  type: 'space3d';
  camera?: CameraSpec;
  /** Preset: drag to turn the camera. */
  orbit?: boolean;
  /** Radians per second of yaw, for an idle turntable. */
  spin?: number;
  items: Space3DItemSpec[];
}

export interface CameraSpec {
  /** Radians about the vertical axis. */
  yaw?: number;
  /** Radians of tilt toward the viewer. */
  pitch?: number;
  /** Model units → scene units. */
  zoom?: number;
  /** Distance to the eye, in model units. Omit for orthographic. */
  distance?: number;
}

/**
 * Discriminated on `type`. Adding a member here makes the `switch` in
 * `parse.ts` fail to compile until it is handled — which is the point.
 */
/**
 * y = f(x), drawn live. `expr` may use `x`, `t` and the scene's params, and is
 * re-plotted whenever a param changes. The box is centred on the node's x, y.
 */
export interface PlotSpec extends BaseNodeSpec {
  type: 'plot';
  expr: string;
  domain: [number, number];
  range: [number, number];
  width: number;
  height: number;
  samples?: number;
  stroke?: string;
  strokeWidth?: number;
  /** Frame and axes; default true. */
  axes?: boolean;
  axisColor?: string;
}

/** A slider inside the scene, bound to a param. `label` may be a template: `"a = {a:2}"`. */
export interface SliderSpec extends BaseNodeSpec {
  type: 'slider';
  param: string;
  width: number;
  label?: string;
  color?: string;
  track?: string;
  textColor?: string;
}

export type NodeSpec =
  | RectSpec
  | CircleSpec
  | TextSpec
  | PathSpec
  | PolylineSpec
  | TexSpec
  | Space3DSpec
  | PlotSpec
  | SliderSpec;

/**
 * Heavy things are declared once, up here, and referenced by `asset_id` from
 * the objects below — so the same font isn't re-declared on forty text nodes.
 */
export interface AssetSpec {
  id: string;
  kind: 'font' | 'image';
  src: string;
  /** For `kind: 'font'` — the `font-family` name to register `src` under. */
  family?: string;
}

export interface SceneSpec {
  width: number;
  height: number;
  background?: string;
  /**
   * Named knobs — `{ a: { value: 1, min: 0, max: 5, step: 0.1 } }`. Read by
   * `bind`, `plot`, text templates and `visible_when`; written by `slider`
   * nodes and `control` handles. What makes a scene interactive.
   */
  params?: Record<string, import('./params.ts').ParamSpec>;
  assets?: AssetSpec[];
  /**
   * Render order is array order, strictly. Later entries paint over earlier
   * ones. There is no `z` property and there will not be one: the array IS
   * the z-order, and it is implemented by DOM append order (see `Scene.add`).
   */
  objects: NodeSpec[];
}

/**
 * Lifecycle hooks. All optional, all called by the scene's single clock —
 * never by the object itself, and never from a timer of its own.
 *
 * `onUpdate` is the seam a plugin uses to advance a foreign engine (Rive,
 * Lottie, a Canvas draw) by exactly the same `dt` the native nodes got. That
 * is the entire reason the clock is centralised.
 */
export interface Lifecycle {
  /** Called once, when the object is added to a scene. */
  onMount?(scene: SceneLike): void;
  /**
   * @param dt      seconds since the previous frame, already clamped
   * @param elapsed seconds since the scene started
   */
  onUpdate?(dt: number, elapsed: number): void;
  /** Called on `scene.remove(obj)` or `scene.destroy()`. Detach listeners here. */
  onDestroy?(): void;
}

/**
 * What an object is allowed to know about its scene. Narrower than `Scene` on
 * purpose: objects need the surface to do coordinate math, nothing more. They
 * must not start, stop or re-order the scene that owns them.
 */
export interface SceneLike {
  readonly svg: SVGSVGElement;
  readonly width: number;
  readonly height: number;
  /** The scene's knobs. Empty unless the spec (or code) declared some. */
  readonly params: import('./params.ts').Params;
  /** True while the clock runs. A stopped scene only repaints when told to. */
  readonly playing: boolean;
  /** Scene time in seconds — what `t` is in expressions. */
  readonly elapsed: number;
}

/**
 * What the clock needs from a thing in order to drive it. `BaseObject`
 * implements it; so must any plugin node. Kept structural rather than
 * `extends BaseObject` so a plugin can wrap a foreign instance however it
 * likes, as long as it hands the scene one `<g>` and a way to transform it.
 */
export interface SceneNode extends Lifecycle {
  /** The transform group the scene appends. Paint order = append order. */
  readonly el: SVGGElement;
  /** Write the node's current spatial state onto `el`. Called every frame. */
  applyTransform(): void;
}
