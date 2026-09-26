import type { AnimatableProp, AnimateSpec, EaseName, Segment } from './types.ts';

/**
 * Keyframed animation as a pure function of time.
 *
 * This is the engine's answer to Manim's `play()`, with one deliberate
 * difference: nothing here accumulates. The value of a property at time `t` is
 * computed from `t` and the segments alone, never from the previous frame, so
 * `scene.seek(t)` — scrolling to a point in an explanation, scrubbing an ad in
 * an editor, rendering frame 900 of an export — costs the same as playing.
 */

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/**
 * Manim's `smooth`: a sigmoid, rescaled so it passes exactly through 0 and 1.
 * Its default rate function, and ours. Adapted from ManimCommunity/manim,
 * `manim/utils/rate_functions.py` (MIT).
 */
function smooth(t: number, inflection = 10): number {
  const error = sigmoid(-inflection / 2);
  return Math.min(Math.max((sigmoid(inflection * (t - 0.5)) - error) / (1 - 2 * error), 0), 1);
}

/**
 * Easing curves on [0, 1]. Every curve starts at 0; most end at 1, except
 * `thereAndBack` and `wiggle`, which return to 0 — a segment using them goes
 * to `to` and comes back, the shape of a pulse or a shake.
 *
 * Names from two traditions: Manim's rate functions (`smooth`, `rushInto`,
 * `rushFrom`, `thereAndBack`, `wiggle`) and the usual CSS/Penner curves.
 * `step` is Blender's CONSTANT interpolation: hold, then jump at the end.
 */
export const EASES: Record<EaseName, (x: number) => number> = {
  smooth: (x) => smooth(x),
  linear: (x) => x,
  step: (x) => (x < 1 ? 0 : 1),
  rushInto: (x) => 2 * smooth(x / 2),
  rushFrom: (x) => 2 * smooth(x / 2 + 0.5) - 1,
  thereAndBack: (x) => smooth(x < 0.5 ? 2 * x : 2 * (1 - x)),
  wiggle: (x) => smooth(x < 0.5 ? 2 * x : 2 * (1 - x)) * Math.sin(2 * Math.PI * x),
  in: (x) => x * x * x,
  out: (x) => 1 - (1 - x) ** 3,
  inOut: (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2),
  // Overshoots slightly and settles: the "pop" an ad headline wants.
  outBack: (x) => 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2,
  inOutSine: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
};

export const ANIMATABLE: readonly AnimatableProp[] = ['x', 'y', 'scale', 'rotation', 'opacity', 'draw'];

/**
 * The value a property has at `t`, given its segments (sorted by `at`) and the
 * value it starts from.
 *
 * Each segment starts from `from`, or else from wherever the previous ones left
 * the property — so a sequence reads like a script: "at 0 move to 100, at 2
 * move back to 0". Before its first segment a property holds `initial`; after
 * its last it holds the last `to`.
 */
export function sampleSegments(sorted: readonly Segment[], t: number, initial: number): number {
  let value = initial;
  for (const seg of sorted) {
    if (t < seg.at) break;
    const start = seg.from ?? value;
    const p = seg.dur > 0 ? Math.min(1, (t - seg.at) / seg.dur) : 1;
    value = start + (seg.to - start) * EASES[seg.ease ?? 'smooth'](p);
    // A segment still in progress is the answer; later ones haven't begun
    // from this one's end yet.
    if (p < 1) break;
  }
  return value;
}

/** Loop-aware local time: the clock the segments see. */
export function localTime(t: number, loop: number | undefined): number {
  if (!loop || loop <= 0) return t;
  return ((t % loop) + loop) % loop;
}

export type AnimatedValues = Partial<Record<AnimatableProp, number>>;

/**
 * Compile an `animate` block once (sorting its segments), and get back the
 * function to call every frame. It returns the same object each call,
 * overwritten: read it before the next call, don't keep it. One allocation per
 * node instead of one per node per frame.
 */
export function compileAnimate(
  spec: AnimateSpec,
  initial: AnimatedValues,
): (t: number) => AnimatedValues {
  const tracks = ANIMATABLE.flatMap((prop) => {
    const segs = spec[prop];
    if (!segs?.length) return [];
    return [[prop, [...segs].sort((a, b) => a.at - b.at)] as const];
  });

  const out: AnimatedValues = {};
  return (t) => {
    const lt = localTime(t, spec.loop);
    for (const [prop, segs] of tracks) {
      out[prop] = sampleSegments(segs, lt, initial[prop] ?? (prop === 'scale' || prop === 'opacity' ? 1 : 0));
    }
    return out;
  };
}
