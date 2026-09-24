import { BaseObject } from './objects.ts';
import { SVG_NS } from './scene.ts';
import type { BaseNodeSpec, CameraSpec, SceneLike, Space3DItemSpec } from './types.ts';

/**
 * 3D, drawn in SVG.
 *
 * No WebGL: a mathematical surface at explanation resolution is a few hundred
 * quads, which SVG paints comfortably, stays crisp at any zoom, themes with
 * CSS colours and costs no GPU context on a page that also has to scroll.
 * Everything is re-projected on the scene's clock, sorted far to near, and
 * batched into a fixed number of `<path>` elements per depth band, so the DOM
 * never grows with the mesh.
 *
 * The pure half (camera, shapes, primitive building) is exported and tested
 * without a DOM; `Space3D` at the bottom is the only part that touches one.
 */

export type Vec3 = readonly [number, number, number];

export interface Camera {
  /** Radians about the vertical (model z) axis. */
  yaw: number;
  /** Radians the view tilts down onto the model. 0 = side-on. */
  pitch: number;
  /** Model units → scene units. */
  zoom: number;
  /** Eye distance in model units; `undefined` = orthographic. */
  distance?: number;
}

export const DEFAULT_CAMERA: Camera = { yaw: 0.6, pitch: 0.5, zoom: 40 };

/**
 * Model space → scene space, plus depth (larger = farther from the eye).
 *
 * Model z is up. Yaw turns the model about z; pitch then tilts the view so the
 * top of the model leans toward the viewer. Scene y grows downward, hence the
 * sign flip.
 */
export function project([x, y, z]: Vec3, cam: Camera): [number, number, number] {
  const cy = Math.cos(cam.yaw);
  const sy = Math.sin(cam.yaw);
  const right = x * cy - y * sy;
  const into = x * sy + y * cy;

  const cp = Math.cos(cam.pitch);
  const sp = Math.sin(cam.pitch);
  const up = z * cp + into * sp;
  const depth = into * cp - z * sp;

  const k = cam.distance ? (cam.zoom * cam.distance) / Math.max(1e-6, cam.distance + depth) : cam.zoom;
  return [right * k, -up * k, depth];
}

/* ------------------------------------------------------------------ shapes */

type Params = Record<string, number>;

interface SurfaceShape {
  kind: 'surface';
  f: (u: number, v: number, p: Params) => Vec3;
  u: [number, number];
  v: [number, number];
  defaults: Params;
  steps: [number, number];
}

interface CurveShape {
  kind: 'curve';
  f: (t: number, p: Params) => Vec3;
  t: (p: Params) => [number, number];
  defaults: Params;
  steps: [number];
}

const TAU = Math.PI * 2;

/**
 * The shapes a JSON spec can name.
 *
 * Named, not written as formula strings, on purpose: a spec may come from a
 * model or a stranger, and evaluating an expression string from one is code
 * execution. A name plus numeric params is inert data. Code callers are not
 * limited to these — `Space3D.add` takes any function.
 */
export const SHAPES: Record<string, SurfaceShape | CurveShape> = {
  /** The figure-8 immersion of the Klein bottle: fix u and the section is a lemniscate. */
  klein8: {
    kind: 'surface',
    u: [0, TAU],
    v: [0, TAU],
    defaults: { R: 3.2 },
    steps: [40, 32],
    f: (u, v, { R = 3.2 }) => {
      const a = Math.cos(u / 2) * Math.sin(v) - Math.sin(u / 2) * Math.sin(2 * v);
      const b = Math.sin(u / 2) * Math.sin(v) + Math.cos(u / 2) * Math.sin(2 * v);
      return [(R + a) * Math.cos(u), (R + a) * Math.sin(u), b];
    },
  },
  torus: {
    kind: 'surface',
    u: [0, TAU],
    v: [0, TAU],
    defaults: { R: 3, r: 1 },
    steps: [36, 18],
    f: (u, v, { R = 3, r = 1 }) => [
      (R + r * Math.cos(v)) * Math.cos(u),
      (R + r * Math.cos(v)) * Math.sin(u),
      r * Math.sin(v),
    ],
  },
  sphere: {
    kind: 'surface',
    u: [0, TAU],
    v: [0, Math.PI],
    defaults: { r: 2.5 },
    steps: [32, 16],
    f: (u, v, { r = 2.5 }) => [r * Math.sin(v) * Math.cos(u), r * Math.sin(v) * Math.sin(u), r * Math.cos(v)],
  },
  mobius: {
    kind: 'surface',
    u: [0, TAU],
    v: [-1, 1],
    defaults: { R: 2.5, w: 1 },
    steps: [48, 6],
    f: (u, v, { R = 2.5, w = 1 }) => [
      (R + w * v * Math.cos(u / 2)) * Math.cos(u),
      (R + w * v * Math.cos(u / 2)) * Math.sin(u),
      w * v * Math.sin(u / 2),
    ],
  },
  helix: {
    kind: 'curve',
    t: ({ turns = 4 }) => [0, TAU * turns],
    defaults: { r: 2, pitch: 0.35, turns: 4 },
    steps: [240],
    f: (t, { r = 2, pitch = 0.35, turns = 4 }) => [r * Math.cos(t), r * Math.sin(t), pitch * (t - Math.PI * turns)],
  },
  torusKnot: {
    kind: 'curve',
    t: () => [0, TAU],
    defaults: { p: 2, q: 3, R: 2.5, r: 1 },
    steps: [360],
    f: (t, { p = 2, q = 3, R = 2.5, r = 1 }) => [
      (R + r * Math.cos(q * t)) * Math.cos(p * t),
      (R + r * Math.cos(q * t)) * Math.sin(p * t),
      r * Math.sin(q * t),
    ],
  },
  lissajous: {
    kind: 'curve',
    t: () => [0, TAU],
    defaults: { a: 3, b: 2, c: 5, size: 2.5 },
    steps: [400],
    f: (t, { a = 3, b = 2, c = 5, size = 2.5 }) => [
      size * Math.sin(a * t),
      size * Math.sin(b * t),
      size * Math.sin(c * t),
    ],
  },
};

