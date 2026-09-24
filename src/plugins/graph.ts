/**
 * A living graph — the engine's third plugin. Obsidian-style: stars repel,
 * links pull like springs, a star you drag drags its neighbours, the whole
 * thing settles and then stops computing.
 *
 * Opt-in: `@t569/scene-engine/graph`. The host supplies nodes, edges and how
 * each kind looks; the plugin owns the physics, the camera (pan, wheel and
 * pinch zoom, `focus()`), hover neighbourhoods and clicks.
 *
 * The one engine feature that does not seek: a force layout is an integration,
 * so its state at time t depends on every frame before it. It is driven by the
 * scene clock like everything else, but `scene.seek(t)` leaves it where it is.
 *
 * The physics (`stepForces`) and the helpers around it are pure and tested
 * without a DOM.
 */
import { BaseObject, approach, toSceneCoords } from '../objects.ts';
import { SVG_NS } from '../scene.ts';
import type { BaseNodeSpec, SceneLike } from '../types.ts';

/* ----------------------------------------------------------------- physics */

export interface SimNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Held by the pointer: forces don't move it. */
  fixed: boolean;
  /** Heavier nodes are pushed around less. */
  mass: number;
}

export interface SimEdge {
  a: number;
  b: number;
  /** Rest length of the spring, in world units. */
  length: number;
  /** 0–1: how hard the spring pulls. */
  strength: number;
}

export interface ForceOptions {
  /** Strength of the push between every pair of nodes. */
  repulsion: number;
  /** Pull toward the origin, so disconnected parts stay in view. */
  gravity: number;
  /** Fraction of velocity kept per second (friction). */
  retention: number;
  /** Repulsion ignored beyond this distance — far stars barely interact. */
  cutoff: number;
}

export const DEFAULT_FORCES: ForceOptions = { repulsion: 2600, gravity: 0.35, retention: 0.02, cutoff: 900 };

/**
 * Advance the layout by `dt` seconds at temperature `alpha` (0–1; forces are
 * scaled by it, so a cooling layout calms down). Returns the kinetic energy
 * after the step — a settled layout's is near zero. Pure: mutates only `nodes`.
 */
export function stepForces(nodes: SimNode[], edges: SimEdge[], alpha: number, dt: number, f: ForceOptions = DEFAULT_FORCES): number {
  if (dt <= 0 || alpha <= 0) return 0;
  const n = nodes.length;
  const ax = new Float64Array(n);
  const ay = new Float64Array(n);

  // Every pair pushes apart, 1/d. O(n²): a site's worth of stars is fine.
  const cut2 = f.cutoff * f.cutoff;
  for (let i = 0; i < n; i++) {
    const a = nodes[i]!;
    for (let j = i + 1; j < n; j++) {
      const b = nodes[j]!;
      let dx = a.x - b.x;
      let dy = a.y - b.y;
      let d2 = dx * dx + dy * dy;
      if (d2 > cut2) continue;
      if (d2 < 1e-4) {
        // Coincident: nudge apart deterministically rather than divide by zero.
        dx = ((i - j) % 3) || 1;
        dy = ((i + j) % 3) - 1 || 1;
        d2 = dx * dx + dy * dy;
      }
      const d = Math.sqrt(d2);
      const force = (f.repulsion * alpha) / d2;
      const fx = (dx / d) * force;
      const fy = (dy / d) * force;
      ax[i]! += fx / a.mass;
      ay[i]! += fy / a.mass;
      ax[j]! -= fx / b.mass;
      ay[j]! -= fy / b.mass;
    }
  }

  // Springs toward their rest length.
  for (const e of edges) {
    const a = nodes[e.a];
    const b = nodes[e.b];
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1e-3;
    const pull = (d - e.length) * e.strength * alpha * 6;
    const fx = (dx / d) * pull;
    const fy = (dy / d) * pull;
    ax[e.a]! += fx / a.mass;
    ay[e.a]! += fy / a.mass;
    ax[e.b]! -= fx / b.mass;
    ay[e.b]! -= fy / b.mass;
  }

  // Integrate, with friction that doesn't depend on the frame rate.
  const keep = Math.pow(f.retention, dt);
  let energy = 0;
  for (let i = 0; i < n; i++) {
    const p = nodes[i]!;
    if (p.fixed) {
      p.vx = p.vy = 0;
      continue;
    }
    p.vx = (p.vx + (ax[i]! - p.x * f.gravity * alpha) * dt * 60) * keep;
    p.vy = (p.vy + (ay[i]! - p.y * f.gravity * alpha) * dt * 60) * keep;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    energy += p.vx * p.vx + p.vy * p.vy;
  }
  return energy;
}

