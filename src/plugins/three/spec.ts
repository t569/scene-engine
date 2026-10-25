/**
 * `scene3d`: a 3D scene as data.
 *
 * The same promise the 2D schema makes: a person, a backend or a model can
 * write a product viewer as JSON, and `validateSceneSpec` makes it safe to
 * mount. Everything with a cost that grows with a number is capped; URLs go
 * through the host's `resolveAsset` (default: same origin only); expressions
 * are the core's whitelisted language, reading the scene's params. So a 2D
 * swatch (`on_click`) or slider can drive a 3D colour, variant or rotation.
 */
import type { BaseNodeSpec, FillBy, VisibleWhen } from '../../types.ts';
import type { SpecContext } from '../../registry.ts';
import type { Quality, ShadowMode } from './node.ts';

export type Vec3 = [number, number, number];

export interface Material3D {
  color?: string;
  /** Colour from a param: `palette[round(param)]`, like 2D `fill_by`. */
  color_by?: FillBy;
  roughness?: number;
  metalness?: number;
  emissive?: string;
  emissiveIntensity?: number;
  opacity?: number;
  clearcoat?: number;
  /** Glass-like see-through, 0–1. Costs an extra render pass; use sparingly. */
  transmission?: number;
  flatShading?: boolean;
  side?: 'front' | 'back' | 'double';
}

interface Object3DBase {
  id?: string;
  position?: Vec3;
  /** Degrees, applied X, Y, Z. */
  rotation?: Vec3;
  scale?: number | Vec3;
  castShadow?: boolean;
  receiveShadow?: boolean;
  /** Properties from expressions: `position.x|y|z`, `rotation.x|y|z` (degrees), `scale`. */
  bind?: Partial<Record<ObjectBindKey, string>>;
  visible_when?: VisibleWhen | VisibleWhen[];
  /** Clicking the object sets params, like 2D `on_click`. */
  on_click?: { set: Record<string, number> };
  /** While the pointer is over the object these params take these values; on leave they go back. */
  on_hover?: { set: Record<string, number> };
}

export interface ModelObject extends Object3DBase {
  type: 'model';
  /** glTF / .glb URL. Resolved through the host's `resolveAsset`; same-origin only by default. */
  src: string;
  /** Scale the model so this dimension (see `fitAxis`) is `fit` units. */
  fit?: number;
  fitAxis?: 'max' | 'width' | 'height' | 'depth';
  /** Centre it on x/z and stand it on y = 0. Default true. */
  center?: boolean;
  /** A KHR_materials_variants name. */
  variant?: string;
  /** Variant from a param: `variants[round(param)]`. */
  variant_by?: { param: string; variants: string[] };
  /** Play an animation clip (by name), or the first one with `true`. */
  animation?: string | boolean;
  /**
   * Drive named nodes inside the model (a wheel, a lid's hinge, a phone's layers). `bind` values are
   * offsets from the part's own rest pose, so `"position.y": "explode * 0.4"` lifts a layer from where
   * the artist left it. `material` replaces the part's materials (a livery colour from a param).
   */
  parts?: Record<string, PartSpec>;
}

export interface PartSpec {
  bind?: Partial<Record<ObjectBindKey, string>>;
  visible_when?: VisibleWhen | VisibleWhen[];
  material?: Material3D;
}

export interface BoxObject extends Object3DBase {
  type: 'box';
  size: Vec3;
  /** Rounded edges, in units. */
  radius?: number;
  material?: Material3D;
}
export interface SphereObject extends Object3DBase {
  type: 'sphere';
  radius: number;
  segments?: number;
  material?: Material3D;
}
export interface CylinderObject extends Object3DBase {
  type: 'cylinder';
  radiusTop: number;
  radiusBottom: number;
  height: number;
  segments?: number;
  material?: Material3D;
}
export interface PlaneObject extends Object3DBase {
  type: 'plane';
  size: [number, number];
  material?: Material3D;
}
export interface TorusObject extends Object3DBase {
  type: 'torus';
  radius: number;
  tube: number;
  material?: Material3D;
}
export interface GroupObject extends Object3DBase {
  type: 'group';
  children: Object3DSpec[];
  /**
   * Merge children that share a material into one draw call each. For static
   * detail (a chip's pins, a shelf of books): much faster on integrated GPUs.
   * Children with bind, visible_when, on_click or color_by are left alone.
   */
  merge?: boolean;
}