/* ------------------------------------------------------------------- items */

interface Style {
  stroke: string;
  strokeWidth: number;
}

/** A parametric surface. `reveal` and `highlight` are fractions of the u range, 0–1. */
export interface SurfaceItem extends Style {
  kind: 'surface';
  f: (u: number, v: number) => Vec3;
  u: [number, number];
  v: [number, number];
  steps: [number, number];
  fill: string;
  /** Opacity of the nearest faces; farther ones fade toward a third of it. */
  fillOpacity: number;
  /** How many constant-v lines to draw along u. The constant-u rings are every step. */
  longitudes: number;
  /** Faces beyond this fraction of u are not filled yet — a surface filling in. */
  reveal: number;
  /** Draw the constant-u ring at this fraction, bold. `null` for none. */
  highlight: number | null;
}

/** A parametric curve. `draw` is how much of it is shown, 0–1. */
export interface CurveItem extends Style {
  kind: 'curve';
  f: (t: number) => Vec3;
  t: [number, number];
  steps: number;
  draw: number;
}

export type SpaceItem = SurfaceItem | CurveItem;

/** A named shape from a spec → a drawable item. Throws on an unknown name. */
export function itemFromSpec(spec: Space3DItemSpec): SpaceItem {
  const shape = SHAPES[spec.shape];
  if (!shape) throw new Error(`unknown shape ${JSON.stringify(spec.shape)}`);
  const p = { ...shape.defaults, ...spec.params };
  const stroke = spec.stroke ?? 'currentColor';
  const strokeWidth = spec.strokeWidth ?? 1;

  if (shape.kind === 'surface') {
    return {
      kind: 'surface',
      f: (u, v) => shape.f(u, v, p),
      u: shape.u,
      v: shape.v,
      steps: [spec.steps?.[0] ?? shape.steps[0], spec.steps?.[1] ?? shape.steps[1]],
      stroke,
      strokeWidth,
      fill: spec.fill ?? stroke,
      fillOpacity: spec.fillOpacity ?? 0.12,
      longitudes: 6,
      reveal: 1,
      highlight: null,
    };
  }
  return {
    kind: 'curve',
    f: (t) => shape.f(t, p),
    t: shape.t(p),
    steps: spec.steps?.[0] ?? shape.steps[0],
    stroke,
    strokeWidth,
    draw: 1,
  };
}

/* -------------------------------------------------------------- primitives */