/** A deterministic starting layout: a sunflower spiral, so a graph looks the same on every load. */
export function spiralLayout(count: number, spacing = 38): Array<[number, number]> {
  const golden = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: count }, (_, i) => {
    const r = spacing * Math.sqrt(i + 0.5);
    return [r * Math.cos(i * golden), r * Math.sin(i * golden)];
  });
}

/** node index → indices it is joined to. */
export function neighbours(count: number, edges: Array<{ a: number; b: number }>): Array<Set<number>> {
  const out = Array.from({ length: count }, () => new Set<number>());
  for (const e of edges) {
    out[e.a]?.add(e.b);
    out[e.b]?.add(e.a);
  }
  return out;
}

/** Camera: world → screen is `screen = world * k + (tx, ty)`. */
export interface Camera2D {
  tx: number;
  ty: number;
  k: number;
}

/** Zoom by `factor` keeping the world point under `(sx, sy)` fixed on screen. Pure. */
export function zoomAt(cam: Camera2D, sx: number, sy: number, factor: number, min = 0.15, max = 6): Camera2D {
  const k = Math.min(max, Math.max(min, cam.k * factor));
  const wx = (sx - cam.tx) / cam.k;
  const wy = (sy - cam.ty) / cam.k;
  return { k, tx: sx - wx * k, ty: sy - wy * k };
}

/* -------------------------------------------------------------------- node */

export interface GraphNodeData {
  id: string;
  label: string;
  /** Picks the look from `kinds`. */
  kind: string;
  /** Bigger stars are heavier and drawn larger. */
  weight?: number;
}

export interface GraphEdgeData {
  source: string;
  target: string;
  /** Picks the look from `edgeKinds`. */
  kind: string;
}

export interface KindStyle {
  fill: string;
  /** Base radius; grows with sqrt(weight). */
  radius: number;
  /** When the label shows: always, once zoomed in past `labelZoom`, or only on hover. */
  label: 'always' | 'zoom' | 'hover';
}

export interface EdgeStyle {
  stroke: string;
  width: number;
  opacity: number;
  dash?: string;
  /** Spring rest length and pull. */
  length: number;
  strength: number;
}

export interface GraphOptions extends BaseNodeSpec {
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
  kinds: Record<string, KindStyle>;
  edgeKinds: Record<string, EdgeStyle>;
  /** The viewport the graph is shown in, in scene units — for centring and fitting. */
  width: number;
  height: number;
  labelColor?: string;
  /** Ring colour for highlighted (e.g. "the assistant used this") stars. */
  highlightColor?: string;
  forces?: Partial<ForceOptions>;
  /** Zoom at which 'zoom' labels appear. Default 2. */
  labelZoom?: number;
  onOpen?: (node: GraphNodeData) => void;
  onHover?: (node: GraphNodeData | null) => void;
}

const ALPHA_MIN = 0.004;
const ALPHA_DECAY = 1.4; // per second: the layout cools in ~3s, then stops computing

/**
 * A graph as one scene node. Everything inside is drawn in a "world" group
 * under a camera transform; pan and zoom move the camera, never the stars.
 */
export class GraphNode extends BaseObject {
  readonly camera: Camera2D;
  private cameraTarget: Camera2D | null = null;
  private readonly world: SVGGElement;
  private readonly sim: SimNode[];
  private readonly simEdges: SimEdge[];
  private readonly adjacency: Array<Set<number>>;
  private readonly index = new Map<string, number>();
  private readonly circles: SVGCircleElement[] = [];
  private readonly rings: SVGCircleElement[] = [];
  private readonly labels: SVGTextElement[] = [];
  private readonly edgePaths = new Map<string, SVGPathElement>();
  private readonly forces: ForceOptions;
  private alpha = 1;
  private hovered: number | null = null;
  private highlighted = new Set<number>();
  private dirty = true;

