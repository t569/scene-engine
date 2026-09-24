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
}

export interface RectSpec extends BaseNodeSpec {
  type: 'rect';
  width: number;
  height: number;
  fill?: string;
  /** Corner radius. */
  rx?: number;
}

export interface CircleSpec extends BaseNodeSpec {
  type: 'circle';
  radius: number;
  fill?: string;
}

export interface TextSpec extends BaseNodeSpec {
  type: 'text';
  text: string;
  fill?: string;
  fontSize?: number;
  /** References an `AssetSpec` of kind `'font'` in the scene's `assets` block. */
  asset_id?: string;
}

/**
 * Discriminated on `type`. Adding a member here makes the `switch` in
 * `parse.ts` fail to compile until it is handled — which is the point.
 */
export type NodeSpec = RectSpec | CircleSpec | TextSpec;

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