/**
 * A drifting cloud of glowing points: dust round a product, a galaxy behind a headline.
 * Each point circles the y axis on its own ring, inner rings faster, with a slow bob. The
 * motion is a pure function of time, worked out on the GPU, so it costs no CPU per frame
 * and seeks like everything else. Never casts shadows.
 */
export interface ParticlesObject extends Object3DBase {
  type: 'particles';
  count: number;
  /** Outer radius of the cloud. */
  radius: number;
  /** `disc` (default): a flat galaxy. `shell`: a sphere of dust. */
  shape?: 'disc' | 'shell';
  /** Point size in world units. Default 0.04. */
  size?: number;
  /** Radians per second at the rim. Default 0.25. */
  speed?: number;
  /** Each point takes one of these. Default white. */
  colors?: string[];
}

/**
 * Many copies of one small shape in one draw call: grains in a heap, seeds on a board, spices
 * raining down. Placed from a seed, so the same spec gives the same heap on every load. With
 * `fall`, each copy drops and tumbles through `height` and comes round again: worked out on the GPU
 * from the clock alone, so it seeks and costs no CPU per frame (and casts no shadow while falling).
 */
export interface InstancesObject extends Object3DBase {
  type: 'instances';
  count: number;
  /** One grain: `sphere` (squash it with `size`), `box`, `cylinder` (a thread, a stick). */
  shape: 'sphere' | 'box' | 'cylinder';
  /** One grain's size, x y z. */
  size: Vec3;
  /** Each grain's size varies by up to this fraction. Default 0.3. */
  jitter?: number;
  /**
   * Where they go. `heap`: a mound (`radius` across, `height` high at the middle). `disc`: flat,
   * `radius`. `box`: anywhere in `size`. Grains lie at random angles in all three.
   */
  scatter: { shape: 'heap' | 'disc' | 'box'; radius?: number; height?: number; size?: Vec3 };
  /** Drop through `height` units at `speed` units/s, tumbling `spin` turns/s. */
  fall?: { height: number; speed?: number; spin?: number };
  seed?: number;
  /** Each grain takes one of these (multiplied with the material colour). */
  colors?: string[];
  material?: Material3D;
}

export type Object3DSpec = ModelObject | BoxObject | SphereObject | CylinderObject | PlaneObject | TorusObject | ParticlesObject | InstancesObject | GroupObject;

export interface Light3D {
  type: 'directional' | 'point' | 'spot' | 'ambient' | 'hemisphere';
  id?: string;
  color?: string;
  intensity?: number;
  position?: Vec3;
  target?: Vec3;
  castShadow?: boolean;
  /** Point and spot: where the light fades to nothing (0 = never). */
  distance?: number;
  /** Spot: cone half-angle in degrees. */
  angle?: number;
  penumbra?: number;
  /** Hemisphere: the colour from below. */
  groundColor?: string;
  bind?: Partial<Record<LightBindKey, string>>;
  visible_when?: VisibleWhen | VisibleWhen[];
}