  constructor(private readonly opts: GraphOptions) {
    const g = document.createElementNS(SVG_NS, 'g');
    super(g, opts);
    this.forces = { ...DEFAULT_FORCES, ...opts.forces };
    this.camera = { tx: opts.width / 2, ty: opts.height / 2, k: 1 };

    // A transparent backdrop so empty space takes pans and wheels.
    const back = document.createElementNS(SVG_NS, 'rect');
    back.setAttribute('x', '0');
    back.setAttribute('y', '0');
    back.setAttribute('width', String(opts.width));
    back.setAttribute('height', String(opts.height));
    back.setAttribute('fill', 'transparent');
    g.appendChild(back);

    this.world = document.createElementNS(SVG_NS, 'g');
    g.appendChild(this.world);

    opts.nodes.forEach((n, i) => this.index.set(n.id, i));
    const start = spiralLayout(opts.nodes.length);
    this.sim = opts.nodes.map((n, i) => ({
      x: start[i]![0],
      y: start[i]![1],
      vx: 0,
      vy: 0,
      fixed: false,
      mass: 1 + Math.sqrt(n.weight ?? 1) * 0.35,
    }));
    this.simEdges = opts.edges.flatMap((e) => {
      const a = this.index.get(e.source);
      const b = this.index.get(e.target);
      const style = opts.edgeKinds[e.kind];
      return a === undefined || b === undefined || !style ? [] : [{ a, b, length: style.length, strength: style.strength }];
    });
    this.adjacency = neighbours(this.sim.length, this.simEdges);

    // Edges under nodes, one path per kind.
    for (const [kind, style] of Object.entries(opts.edgeKinds)) {
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', style.stroke);
      p.setAttribute('stroke-width', String(style.width));
      p.setAttribute('stroke-opacity', String(style.opacity));
      p.setAttribute('vector-effect', 'non-scaling-stroke');
      if (style.dash) p.setAttribute('stroke-dasharray', style.dash);
      this.world.appendChild(p);
      this.edgePaths.set(kind, p);
    }
    opts.nodes.forEach((n) => {
      const style = opts.kinds[n.kind] ?? { fill: '#888', radius: 5, label: 'hover' as const };
      const ring = document.createElementNS(SVG_NS, 'circle');
      ring.setAttribute('fill', 'none');
      ring.setAttribute('stroke', opts.highlightColor ?? '#f59e0b');
      ring.setAttribute('stroke-width', '2.5');
      ring.setAttribute('vector-effect', 'non-scaling-stroke');
      ring.setAttribute('opacity', '0');
      const c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('r', String(this.radiusOf(n)));
      c.setAttribute('fill', style.fill);
      c.style.cursor = 'pointer';
      const t = document.createElementNS(SVG_NS, 'text');
      t.textContent = n.label;
      t.setAttribute('font-size', '12');
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('fill', opts.labelColor ?? '#333');
      t.style.pointerEvents = 'none';
      this.world.append(ring, c, t);
      this.rings.push(ring);
      this.circles.push(c);
      this.labels.push(t);
    });
  }

  /** Base radius, growing gently (and boundedly) with weight: a 60-passage page shouldn't eclipse its neighbours. */
  private radiusOf(n: GraphNodeData): number {
    const style = this.opts.kinds[n.kind];
    return (style?.radius ?? 5) * (1 + Math.min(1, Math.log2(Math.max(1, n.weight ?? 1)) / 7));
  }

  /** Warm the layout back up — after a drag, a filter, new data. */
  reheat(to = 0.6): void {
    this.alpha = Math.max(this.alpha, to);
  }

