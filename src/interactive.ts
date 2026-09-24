/**
 * The interactive layer's own nodes: live text, plots and sliders.
 *
 * Inspired by Brilliant's and Desmos's figures — the reader changes a number
 * and the picture answers at once. Everything here reads the scene's params
 * (see `params.ts`) through expressions (see `expr.ts`), so a whole interactive
 * can be written as JSON, by a person or a model, and still can't run code.
 *
 * Each node keeps its pure half exported and tested: `plotPath` and
 * `sliderValueAt` don't touch the DOM.
 */
import { BaseObject, toSceneCoords } from './objects.ts';
import { SVG_NS } from './scene.ts';
import type { Compiled, Env } from './expr.ts';
import type { BaseNodeSpec } from './types.ts';

/* ------------------------------------------------------------- live text */

/** A text node whose content is a template: `"a = {a:2}"`. Updates when the value does. */
export class TemplateText extends BaseObject {
  private last = '';

  constructor(
    private readonly textEl: SVGTextElement,
    private readonly render: (env: Env) => string,
    spec: BaseNodeSpec,
  ) {
    super(textEl, spec);
  }

  override onUpdate(dt: number, elapsed: number): void {
    super.onUpdate(dt, elapsed);
    const next = this.render(this.envAt(elapsed));
    if (next !== this.last) {
      this.textEl.textContent = next;
      this.last = next;
    }
  }
}

/* ------------------------------------------------------------------ plot */

export interface PlotBox {
  domain: [number, number];
  range: [number, number];
  width: number;
  height: number;
}

/**
 * y = f(x) over `domain`, as path data in a `width × height` box centred on
 * the origin (y up). Breaks the line where f is undefined, and clips it a
 * little past the box so a pole shoots off the edge instead of drawing a
 * vertical line through the plot. Pure.
 */
export function plotPath(f: Compiled, env: Record<string, number>, box: PlotBox, samples: number): string {
  const [x0, x1] = box.domain;
  const [y0, y1] = box.range;
  const sx = box.width / (x1 - x0 || 1);
  const sy = box.height / (y1 - y0 || 1);
  const margin = (y1 - y0) * 0.05;
  let d = '';
  let pen = false;
  for (let i = 0; i <= samples; i++) {
    const x = x0 + ((x1 - x0) * i) / samples;
    env.x = x;
    const y = f(env);
    if (!Number.isFinite(y) || y < y0 - margin || y > y1 + margin) {
      pen = false;
      continue;
    }
    const px = (x - x0) * sx - box.width / 2;
    const py = box.height / 2 - (y - y0) * sy;
    d += `${pen ? 'L' : 'M'}${Math.round(px * 10) / 10} ${Math.round(py * 10) / 10}`;
    pen = true;
  }
  return d;
}

export interface PlotOptions extends BaseNodeSpec, PlotBox {
  samples?: number;
  stroke?: string;
  strokeWidth?: number;
  /** Draw the axes (where x = 0 and y = 0 fall inside the box) and a faint frame. */
  axes?: boolean;
  axisColor?: string;
}

/** A graph that follows its expression — re-plotted when a param changes, or every frame if it uses `t`. */
export class PlotNode extends BaseObject {
  private readonly curve: SVGPathElement;
  private version = -1;

  constructor(
    private readonly f: Compiled,
    private readonly usesTime: boolean,
    private readonly opts: PlotOptions,
  ) {
    const g = document.createElementNS(SVG_NS, 'g');
    super(g, opts);
    if (opts.axes !== false) {
      const axes = document.createElementNS(SVG_NS, 'path');
      const { domain: [x0, x1], range: [y0, y1], width: w, height: h } = opts;
      let d = `M${-w / 2} ${-h / 2}h${w}v${h}h${-w}z`;
      if (y0 <= 0 && y1 >= 0) {
        const y = h / 2 - ((0 - y0) / (y1 - y0)) * h;
        d += `M${-w / 2} ${y}h${w}`;
      }
      if (x0 <= 0 && x1 >= 0) {
        const x = ((0 - x0) / (x1 - x0)) * w - w / 2;
        d += `M${x} ${-h / 2}v${h}`;
      }
      axes.setAttribute('d', d);
      axes.setAttribute('fill', 'none');
      axes.setAttribute('stroke', opts.axisColor ?? '#999999');
      axes.setAttribute('stroke-opacity', '0.5');
      axes.setAttribute('stroke-width', '1');
      g.appendChild(axes);
    }
    this.curve = document.createElementNS(SVG_NS, 'path');
    this.curve.setAttribute('fill', 'none');
    this.curve.setAttribute('stroke', opts.stroke ?? '#0B03EC');
    this.curve.setAttribute('stroke-width', String(opts.strokeWidth ?? 2));
    this.curve.setAttribute('stroke-linejoin', 'round');
    this.curve.setAttribute('stroke-linecap', 'round');
    g.appendChild(this.curve);
  }