/** One quad or one segment, projected, with the depth it is sorted by. */
export interface Primitive {
  item: number;
  kind: 'face' | 'line';
  pts: Array<[number, number]>;
  depth: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Every face and line segment of every item, projected for this camera. */
export function buildPrimitives(items: readonly SpaceItem[], cam: Camera): Primitive[] {
  const out: Primitive[] = [];

  items.forEach((item, index) => {
    if (item.kind === 'curve') {
      const n = Math.max(1, Math.round(item.steps * Math.min(1, Math.max(0, item.draw))));
      let prev = project(item.f(item.t[0]), cam);
      for (let i = 1; i <= n; i++) {
        const cur = project(item.f(lerp(item.t[0], item.t[1], i / item.steps)), cam);
        out.push({ item: index, kind: 'line', pts: [[prev[0], prev[1]], [cur[0], cur[1]]], depth: (prev[2] + cur[2]) / 2 });
        prev = cur;
      }
      return;
    }

    const [nu, nv] = item.steps;
    const grid: Array<Array<[number, number, number]>> = [];
    for (let i = 0; i <= nu; i++) {
      const row: Array<[number, number, number]> = [];
      const u = lerp(item.u[0], item.u[1], i / nu);
      for (let j = 0; j <= nv; j++) row.push(project(item.f(u, lerp(item.v[0], item.v[1], j / nv)), cam));
      grid.push(row);
    }
    const at = (i: number, j: number) => grid[i]![j]!;
    const xy = (p: [number, number, number]): [number, number] => [p[0], p[1]];

    const filled = Math.round(nu * Math.min(1, Math.max(0, item.reveal)));
    if (item.fillOpacity > 0) {
      for (let i = 0; i < filled; i++) {
        for (let j = 0; j < nv; j++) {
          const q = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
          out.push({ item: index, kind: 'face', pts: q.map(xy), depth: (q[0]![2] + q[1]![2] + q[2]![2] + q[3]![2]) / 4 });
        }
      }
    }

    // Rings (constant u) at every step: they carry the shape.
    for (let i = 0; i <= nu; i++) {
      for (let j = 0; j < nv; j++) {
        const a = at(i, j);
        const b = at(i, j + 1);
        out.push({ item: index, kind: 'line', pts: [xy(a), xy(b)], depth: (a[2] + b[2]) / 2 });
      }
    }
    // A few longitudes (constant v) to show the flow without crowding it.
    const every = Math.max(1, Math.round(nv / Math.max(1, item.longitudes)));
    for (let j = 0; j < nv; j += every) {
      for (let i = 0; i < nu; i++) {
        const a = at(i, j);
        const b = at(i + 1, j);
        out.push({ item: index, kind: 'line', pts: [xy(a), xy(b)], depth: (a[2] + b[2]) / 2 });
      }
    }
  });

  return out;
}

/**
 * Split primitives into `bands` depth bands, band 0 farthest. Painting bands in
 * order is the painter's algorithm at band resolution; within a band, overlap
 * order does not matter at the opacities these are drawn with.
 */
export function bandByDepth(prims: readonly Primitive[], bands: number): Primitive[][] {
  const out: Primitive[][] = Array.from({ length: bands }, () => []);
  if (prims.length === 0) return out;
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of prims) {
    if (p.depth < lo) lo = p.depth;
    if (p.depth > hi) hi = p.depth;
  }
  const span = hi - lo || 1;
  for (const p of prims) {
    // Farthest (largest depth) → band 0.
    const b = Math.min(bands - 1, Math.floor(((hi - p.depth) / span) * bands));
    out[b]!.push(p);
  }
  return out;
}

const f1 = (n: number) => (Math.round(n * 10) / 10).toString();

/** Primitives → one `d` string. Faces close; segments don't. */
export function toPathData(prims: readonly Primitive[]): string {
  let d = '';
  for (const p of prims) {
    const [first, ...rest] = p.pts;
    if (!first) continue;
    d += `M${f1(first[0])} ${f1(first[1])}`;
    for (const q of rest) d += `L${f1(q[0])} ${f1(q[1])}`;
    if (p.kind === 'face') d += 'Z';
  }
  return d;
}

/* -------------------------------------------------------------------- node */

export interface Space3DOptions extends BaseNodeSpec {
  camera?: CameraSpec;
  /** Drag to turn the camera. */
  orbit?: boolean;
  /** Radians/second of yaw. Applied from `elapsed`, so a spinning scene still seeks. */
  spin?: number;
  /** Depth bands per item. More = smoother fading, more elements. */
  bands?: number;
}

/**
 * A 3D group: one camera, any number of surfaces and curves, depth-sorted
 * *together* so a curve can pass behind a surface and in front of it again.
 */
export class Space3D extends BaseObject {
  readonly camera: Camera;
  readonly items: SpaceItem[] = [];
  spin: number;

  private readonly group: SVGGElement;
  private readonly bands: number;
  private readonly baseYaw: number;
  private dragYaw = 0;
  /** Yaw contributed by `spin` at the last update — kept so a drag adds to it. */
  private spun = 0;
  private readonly orbit: boolean;
  private faces: SVGPathElement[][] = [];
  private lines: SVGPathElement[][] = [];
  private highlights: SVGPathElement[] = [];
  private lastKey = '';

  constructor(options: Space3DOptions = {}) {
    const group = document.createElementNS(SVG_NS, 'g');
    super(group, options);
    this.group = group;
    this.camera = { ...DEFAULT_CAMERA, ...options.camera };
    this.baseYaw = this.camera.yaw;
    this.spin = options.spin ?? 0;
    this.bands = options.bands ?? 10;
    this.orbit = options.orbit ?? false;
  }