export interface Scene3DSpec extends BaseNodeSpec {
  type: 'scene3d';
  width: number;
  height: number;
  camera?: {
    position?: Vec3;
    target?: Vec3;
    fov?: number;
    /** From expressions, e.g. a `scroll` param the host sets: `position.*`, `target.*`, `fov`. */
    bind?: Partial<Record<CameraBindKey, string>>;
    /**
     * A flight: the camera rides a smooth curve through `points`, at `along` (an expression, 0–1),
     * looking along `target` (a curve too) or at `camera.target`. Point k of n is reached at
     * `along = k / (n - 1)`, however far apart the points are. Binds apply on top. Turns `orbit` off.
     */
    path?: { points: Vec3[]; target?: Vec3[]; along: string };
  };
  /** Drag to orbit (default true), or the details. Angles in degrees. */
  orbit?:
    | boolean
    | { autoRotate?: number; minDistance?: number; maxDistance?: number; minPolarAngle?: number; maxPolarAngle?: number; pan?: boolean; zoom?: boolean };
  /**
   * Soft studio lighting from an environment map. Default `studio`, intensity 1. `src`: an
   * equirectangular .hdr instead (loaded through `resolveAsset`; the preset lights until it lands);
   * `background` shows it behind the scene, softened by `blur` (0–1); `rotation` turns it, degrees.
   */
  environment?: { preset?: 'studio' | 'none'; src?: string; intensity?: number; background?: boolean; blur?: number; rotation?: number };
  /** Distance fog: things fade into `color` from `near` to `far`. */
  fog?: { color: string; near?: number; far: number };
  /** Tone mapping exposure. Default 1. */
  exposure?: number;
  /** Grain, vignette and colour fringes after tone mapping; see `ThreeOptions.finish`. */
  finish?: { grain?: number; vignette?: number; aberration?: number };
  /** Clear colour behind the 3D content. Default transparent. */
  background?: string;
  shadows?: ShadowMode;
  /** Glow: anything brighter than `threshold` (0–1) bleeds light. Code loads only when set. */
  bloom?: { strength?: number; radius?: number; threshold?: number };
  /** An invisible floor that shows only shadows. `false` for none. */
  floor?: false | { shadow?: number; size?: number };
  quality?: Quality;
  /** The lowest resolution `auto` may drop to while things move, real pixels per CSS pixel. Default 0.75. */
  minResolution?: number;
  layer?: 'overlay' | 'inline';
  render?: 'demand' | 'always';
  lights?: Light3D[];
  objects: Object3DSpec[];
}

declare module '../../types.js' {
  interface NodeTypeMap {
    scene3d: Scene3DSpec;
  }
}

export const OBJECT_BIND_KEYS = ['position.x', 'position.y', 'position.z', 'rotation.x', 'rotation.y', 'rotation.z', 'scale'] as const;
export const LIGHT_BIND_KEYS = ['intensity', 'position.x', 'position.y', 'position.z'] as const;
export const CAMERA_BIND_KEYS = ['position.x', 'position.y', 'position.z', 'target.x', 'target.y', 'target.z', 'fov'] as const;
export type CameraBindKey = (typeof CAMERA_BIND_KEYS)[number];
export type ObjectBindKey = (typeof OBJECT_BIND_KEYS)[number];
export type LightBindKey = (typeof LIGHT_BIND_KEYS)[number];

export const LIMITS_3D = {
  objects: 500,
  depth: 8,
  lights: 16,
  shadowLights: 4,
  segments: 128,
  srcLength: 2048,
  palette: 64,
  variants: 32,
  /** Points across all `particles` objects in one scene. */
  particles: 50_000,
  particleColors: 8,
  /** Points on a camera path (and on its target path). */
  pathPoints: 64,
  /** Named parts driven on one model. */
  parts: 64,
  /** Copies across all `instances` objects in one scene. */
  instances: 20_000,
} as const;