  override onUpdate(dt: number, elapsed: number): void {
    super.onUpdate(dt, elapsed);
    const version = this.scene?.params.version ?? 0;
    if (!this.usesTime && version === this.version) return;
    this.version = version;
    const env = { ...this.envAt(elapsed) };
    this.curve.setAttribute('d', plotPath(this.f, env, this.opts, this.opts.samples ?? 240));
  }
}

/* ---------------------------------------------------------------- slider */

/** The param value under a point `localX` along a slider `width` wide, centred on 0. Pure. */
export function sliderValueAt(localX: number, width: number, [lo, hi]: [number, number]): number {
  const f = Math.min(1, Math.max(0, (localX + width / 2) / (width || 1)));
  return lo + f * (hi - lo);
}

export interface SliderOptions extends BaseNodeSpec {
  param: string;
  width: number;
  /** Knob and filled track. */
  color?: string;
  /** Unfilled track. */
  track?: string;
  /** Label colour. */
  textColor?: string;
}

/**
 * A slider drawn inside the scene, bound to a param. Drawn in SVG rather than
 * as an HTML input so it lives in the figure, scales with it and themes with
 * it, and so a JSON spec can place one.
 */
export class SliderNode extends BaseObject {
  private readonly fill: SVGLineElement;
  private readonly knob: SVGCircleElement;
  private readonly labelEl: SVGTextElement | null;
  private lastLabel = '';
  private version = -1;

  constructor(
    private readonly opts: SliderOptions,
    private readonly label: ((env: Env) => string) | null,
  ) {
    const g = document.createElementNS(SVG_NS, 'g');
    super(g, opts);
    const w = opts.width;
    const line = (color: string, width: number, opacity = 1) => {
      const el = document.createElementNS(SVG_NS, 'line');
      el.setAttribute('x1', String(-w / 2));
      el.setAttribute('x2', String(w / 2));
      el.setAttribute('stroke', color);
      el.setAttribute('stroke-width', String(width));
      el.setAttribute('stroke-linecap', 'round');
      el.setAttribute('stroke-opacity', String(opacity));
      return el;
    };
    // A generous invisible hit area: a 4px track is too thin to grab on a phone.
    const hit = document.createElementNS(SVG_NS, 'rect');
    hit.setAttribute('x', String(-w / 2 - 12));
    hit.setAttribute('y', '-16');
    hit.setAttribute('width', String(w + 24));
    hit.setAttribute('height', '32');
    hit.setAttribute('fill', 'transparent');
    this.fill = line(opts.color ?? '#0B03EC', 4);
    this.knob = document.createElementNS(SVG_NS, 'circle');
    this.knob.setAttribute('r', '9');
    this.knob.setAttribute('fill', opts.color ?? '#0B03EC');
    g.append(hit, line(opts.track ?? '#999999', 4, 0.35), this.fill, this.knob);
    if (label) {
      this.labelEl = document.createElementNS(SVG_NS, 'text');
      this.labelEl.setAttribute('x', String(-w / 2));
      this.labelEl.setAttribute('y', '-16');
      this.labelEl.setAttribute('font-size', '14');
      this.labelEl.setAttribute('fill', opts.textColor ?? '#111111');
      g.appendChild(this.labelEl);
    } else {
      this.labelEl = null;
    }
    g.style.cursor = 'pointer';
    g.style.touchAction = 'none';
  }

  override onMount(scene: import('./types.ts').SceneLike): void {
    super.onMount(scene);
    const el = this.el;
    const set = (e: PointerEvent) => {
      const p = toSceneCoords(scene.svg, e.clientX, e.clientY);
      const localX = (p.x - this.x) / (this.scale || 1);
      scene.params.set(this.opts.param, sliderValueAt(localX, this.opts.width, scene.params.range(this.opts.param)));
    };
    let dragging = false;
    const down = (e: PointerEvent) => {
      dragging = true;
      el.setPointerCapture(e.pointerId);
      set(e);
    };
    const move = (e: PointerEvent) => dragging && set(e);
    const up = (e: PointerEvent) => {
      dragging = false;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
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

  override onUpdate(dt: number, elapsed: number): void {
    super.onUpdate(dt, elapsed);
    const params = this.scene?.params;
    if (!params) return;
    if (params.version !== this.version) {
      this.version = params.version;
      const [lo, hi] = params.range(this.opts.param);
      const f = hi === lo ? 0 : (params.get(this.opts.param) - lo) / (hi - lo);
      const kx = -this.opts.width / 2 + f * this.opts.width;
      this.fill.setAttribute('x2', String(kx));
      this.knob.setAttribute('cx', String(kx));
    }
    if (this.label && this.labelEl) {
      const text = this.label(this.envAt(elapsed));
      if (text !== this.lastLabel) {
        this.labelEl.textContent = text;
        this.lastLabel = text;
      }
    }
  }
}
