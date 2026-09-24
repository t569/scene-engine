import { SVG_NS } from './scene.js';
import { compileAnimate, type AnimatedValues } from './timeline.js';
import type {
  BaseNodeSpec,
  CircleSpec,
  PathSpec,
  PolylineSpec,
  RectSpec,
  SceneLike,
  SceneNode,
  StrokeSpec,
  TextSpec,
  Vec2,
} from './types.js';

/**
 * Frame-rate-independent easing: move `current` toward `target` at `rate`
 * (roughly "e-folds per second"), given a frame of `dt` seconds.
 *
 * The tempting version is `current += (target - current) * 0.2` per frame,
 * which silently eases twice as fast on a 120Hz display as on a 60Hz one and
 * behaves differently again after a stalled frame. The exponential form is the
 * same amount of code and is correct for any `dt` — `scene.test.ts` pins that.
 */
export function approach(current: number, target: number, rate: number, dt: number): number {
  if (dt <= 0) return current;
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

/** How fast `hover_scale` eases. Tuned by eye; a node can override it. */
const HOVER_RATE = 14;

/**
 * A thing in the scene.
 *
 * Concrete, not abstract: it wraps a transform `<g>` around one child element
 * that the caller supplies. Shapes are therefore plain factory functions, not
 * a subclass each. Subclass only when you need behaviour — which is exactly
 * what an external-engine adapter does: extend this, keep a handle on the
 * foreign instance, and advance it inside `onUpdate`.
 */
export class BaseObject implements SceneNode {
  readonly el: SVGGElement;

  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;

  /**
   * Where `scale` is easing to. Equal to `scale` unless something — the
   * `hover_scale` preset, or your own code — has pulled it away.
   */
  scaleTarget: number;
  scaleRate = HOVER_RATE;

  /**
   * Stroke reveal, 0–1, or `undefined` for a node that isn't drawable. Only
   * meaningful on an element built with `pathLength="1"` — the factories do
   * that whenever the spec sets `draw` or animates it.
   */
  draw: number | undefined;

  private readonly child: SVGElement | null;
  private readonly animation: ((t: number) => AnimatedValues) | null;

  scene: SceneLike | null = null;

  private readonly cleanups: Array<() => void> = [];

  constructor(child: SVGElement | null, spec: BaseNodeSpec = {}) {
    this.el = document.createElementNS(SVG_NS, 'g');
    if (child) this.el.appendChild(child);

    this.x = spec.x ?? 0;
    this.y = spec.y ?? 0;
    this.scale = spec.scale ?? 1;
    this.rotation = spec.rotation ?? 0;
    this.opacity = spec.opacity ?? 1;
    this.scaleTarget = this.scale;
    this.child = child;
    const drawn = spec as StrokeSpec;
    this.draw = drawn.draw ?? (spec.animate?.draw ? 0 : undefined);
    this.animation = spec.animate
      ? compileAnimate(spec.animate, {
          x: this.x,
          y: this.y,
          scale: this.scale,
          rotation: this.rotation,
          opacity: this.opacity,
          draw: this.draw ?? 0,
        })
      : null;
  }

  /** Register a teardown to run on `scene.remove(this)` / `scene.destroy()`. */
  onCleanup(fn: () => void): void {
    this.cleanups.push(fn);
  }

  onMount(scene: SceneLike): void {
    this.scene = scene;
  }

  /**
   * Subclasses that override this must call `super.onUpdate(dt, elapsed)`, or
   * presets driven by the clock (`hover_scale`) silently stop easing.
   */
  onUpdate(dt: number, elapsed: number): void {
    this.scale = approach(this.scale, this.scaleTarget, this.scaleRate, dt);
    if (!this.animation) return;
    // Keyframes win over presets for the properties they name: a spec that
    // animates `scale` has said what the scale is.
    const v = this.animation(elapsed);
    if (v.x !== undefined) this.x = v.x;
    if (v.y !== undefined) this.y = v.y;
    if (v.scale !== undefined) this.scale = this.scaleTarget = v.scale;
    if (v.rotation !== undefined) this.rotation = v.rotation;
    if (v.opacity !== undefined) this.opacity = v.opacity;
    if (v.draw !== undefined) this.draw = v.draw;
  }

  onDestroy(): void {
    for (const fn of this.cleanups) fn();
    this.cleanups.length = 0;
    this.scene = null;
  }

  applyTransform(): void {
    this.el.setAttribute(
      'transform',
      `translate(${this.x} ${this.y}) rotate(${this.rotation}) scale(${this.scale})`,
    );
    this.el.setAttribute('opacity', String(this.opacity));
    if (this.draw !== undefined && this.child) {
      // With pathLength="1", a dash of `draw` followed by a gap of 1 shows
      // exactly that fraction of the outline.
      this.child.setAttribute('stroke-dasharray', `${Math.max(0, Math.min(1, this.draw))} 1`);
    }
  }
}

/* ------------------------------------------------------------------ shapes */

export function rect(spec: RectSpec): SVGElement {
  const el = document.createElementNS(SVG_NS, 'rect');
  // Centred on the node's own origin, so `rotation` and `scale` pivot about
  // the middle rather than the top-left corner, which is what people expect.
  el.setAttribute('x', String(-spec.width / 2));
  el.setAttribute('y', String(-spec.height / 2));
  el.setAttribute('width', String(spec.width));
  el.setAttribute('height', String(spec.height));
  if (spec.rx !== undefined) el.setAttribute('rx', String(spec.rx));
  el.setAttribute('fill', spec.fill ?? '#0B03EC');
  applyStroke(el, spec, spec);
  return el;
}

export function circle(spec: CircleSpec): SVGElement {
  const el = document.createElementNS(SVG_NS, 'circle');
  el.setAttribute('r', String(spec.radius));
  el.setAttribute('fill', spec.fill ?? '#0B03EC');
  applyStroke(el, spec, spec);
  return el;
}

/** Stroke attributes, and `pathLength="1"` when the node is drawable. */
function applyStroke(el: SVGElement, stroke: StrokeSpec, base: BaseNodeSpec): void {
  if (stroke.stroke) el.setAttribute('stroke', stroke.stroke);
  if (stroke.strokeWidth !== undefined) el.setAttribute('stroke-width', String(stroke.strokeWidth));
  if (stroke.draw !== undefined || base.animate?.draw) {
    el.setAttribute('pathLength', '1');
    el.setAttribute('stroke-dasharray', `${stroke.draw ?? 0} 1`);
  }
  el.setAttribute('stroke-linecap', 'round');
  el.setAttribute('stroke-linejoin', 'round');
}

export function path(spec: PathSpec): SVGElement {
  const el = document.createElementNS(SVG_NS, 'path');
  el.setAttribute('d', spec.d);
  el.setAttribute('fill', spec.fill ?? 'none');
  applyStroke(el, { stroke: '#111111', ...spec }, spec);
  return el;
}

export function polyline(spec: PolylineSpec): SVGElement {
  const el = document.createElementNS(SVG_NS, spec.closed ? 'polygon' : 'polyline');
  el.setAttribute('points', spec.points.map(([x, y]) => `${x},${y}`).join(' '));
  el.setAttribute('fill', spec.fill ?? 'none');
  applyStroke(el, { stroke: '#111111', ...spec }, spec);
  return el;
}

export function text(spec: TextSpec, fontFamily?: string): SVGElement {
  const el = document.createElementNS(SVG_NS, 'text');
  el.textContent = spec.text;
  el.setAttribute('fill', spec.fill ?? '#111111');
  el.setAttribute('font-size', String(spec.fontSize ?? 16));
  el.setAttribute('text-anchor', 'middle');
  el.setAttribute('dominant-baseline', 'middle');
  if (fontFamily) el.setAttribute('font-family', fontFamily);
  return el;
}

/* ----------------------------------------------------------------- presets */

/**
 * Screen coordinates to scene (`viewBox`) coordinates.
 *
 * Going through the CTM is not optional. The svg is sized `100%`, so the
 * moment its box is any size other than `width x height` the two coordinate
 * systems diverge and raw `clientX/Y` deltas drift away from the cursor.
 */
export function toSceneCoords(svg: SVGSVGElement, clientX: number, clientY: number): Vec2 {
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: clientX, y: clientY }; // detached svg; nothing better to say
  const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}