  override onMount(scene: SceneLike): void {
    super.onMount(scene);
    // On the svg, not this group: a group only receives pointer events where it
    // has paint, and a wireframe is mostly empty space between the lines.
    if (this.orbit) this.enableOrbit(scene.svg);
  }

  add(item: SpaceItem): SpaceItem {
    this.items.push(item);
    this.rebuildElements();
    return item;
  }

  /** Paint order is fixed: for each band far → near, each item's faces then its lines. */
  private rebuildElements(): void {
    this.group.replaceChildren();
    this.faces = this.items.map(() => []);
    this.lines = this.items.map(() => []);
    for (let b = 0; b < this.bands; b++) {
      this.items.forEach((item, k) => {
        const nearness = (b + 1) / this.bands;
        const face = document.createElementNS(SVG_NS, 'path');
        if (item.kind === 'surface') {
          face.setAttribute('fill', item.fill);
          face.setAttribute('fill-opacity', String(item.fillOpacity * (0.35 + 0.65 * nearness)));
          face.setAttribute('stroke', 'none');
        }
        const line = document.createElementNS(SVG_NS, 'path');
        line.setAttribute('fill', 'none');
        line.setAttribute('stroke', item.stroke);
        line.setAttribute('stroke-opacity', String(0.18 + 0.82 * nearness));
        line.setAttribute('stroke-width', String(item.strokeWidth * (0.6 + 0.6 * nearness)));
        line.setAttribute('stroke-linecap', 'round');
        line.setAttribute('vector-effect', 'non-scaling-stroke');
        this.group.append(face, line);
        this.faces[k]!.push(face);
        this.lines[k]!.push(line);
      });
    }
    this.highlights = this.items.map((item) => {
      const el = document.createElementNS(SVG_NS, 'path');
      el.setAttribute('fill', 'none');
      el.setAttribute('stroke', item.stroke);
      el.setAttribute('stroke-width', String(item.strokeWidth * 2.2));
      el.setAttribute('vector-effect', 'non-scaling-stroke');
      this.group.append(el);
      return el;
    });
    this.lastKey = '';
  }

  override onUpdate(dt: number, elapsed: number): void {
    super.onUpdate(dt, elapsed);
    this.spun = this.spin * elapsed;
    this.camera.yaw = this.baseYaw + this.spun + this.dragYaw;
    this.render();
  }

  /** Re-project, but only when something that changes the picture changed. */
  render(): void {
    const c = this.camera;
    const key = `${c.yaw}|${c.pitch}|${c.zoom}|${c.distance}|${this.items
      .map((it) => (it.kind === 'curve' ? it.draw : `${it.reveal},${it.highlight}`))
      .join(';')}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    const prims = buildPrimitives(this.items, c);
    const banded = bandByDepth(prims, this.bands);
    this.items.forEach((item, k) => {
      for (let b = 0; b < this.bands; b++) {
        const mine = banded[b]!.filter((p) => p.item === k);
        this.faces[k]![b]!.setAttribute('d', toPathData(mine.filter((p) => p.kind === 'face')));
        this.lines[k]![b]!.setAttribute('d', toPathData(mine.filter((p) => p.kind === 'line')));
      }
      const hl = this.highlights[k]!;
      if (item.kind === 'surface' && item.highlight !== null) {
        const u = lerp(item.u[0], item.u[1], item.highlight);
        const n = item.steps[1] * 2;
        const pts = Array.from({ length: n + 1 }, (_, j) => {
          const p = project(item.f(u, lerp(item.v[0], item.v[1], j / n)), c);
          return [p[0], p[1]] as [number, number];
        });
        hl.setAttribute('d', toPathData([{ item: k, kind: 'line', pts, depth: 0 }]));
      } else {
        hl.setAttribute('d', '');
      }
    });
  }

  private enableOrbit(el: SVGSVGElement): void {
    el.style.cursor = 'grab';
    el.style.touchAction = 'none';
    let last: { x: number; y: number } | null = null;

    const down = (e: PointerEvent) => {
      last = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
      el.style.cursor = 'grabbing';
    };
    const move = (e: PointerEvent) => {
      if (!last) return;
      // Radians per CSS pixel: a full turn is a generous drag across a phone.
      this.dragYaw += (e.clientX - last.x) * 0.01;
      this.camera.pitch = Math.max(-1.4, Math.min(1.4, this.camera.pitch + (e.clientY - last.y) * 0.01));
      last = { x: e.clientX, y: e.clientY };
      // Stopped scenes (reduced motion, a scrubbed explainer) still answer a drag.
      this.camera.yaw = this.baseYaw + this.spun + this.dragYaw;
      this.render();
    };
    const up = (e: PointerEvent) => {
      last = null;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      el.style.cursor = 'grab';
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    this.onCleanup(() => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    });
  }
}