  /** Ease the camera to centre a star, zoomed in. Returns false if there's no such star. */
  focus(id: string, zoom = 1.8): boolean {
    const i = this.index.get(id);
    if (i === undefined) return false;
    const p = this.sim[i]!;
    this.cameraTarget = { k: zoom, tx: this.opts.width / 2 - p.x * zoom, ty: this.opts.height / 2 - p.y * zoom };
    this.hovered = i;
    this.dirty = true;
    return true;
  }

  /** Ring these stars (unknown ids are ignored); an empty list clears. */
  setHighlight(ids: string[]): void {
    this.highlighted = new Set(ids.flatMap((id) => (this.index.has(id) ? [this.index.get(id)!] : [])));
    this.dirty = true;
  }

  /** Zoom and centre to fit every star — never closer than `maxZoom`. */
  fit(padding = 40, maxZoom = 1.4): void {
    if (!this.sim.length) return;
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const p of this.sim) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    const k = Math.min(maxZoom, (this.opts.width - padding * 2) / (x1 - x0 || 1), (this.opts.height - padding * 2) / (y1 - y0 || 1));
    this.cameraTarget = { k, tx: this.opts.width / 2 - ((x0 + x1) / 2) * k, ty: this.opts.height / 2 - ((y0 + y1) / 2) * k };
  }

  override onMount(scene: SceneLike): void {
    super.onMount(scene);
    this.attachInput(scene.svg);
  }

  override onUpdate(dt: number, elapsed: number): void {
    super.onUpdate(dt, elapsed);
    if (this.alpha > ALPHA_MIN && dt > 0) {
      // Small fixed substeps keep a fast frame (or a stalled tab) stable.
      const steps = Math.min(4, Math.ceil(dt / (1 / 60)));
      for (let s = 0; s < steps; s++) stepForces(this.sim, this.simEdges, this.alpha, dt / steps, this.forces);
      this.alpha *= Math.exp(-ALPHA_DECAY * dt);
      this.dirty = true;
    }
    if (this.cameraTarget && dt > 0) {
      const t = this.cameraTarget;
      this.camera.k = approach(this.camera.k, t.k, 6, dt);
      this.camera.tx = approach(this.camera.tx, t.tx, 6, dt);
      this.camera.ty = approach(this.camera.ty, t.ty, 6, dt);
      if (Math.abs(this.camera.k - t.k) < 1e-3 && Math.abs(this.camera.tx - t.tx) < 0.5) this.cameraTarget = null;
      this.dirty = true;
    }
    if (this.dirty) this.paint();
  }

  /** Write positions, visibility and emphasis. Only when something changed. */
  private paint(): void {
    this.dirty = false;
    const cam = this.camera;
    this.world.setAttribute('transform', `translate(${cam.tx} ${cam.ty}) scale(${cam.k})`);
    const focus = this.hovered;
    const near = focus === null ? null : this.adjacency[focus]!;
    const lit = (i: number) => focus === null || i === focus || near!.has(i);

    const byKind = new Map<string, string[]>();
    this.opts.edges.forEach((e) => {
      const a = this.index.get(e.source);
      const b = this.index.get(e.target);
      if (a === undefined || b === undefined) return;
      // When a star is hovered, only its own lines stay drawn.
      if (focus !== null && a !== focus && b !== focus) return;
      const pa = this.sim[a]!;
      const pb = this.sim[b]!;
      const list = byKind.get(e.kind) ?? [];
      list.push(`M${pa.x.toFixed(1)} ${pa.y.toFixed(1)}L${pb.x.toFixed(1)} ${pb.y.toFixed(1)}`);
      byKind.set(e.kind, list);
    });
    for (const [kind, path] of this.edgePaths) path.setAttribute('d', (byKind.get(kind) ?? []).join(''));

    this.opts.nodes.forEach((n, i) => {
      const p = this.sim[i]!;
      const r = this.radiusOf(n);
      const c = this.circles[i]!;
      c.setAttribute('cx', p.x.toFixed(1));
      c.setAttribute('cy', p.y.toFixed(1));
      c.setAttribute('opacity', lit(i) ? '1' : '0.15');
      const ring = this.rings[i]!;
      ring.setAttribute('cx', p.x.toFixed(1));
      ring.setAttribute('cy', p.y.toFixed(1));
      ring.setAttribute('r', String(r + 5));
      ring.setAttribute('opacity', this.highlighted.has(i) ? '1' : '0');
      const t = this.labels[i]!;
      const mode = this.opts.kinds[n.kind]?.label ?? 'hover';
      const show =
        (lit(i) && focus !== null) || this.highlighted.has(i) || mode === 'always' || (mode === 'zoom' && cam.k >= (this.opts.labelZoom ?? 2));
      t.setAttribute('x', p.x.toFixed(1));
      t.setAttribute('y', (p.y + r + 13).toFixed(1));
      // Labels keep their size on screen whatever the zoom.
      t.setAttribute('font-size', (12 / cam.k).toFixed(2));
      t.setAttribute('opacity', show ? (lit(i) ? '1' : '0.25') : '0');
    });
  }

  private attachInput(svg: SVGSVGElement): void {
    const el = this.el;
    el.style.touchAction = 'none';
    const pointers = new Map<number, { x: number; y: number }>();
    let drag: { node: number | null; moved: boolean; last: { x: number; y: number } } | null = null;
    let pinch: { d: number } | null = null;

    const world = (sx: number, sy: number) => ({ x: (sx - this.camera.tx) / this.camera.k, y: (sy - this.camera.ty) / this.camera.k });
    const nodeAt = (target: EventTarget | null) => {
      const i = this.circles.indexOf(target as SVGCircleElement);
      return i >= 0 ? i : null;
    };

    const down = (e: PointerEvent) => {
      const p = toSceneCoords(svg, e.clientX, e.clientY);
      pointers.set(e.pointerId, p);
      el.setPointerCapture(e.pointerId);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a!.x - b!.x, a!.y - b!.y) };
        drag = null;
        return;
      }
      const node = nodeAt(e.target);
      drag = { node, moved: false, last: p };
      if (node !== null) {
        this.sim[node]!.fixed = true;
        this.reheat(0.3);
      }
      this.cameraTarget = null;
    };

    const move = (e: PointerEvent) => {
      const p = toSceneCoords(svg, e.clientX, e.clientY);
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        Object.assign(this.camera, zoomAt(this.camera, (a!.x + b!.x) / 2, (a!.y + b!.y) / 2, d / (pinch.d || d)));
        pinch.d = d;
        this.dirty = true;
        this.paint();
        return;
      }
      if (drag) {
        if (Math.hypot(p.x - drag.last.x, p.y - drag.last.y) > 3) drag.moved = true;
        if (drag.node !== null) {
          const w = world(p.x, p.y);
          const s = this.sim[drag.node]!;
          s.x = w.x;
          s.y = w.y;
          this.reheat(0.3);
        } else {
          this.camera.tx += p.x - drag.last.x;
          this.camera.ty += p.y - drag.last.y;
        }
        drag.last = p;
        this.dirty = true;
        this.paint();
        return;
      }
      // Hover (no button down).
      const node = nodeAt(e.target);
      if (node !== this.hovered) {
        this.hovered = node;
        this.dirty = true;
        this.opts.onHover?.(node === null ? null : this.opts.nodes[node]!);
        if (!(this.scene as SceneLike | null)?.playing) this.paint();
      }
    };

    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (!drag) return;
      if (drag.node !== null) {
        this.sim[drag.node]!.fixed = false;
        if (!drag.moved) this.opts.onOpen?.(this.opts.nodes[drag.node]!);
      }
      drag = null;
    };

    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = toSceneCoords(svg, e.clientX, e.clientY);
      this.cameraTarget = null;
      Object.assign(this.camera, zoomAt(this.camera, p.x, p.y, Math.exp(-e.deltaY * 0.0015)));
      this.dirty = true;
      this.paint();
    };

    const leave = () => {
      if (drag) return;
      this.hovered = null;
      this.dirty = true;
      this.opts.onHover?.(null);
      this.paint();
    };

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', leave);
    el.addEventListener('wheel', wheel, { passive: false });
    this.onCleanup(() => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('pointerleave', leave);
      el.removeEventListener('wheel', wheel);
    });
  }
}