/* -------------------------------------------------------------- validation */

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function validateScene3D(node: Record<string, unknown>, at: string, ctx: SpecContext): void {
  const fail = (m: string): never => ctx.fail(m);
  const vec3 = (v: unknown, where: string) => {
    if (v !== undefined && !(Array.isArray(v) && v.length === 3 && v.every(num))) fail(`${where} must be [x, y, z]`);
  };
  const range = (v: unknown, where: string, lo: number, hi: number) => {
    if (v !== undefined && !(num(v) && v >= lo && v <= hi)) fail(`${where} must be a number from ${lo} to ${hi}`);
  };
  const oneOf = (v: unknown, where: string, options: readonly string[]) => {
    if (v !== undefined && !options.includes(v as string)) fail(`${where} must be one of ${options.join(', ')}`);
  };
  const bool = (v: unknown, where: string) => {
    if (v !== undefined && typeof v !== 'boolean') fail(`${where} must be true or false`);
  };
  const color = (v: unknown, where: string) => v !== undefined && ctx.checkColor(v, where);
  const url = (v: unknown, where: string) => {
    if (typeof v !== 'string' || v.length === 0 || v.length > LIMITS_3D.srcLength) fail(`${where} must be a URL up to ${LIMITS_3D.srcLength} characters`);
    // Only web URLs and relative paths: no javascript:, data:, blob:, file:.
    if (/^\s*[a-z][a-z0-9+.-]*:/i.test(v as string) && !/^https?:\/\//i.test(v as string)) fail(`${where} must be an http(s) or relative URL`);
  };
  const conditions = (v: unknown, where: string) => {
    if (v === undefined) return;
    const list = Array.isArray(v) ? v : [v];
    list.forEach((c, i) => {
      const w = Array.isArray(v) ? `${where}[${i}]` : where;
      if (!isRecord(c)) fail(`${w} must be { expr, min?, max? }`);
      ctx.checkExpr((c as Record<string, unknown>).expr, `${w}.expr`);
      range((c as Record<string, unknown>).min, `${w}.min`, -Infinity, Infinity);
      range((c as Record<string, unknown>).max, `${w}.max`, -Infinity, Infinity);
    });
  };
  const binds = (v: unknown, where: string, keys: readonly string[]) => {
    if (v === undefined) return;
    if (!isRecord(v)) fail(`${where} must be an object`);
    for (const [k, src] of Object.entries(v as Record<string, unknown>)) {
      if (!keys.includes(k)) fail(`${where}.${k} is not bindable — expected one of ${keys.join(', ')}`);
      ctx.checkExpr(src, `${where}.${k}`);
    }
  };
  const palette = (v: unknown, where: string, max: number, each: (x: unknown, w: string) => void) => {
    if (!Array.isArray(v) || v.length < 1 || v.length > max) fail(`${where} must be a list of 1 to ${max}`);
    (v as unknown[]).forEach((x, i) => each(x, `${where}[${i}]`));
  };

  if (!num(node.width) || node.width <= 0 || !num(node.height) || node.height <= 0) fail(`${at} (scene3d) needs a positive width and height`);

  if (node.camera !== undefined) {
    if (!isRecord(node.camera)) fail(`${at}.camera must be an object`);
    const cam = node.camera as Record<string, unknown>;
    vec3(cam.position, `${at}.camera.position`);
    vec3(cam.target, `${at}.camera.target`);
    range(cam.fov, `${at}.camera.fov`, 1, 170);
    binds(cam.bind, `${at}.camera.bind`, CAMERA_BIND_KEYS);
    if (cam.path !== undefined) {
      if (!isRecord(cam.path)) fail(`${at}.camera.path must be { points, target?, along }`);
      const path = cam.path as Record<string, unknown>;
      const points = (v: unknown, w: string) => {
        if (!Array.isArray(v) || v.length < 2 || v.length > LIMITS_3D.pathPoints) fail(`${w} must be a list of 2 to ${LIMITS_3D.pathPoints} points`);
        (v as unknown[]).forEach((p, i) => {
          if (!(Array.isArray(p) && p.length === 3 && p.every(num))) fail(`${w}[${i}] must be [x, y, z]`);
        });
      };
      points(path.points, `${at}.camera.path.points`);
      if (path.target !== undefined) points(path.target, `${at}.camera.path.target`);
      ctx.checkExpr(path.along, `${at}.camera.path.along`);
    }
  }
  if (node.orbit !== undefined && typeof node.orbit !== 'boolean') {
    if (!isRecord(node.orbit)) fail(`${at}.orbit must be true, false or an object`);
    const o = node.orbit as Record<string, unknown>;
    range(o.autoRotate, `${at}.orbit.autoRotate`, -60, 60);
    range(o.minDistance, `${at}.orbit.minDistance`, 0, 1e4);
    range(o.maxDistance, `${at}.orbit.maxDistance`, 0, 1e4);
    range(o.minPolarAngle, `${at}.orbit.minPolarAngle`, 0, 180);
    range(o.maxPolarAngle, `${at}.orbit.maxPolarAngle`, 0, 180);
    bool(o.pan, `${at}.orbit.pan`);
    bool(o.zoom, `${at}.orbit.zoom`);
  }
  if (node.environment !== undefined) {
    if (!isRecord(node.environment)) fail(`${at}.environment must be an object`);
    const e = node.environment as Record<string, unknown>;
    oneOf(e.preset, `${at}.environment.preset`, ['studio', 'none']);
    range(e.intensity, `${at}.environment.intensity`, 0, 10);
    if (e.src !== undefined) url(e.src, `${at}.environment.src`);
    bool(e.background, `${at}.environment.background`);
    range(e.blur, `${at}.environment.blur`, 0, 1);
    range(e.rotation, `${at}.environment.rotation`, -360, 360);
  }
  if (node.fog !== undefined) {
    if (!isRecord(node.fog)) fail(`${at}.fog must be { color, near?, far }`);
    const f = node.fog as Record<string, unknown>;
    if (f.color === undefined) fail(`${at}.fog.color is required`);
    color(f.color, `${at}.fog.color`);
    range(f.near, `${at}.fog.near`, 0, 1e4);
    range(f.far, `${at}.fog.far`, 0, 1e4);
    if (!num(f.far) || f.far <= ((f.near as number | undefined) ?? 0)) fail(`${at}.fog.far must be beyond near`);
  }
  range(node.exposure, `${at}.exposure`, 0, 10);
  if (node.finish !== undefined) {
    if (!isRecord(node.finish)) fail(`${at}.finish must be { grain?, vignette?, aberration? }`);
    const f = node.finish as Record<string, unknown>;
    range(f.grain, `${at}.finish.grain`, 0, 1);
    range(f.vignette, `${at}.finish.vignette`, 0, 1);
    range(f.aberration, `${at}.finish.aberration`, 0, 20);
  }
  color(node.background, `${at}.background`);
  oneOf(node.shadows, `${at}.shadows`, ['soft', 'sharp', 'none']);
  oneOf(node.quality, `${at}.quality`, ['auto', 'high', 'low']);
  range(node.minResolution, `${at}.minResolution`, 0.25, 1);
  oneOf(node.layer, `${at}.layer`, ['overlay', 'inline']);
  oneOf(node.render, `${at}.render`, ['demand', 'always']);
  if (node.bloom !== undefined) {
    if (!isRecord(node.bloom)) fail(`${at}.bloom must be { strength?, radius?, threshold? }`);
    const b = node.bloom as Record<string, unknown>;
    range(b.strength, `${at}.bloom.strength`, 0, 3);
    range(b.radius, `${at}.bloom.radius`, 0, 1);
    range(b.threshold, `${at}.bloom.threshold`, 0, 1);
  }
  if (node.floor !== undefined && node.floor !== false) {
    if (!isRecord(node.floor)) fail(`${at}.floor must be false or { shadow?, size? }`);
    const f = node.floor as Record<string, unknown>;
    range(f.shadow, `${at}.floor.shadow`, 0, 1);
    range(f.size, `${at}.floor.size`, 0.01, 1e4);
  }

  if (node.lights !== undefined) {
    if (!Array.isArray(node.lights) || node.lights.length > LIMITS_3D.lights) fail(`${at}.lights must be a list of at most ${LIMITS_3D.lights}`);
    let casters = 0;
    (node.lights as unknown[]).forEach((l, i) => {
      const w = `${at}.lights[${i}]`;
      if (!isRecord(l)) fail(`${w} must be an object`);
      const light = l as Record<string, unknown>;
      oneOf(light.type, `${w}.type`, ['directional', 'point', 'spot', 'ambient', 'hemisphere']);
      if (light.type === undefined) fail(`${w}.type is required`);
      if (light.id !== undefined && (typeof light.id !== 'string' || light.id.length > 64)) fail(`${w}.id must be a short string`);
      color(light.color, `${w}.color`);
      color(light.groundColor, `${w}.groundColor`);
      range(light.intensity, `${w}.intensity`, 0, 1e5);
      vec3(light.position, `${w}.position`);
      vec3(light.target, `${w}.target`);
      range(light.distance, `${w}.distance`, 0, 1e4);
      range(light.angle, `${w}.angle`, 0, 90);
      range(light.penumbra, `${w}.penumbra`, 0, 1);
      bool(light.castShadow, `${w}.castShadow`);
      if (light.castShadow === true) casters++;
      binds(light.bind, `${w}.bind`, LIGHT_BIND_KEYS);
      conditions(light.visible_when, `${w}.visible_when`);
    });
    // Each shadow-casting light is a shadow map to redraw and a texture slot in every material.
    if (casters > LIMITS_3D.shadowLights) fail(`${at}.lights: at most ${LIMITS_3D.shadowLights} may cast shadows`);
  }

  if (!Array.isArray(node.objects)) fail(`${at}.objects must be a list`);
  let count = 0;
  let points = 0;
  let copies = 0;
  const material = (m: unknown, w: string) => {
    if (m === undefined) return;
    if (!isRecord(m)) fail(`${w} must be an object`);
    const mat = m as Record<string, unknown>;
    color(mat.color, `${w}.color`);
    color(mat.emissive, `${w}.emissive`);
    for (const k of ['roughness', 'metalness', 'opacity', 'clearcoat', 'transmission'] as const) range(mat[k], `${w}.${k}`, 0, 1);
    range(mat.emissiveIntensity, `${w}.emissiveIntensity`, 0, 100);
    bool(mat.flatShading, `${w}.flatShading`);
    oneOf(mat.side, `${w}.side`, ['front', 'back', 'double']);
    if (mat.color_by !== undefined) {
      if (!isRecord(mat.color_by)) fail(`${w}.color_by must be { param, palette }`);
      const cb = mat.color_by as Record<string, unknown>;
      ctx.checkParamRef(cb.param, `${w}.color_by.param`);
      palette(cb.palette, `${w}.color_by.palette`, LIMITS_3D.palette, (x, pw) => ctx.checkColor(x, pw));
    }
  };
  const segments = (v: unknown, w: string) => {
    if (v !== undefined && !(num(v) && Number.isInteger(v) && v >= 3 && v <= LIMITS_3D.segments)) fail(`${w} must be a whole number from 3 to ${LIMITS_3D.segments}`);
  };
  const positive = (v: unknown, w: string) => {
    if (!num(v) || v <= 0) fail(`${w} must be a positive number`);
  };
  const object = (o: unknown, w: string, depth: number): void => {
    if (++count > LIMITS_3D.objects) fail(`${at}.objects: more than ${LIMITS_3D.objects} objects in total`);
    if (depth > LIMITS_3D.depth) fail(`${w}: groups nest more than ${LIMITS_3D.depth} deep`);
    if (!isRecord(o)) fail(`${w} must be an object`);
    const ob = o as Record<string, unknown>;
    if (ob.id !== undefined && (typeof ob.id !== 'string' || ob.id.length > 64)) fail(`${w}.id must be a short string`);
    vec3(ob.position, `${w}.position`);
    vec3(ob.rotation, `${w}.rotation`);
    if (ob.scale !== undefined && !(num(ob.scale) && ob.scale > 0)) vec3(ob.scale, `${w}.scale`);
    bool(ob.castShadow, `${w}.castShadow`);
    bool(ob.receiveShadow, `${w}.receiveShadow`);
    binds(ob.bind, `${w}.bind`, OBJECT_BIND_KEYS);
    conditions(ob.visible_when, `${w}.visible_when`);
    for (const key of ['on_click', 'on_hover'] as const) {
      const on = ob[key];
      if (on === undefined) continue;
      if (!isRecord(on) || !isRecord(on.set)) fail(`${w}.${key} must be { set: { param: value } }`);
      for (const [p, v] of Object.entries((on as { set: Record<string, unknown> }).set)) {
        ctx.checkParamRef(p, `${w}.${key}.set.${p}`);
        if (!num(v)) fail(`${w}.${key}.set.${p} must be a number`);
      }
    }
    switch (ob.type) {
      case 'model': {
        url(ob.src, `${w}.src`);
        if (ob.fit !== undefined) positive(ob.fit, `${w}.fit`);
        oneOf(ob.fitAxis, `${w}.fitAxis`, ['max', 'width', 'height', 'depth']);
        bool(ob.center, `${w}.center`);
        if (ob.variant !== undefined && typeof ob.variant !== 'string') fail(`${w}.variant must be a string`);
        if (ob.animation !== undefined && typeof ob.animation !== 'string' && typeof ob.animation !== 'boolean') fail(`${w}.animation must be a clip name or true`);
        if (ob.variant_by !== undefined) {
          if (!isRecord(ob.variant_by)) fail(`${w}.variant_by must be { param, variants }`);
          const vb = ob.variant_by as Record<string, unknown>;
          ctx.checkParamRef(vb.param, `${w}.variant_by.param`);
          palette(vb.variants, `${w}.variant_by.variants`, LIMITS_3D.variants, (x, vw) => {
            if (typeof x !== 'string' || x.length > 128) fail(`${vw} must be a variant name`);
          });
        }
        if (ob.parts !== undefined) {
          if (!isRecord(ob.parts) || Object.keys(ob.parts).length > LIMITS_3D.parts) fail(`${w}.parts must be an object of at most ${LIMITS_3D.parts} parts`);
          for (const [name, part] of Object.entries(ob.parts as Record<string, unknown>)) {
            const pw = `${w}.parts.${name}`;
            if (name.length > 128) fail(`${pw}: part names are at most 128 characters`);
            if (!isRecord(part)) fail(`${pw} must be { bind?, visible_when?, material? }`);
            const pt = part as Record<string, unknown>;
            binds(pt.bind, `${pw}.bind`, OBJECT_BIND_KEYS);
            conditions(pt.visible_when, `${pw}.visible_when`);
            material(pt.material, `${pw}.material`);
          }
        }
        return;
      }
      case 'box':
        if (!(Array.isArray(ob.size) && ob.size.length === 3 && ob.size.every((n) => num(n) && n > 0))) fail(`${w}.size must be [width, height, depth], all positive`);
        range(ob.radius, `${w}.radius`, 0, 1e4);
        material(ob.material, `${w}.material`);
        return;
      case 'sphere':
        positive(ob.radius, `${w}.radius`);
        segments(ob.segments, `${w}.segments`);
        material(ob.material, `${w}.material`);
        return;
      case 'cylinder':
        range(ob.radiusTop, `${w}.radiusTop`, 0, 1e4);
        range(ob.radiusBottom, `${w}.radiusBottom`, 0, 1e4);
        if (ob.radiusTop === undefined || ob.radiusBottom === undefined) fail(`${w} (cylinder) needs radiusTop and radiusBottom`);
        positive(ob.height, `${w}.height`);
        segments(ob.segments, `${w}.segments`);
        material(ob.material, `${w}.material`);
        return;
      case 'plane':
        if (!(Array.isArray(ob.size) && ob.size.length === 2 && ob.size.every((n) => num(n) && n > 0))) fail(`${w}.size must be [width, height], both positive`);
        material(ob.material, `${w}.material`);
        return;
      case 'torus':
        positive(ob.radius, `${w}.radius`);
        positive(ob.tube, `${w}.tube`);
        material(ob.material, `${w}.material`);
        return;
      case 'particles':
        if (!(num(ob.count) && Number.isInteger(ob.count) && ob.count >= 1)) fail(`${w}.count must be a whole number, at least 1`);
        points += ob.count as number;
        if (points > LIMITS_3D.particles) fail(`${at}: more than ${LIMITS_3D.particles} particles in total`);
        positive(ob.radius, `${w}.radius`);
        oneOf(ob.shape, `${w}.shape`, ['disc', 'shell']);
        range(ob.size, `${w}.size`, 0.001, 10);
        range(ob.speed, `${w}.speed`, -10, 10);
        if (ob.colors !== undefined) palette(ob.colors, `${w}.colors`, LIMITS_3D.particleColors, (x, cw) => ctx.checkColor(x, cw));
        return;
      case 'instances': {
        if (!(num(ob.count) && Number.isInteger(ob.count) && ob.count >= 1)) fail(`${w}.count must be a whole number, at least 1`);
        copies += ob.count as number;
        if (copies > LIMITS_3D.instances) fail(`${at}: more than ${LIMITS_3D.instances} instances in total`);
        oneOf(ob.shape, `${w}.shape`, ['sphere', 'box', 'cylinder']);
        if (ob.shape === undefined) fail(`${w}.shape is required`);
        if (!(Array.isArray(ob.size) && ob.size.length === 3 && ob.size.every((n) => num(n) && n > 0))) fail(`${w}.size must be [x, y, z], all positive`);
        range(ob.jitter, `${w}.jitter`, 0, 1);
        if (!isRecord(ob.scatter)) fail(`${w}.scatter must be { shape, radius?, height?, size? }`);
        const sc = ob.scatter as Record<string, unknown>;
        oneOf(sc.shape, `${w}.scatter.shape`, ['heap', 'disc', 'box']);
        if (sc.shape === undefined) fail(`${w}.scatter.shape is required`);
        range(sc.radius, `${w}.scatter.radius`, 0, 1e4);
        range(sc.height, `${w}.scatter.height`, 0, 1e4);
        if (sc.size !== undefined && !(Array.isArray(sc.size) && sc.size.length === 3 && sc.size.every((n) => num(n) && n >= 0))) fail(`${w}.scatter.size must be [x, y, z]`);
        if (ob.fall !== undefined) {
          if (!isRecord(ob.fall)) fail(`${w}.fall must be { height, speed?, spin? }`);
          const f = ob.fall as Record<string, unknown>;
          positive(f.height, `${w}.fall.height`);
          range(f.speed, `${w}.fall.speed`, -100, 100);
          range(f.spin, `${w}.fall.spin`, 0, 20);
        }
        range(ob.seed, `${w}.seed`, 0, 2 ** 32);
        if (ob.colors !== undefined) palette(ob.colors, `${w}.colors`, LIMITS_3D.particleColors, (x, cw) => ctx.checkColor(x, cw));
        material(ob.material, `${w}.material`);
        return;
      }
      case 'group':
        if (!Array.isArray(ob.children)) fail(`${w}.children must be a list`);
        bool(ob.merge, `${w}.merge`);
        (ob.children as unknown[]).forEach((c, i) => object(c, `${w}.children[${i}]`, depth + 1));
        return;
      default:
        fail(`${w}.type must be one of model, box, sphere, cylinder, plane, torus, particles, instances, group`);
    }
  };
  (node.objects as unknown[]).forEach((o, i) => object(o, `${at}.objects[${i}]`, 0));
}
