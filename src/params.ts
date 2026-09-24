/**
 * The knobs of an interactive scene.
 *
 * A scene declares named parameters — `a` from 0 to 5 in steps of 0.1 — and
 * everything that should respond reads them: bindings, plots, readouts,
 * visibility. Sliders and draggable handles write them. One store, so a drag
 * on one control moves every other thing that depends on it, the way a
 * Brilliant or Desmos figure does.
 */

export interface ParamSpec {
  value: number;
  min?: number;
  max?: number;
  /** Snap to multiples of this, counted from `min` (or 0). */
  step?: number;
  /** For a slider's label when none is given. */
  label?: string;
}

export class Params {
  /** Current values, as a plain object — the environment expressions read. */
  readonly values: Record<string, number> = Object.create(null);
  /** Increments on every change; nodes compare it to skip recomputing. */
  version = 0;

  private readonly defs = new Map<string, ParamSpec>();
  private readonly listeners = new Set<(name: string, value: number) => void>();

  constructor(defs: Record<string, ParamSpec> = {}) {
    for (const [name, def] of Object.entries(defs)) {
      this.defs.set(name, def);
      this.values[name] = this.normalise(name, def.value);
    }
  }

  names(): string[] {
    return [...this.defs.keys()];
  }

  has(name: string): boolean {
    return this.defs.has(name);
  }

  spec(name: string): ParamSpec | undefined {
    return this.defs.get(name);
  }

  get(name: string): number {
    return this.values[name] ?? NaN;
  }

  /** [min, max], defaulting to a window around the starting value when unset. */
  range(name: string): [number, number] {
    const d = this.defs.get(name);
    if (!d) return [0, 1];
    const lo = d.min ?? Math.min(0, d.value);
    const hi = d.max ?? Math.max(lo + 1, d.value * 2 || 1);
    return [lo, hi];
  }

  /** Clamp to the range and snap to the step. */
  normalise(name: string, v: number): number {
    const d = this.defs.get(name);
    if (!d || !Number.isFinite(v)) return d?.value ?? 0;
    const [lo, hi] = [d.min ?? -Infinity, d.max ?? Infinity];
    let out = Math.min(hi, Math.max(lo, v));
    if (d.step && d.step > 0) {
      const base = d.min ?? 0;
      out = base + Math.round((out - base) / d.step) * d.step;
      // Snapping can step past the max; and floats drift — round to the step's precision.
      out = Math.min(hi, Math.max(lo, out));
      const decimals = (String(d.step).split('.')[1] ?? '').length;
      out = Number(out.toFixed(decimals));
    }
    return out;
  }

  /** Set a value (clamped and snapped). Returns true if it changed. */
  set(name: string, v: number): boolean {
    if (!this.defs.has(name)) return false;
    const next = this.normalise(name, v);
    if (next === this.values[name]) return false;
    this.values[name] = next;
    this.version++;
    for (const fn of this.listeners) fn(name, next);
    return true;
  }

  /** Listen for changes. Returns the unsubscribe. */
  on(fn: (name: string, value: number) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