/** Reads the high-level flags off a spec and wires the real behaviour. */
export function applyPresets(obj: BaseObject, spec: BaseNodeSpec, svg: SVGSVGElement): void {
  if (spec.draggable) makeDraggable(obj, svg);
  if (spec.hover_scale !== undefined) makeHoverScale(obj, spec.hover_scale);
}

function makeDraggable(obj: BaseObject, svg: SVGSVGElement): void {
  const el = obj.el;
  el.style.cursor = 'grab';
  el.style.touchAction = 'none';

  // Offset from the node's origin to where the pointer actually grabbed it,
  // so the node doesn't snap its centre to the cursor on pointerdown.
  let grab: Vec2 | null = null;

  const down = (e: PointerEvent): void => {
    const p = toSceneCoords(svg, e.clientX, e.clientY);
    grab = { x: p.x - obj.x, y: p.y - obj.y };
    el.setPointerCapture(e.pointerId);
    el.style.cursor = 'grabbing';
  };

  const move = (e: PointerEvent): void => {
    if (!grab) return;
    const p = toSceneCoords(svg, e.clientX, e.clientY);
    obj.x = p.x - grab.x;
    obj.y = p.y - grab.y;
  };

  const up = (e: PointerEvent): void => {
    if (!grab) return;
    grab = null;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    el.style.cursor = 'grab';
  };

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);

  obj.onCleanup(() => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
  });
}

function makeHoverScale(obj: BaseObject, hovered: number): void {
  const el = obj.el;
  const resting = obj.scale;

  // The preset only ever moves the *target*. The easing itself happens in
  // `BaseObject.onUpdate`, on the scene's clock — deliberately not a CSS
  // transition, so a hover stays in lockstep with everything else the frame is
  // doing, including whatever a plugin is advancing beside it.
  const enter = (): void => {
    obj.scaleTarget = hovered;
  };
  const leave = (): void => {
    obj.scaleTarget = resting;
  };

  el.addEventListener('pointerenter', enter);
  el.addEventListener('pointerleave', leave);

  obj.onCleanup(() => {
    el.removeEventListener('pointerenter', enter);
    el.removeEventListener('pointerleave', leave);
  });
}
