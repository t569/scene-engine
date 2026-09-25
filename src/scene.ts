import { Params } from './params.ts';
import type { SceneLike, SceneNode, SceneSpec } from './types.ts';

export const SVG_NS = 'http://www.w3.org/2000/svg';

/** Longest frame the clock will admit, in seconds. See `clampDelta`. */
export const MAX_DELTA = 0.1;

/**
 * Milliseconds between rAF callbacks -> seconds, clamped.
 *
 * A backgrounded tab stops firing rAF; on refocus the first gap can be
 * several seconds. Fed through unclamped, every velocity-integrating object
 * jumps a screen-width in one frame and the scene visibly teleports. Capping
 * at `MAX_DELTA` makes a long stall look like a slow frame instead — the
 * scene falls behind wall-clock time, which nobody notices, rather than
 * exploding, which everybody does.
 */
export function clampDelta(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.min(ms / 1000, MAX_DELTA);
}

/**
 * The clock master.
 *
 * One `requestAnimationFrame` loop for the entire scene. Objects never own a
 * loop, a timer or a CSS transition — they get `onUpdate(dt, elapsed)` from
 * here and nothing else. That is what lets a plugin advancing a third-party
 * engine stay frame-exact with the native nodes beside it.
 */
export class Scene implements SceneLike {
  readonly svg: SVGSVGElement;
  readonly width: number;
  readonly height: number;

  /** Seconds since `start()`, advanced by clamped deltas — not wall clock. */
  elapsed = 0;

  /**
   * The scene's knobs. A change repaints a scene that isn't playing (reduced
   * motion, a scrubbed explainer), so a slider always answers.
   */
  readonly params: Params;

  private readonly nodes: SceneNode[] = [];
  private readonly ids = new Map<string, SceneNode>();
  private raf = 0;
  private last = 0;

  constructor(spec: Pick<SceneSpec, 'width' | 'height' | 'background' | 'params'>, mount: Element) {
    this.width = spec.width;
    this.height = spec.height;
    this.params = new Params(spec.params ?? {});
    this.params.on(() => {
      if (!this.raf) this.seek(this.elapsed);
    });

    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('viewBox', `0 0 ${spec.width} ${spec.height}`);
    this.svg.setAttribute('width', '100%');
    this.svg.setAttribute('height', '100%');
    // Presets rely on pointer events reaching nodes; `touch-action: none` stops
    // the browser claiming a drag as a scroll gesture on touch devices.
    this.svg.style.touchAction = 'none';
    if (spec.background) this.svg.style.background = spec.background;

    mount.appendChild(this.svg);
  }

  /**
   * Append order is paint order — that is the whole implementation of the
   * schema's implicit z-index. No sorting, no `z` field, no bookkeeping.
   */
  add<T extends SceneNode>(node: T, id?: string): T {
    this.nodes.push(node);
    this.svg.appendChild(node.el);
    if (id) this.ids.set(id, node);
    node.onMount?.(this);
    return node;
  }

  remove(node: SceneNode): void {
    const i = this.nodes.indexOf(node);
    if (i === -1) return;
    this.nodes.splice(i, 1);
    node.el.remove();
    for (const [id, n] of this.ids) if (n === node) this.ids.delete(id);
    node.onDestroy?.();
  }

  find(id: string): SceneNode | undefined {
    return this.ids.get(id);
  }

  get playing(): boolean {
    return this.raf !== 0;
  }

  start(): void {
    if (this.raf) return;
    this.last = 0;
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    if (!this.raf) return;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /**
   * Jump to time `t` and paint that frame, playing or not.
   *
   * This is what lets something other than the rAF loop own time: a scroll
   * position, a scrubber, an exporter stepping frame by frame. Nodes receive
   * `dt = 0` and `elapsed = t`, so anything written as a function of `elapsed`
   * — `animate` keyframes, `spin`, a sine in your own `onUpdate` — lands
   * exactly. Something that integrates `dt` (a velocity, a physics step) has
   * no defined position at an arbitrary `t` and simply holds still.
   */
  seek(t: number): void {
    this.elapsed = Math.max(0, t);
    for (const node of this.nodes) {
      node.onUpdate?.(0, this.elapsed);
      node.applyTransform();
    }
  }

  destroy(): void {
    this.stop();
    for (const node of [...this.nodes]) this.remove(node);
    this.svg.remove();
  }

  private readonly tick = (now: number): void => {
    // First frame after start/resume has no previous timestamp, so dt is 0 —
    // objects render at their current state and integrate from the next one.
    const dt = this.last ? clampDelta(now - this.last) : 0;
    this.last = now;
    this.elapsed += dt;

    for (const node of this.nodes) {
      node.onUpdate?.(dt, this.elapsed);
      // Cheap to call every frame: nodes dirty-check, so one that didn't move writes nothing.
      node.applyTransform();
    }

    this.raf = requestAnimationFrame(this.tick);
  };
}
