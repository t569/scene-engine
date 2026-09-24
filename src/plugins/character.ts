/**
 * A character with emotions — the engine's second plugin.
 *
 * Opt-in: `@t569/scene-engine/character`. Like the DiceBear plugin it takes
 * SVG **markup**, from a function you supply, so the engine still depends on
 * nothing: DiceBear, a hand-drawn face or anything else that returns an `<svg>`
 * string can be the character.
 *
 * Emotion is two things. The **face** is whatever `render(emotion)` returns,
 * swapped in place. The **motion** is a row of the table below — breath, bob,
 * tilt, shake, lean — whose amplitudes and rates are *eased* toward the new
 * row rather than jumped to, so a change of mood reads as a gesture winding
 * down into another, never a cut. That table, and the lesson that each row
 * needs one dominant channel far from the others, come from Quickuder's
 * shopping assistant, where six gentle variations on one sine all looked like
 * the same animation.
 */
import { BaseObject, approach } from '../objects.ts';
import type { BaseNodeSpec } from '../types.ts';
import { dicebearElement } from './dicebear.ts';

export interface Motion {
  /** Scale oscillation — the breath. */
  breath: number;
  breathRate: number;
  /** Vertical bob, scene units — nodding. */
  bob: number;
  bobRate: number;
  /** Rotation sway, degrees — cocking the head. */
  tilt: number;
  tiltRate: number;
  /** Horizontal shake, scene units — shaking the head. */
  shake: number;
  shakeRate: number;
  /** Constant scale offset — leaning in (+) or drawing back (−). */
  lean: number;
  /** Constant rotation, degrees — a head that droops. */
  angle: number;
  opacity: number;
}

export const STILL: Motion = {
  breath: 0,
  breathRate: 0,
  bob: 0,
  bobRate: 0,
  tilt: 0,
  tiltRate: 0,
  shake: 0,
  shakeRate: 0,
  lean: 0,
  angle: 0,
  opacity: 1,
};

/**
 * One row per emotion, each with **one dominant channel**, far apart in both
 * amplitude and frequency. The first six are Quickuder's shopping assistant,
 * kept verbatim so it migrates without a visual change; the rest are for a
 * conversational character.
 */
export const EMOTIONS: Record<string, Motion> = {
  // Barely there. Everything else has to read as "something changed".
  idle: { ...STILL, breath: 0.025, breathRate: 0.55 },
  // Dominant: tilt. Head cocks side to side, slow and wide — pondering.
  thinking: { ...STILL, breath: 0.012, breathRate: 2.4, tilt: 13, tiltRate: 1.25, bob: 2, bobRate: 0.8 },
  // Dominant: lean. Comes right up to the glass and holds.
  awaiting_approval: { ...STILL, lean: 0.2, breath: 0.022, breathRate: 1.15, tilt: 3, tiltRate: 0.45 },
  // Dominant: bob. A fast, unmistakable yes-nod.
  syncing: { ...STILL, bob: 10, bobRate: 3.3, lean: 0.07, breath: 0.05, breathRate: 3.3 },
  // Dominant: shake. Fast side-to-side no, pulling back slightly.
  error: { ...STILL, shake: 8, shakeRate: 5.8, tilt: 9, tiltRate: 5.8, lean: -0.1 },
  // Dominant: retreat. Draws back, dims, drifts — handing over.
  escalated: { ...STILL, lean: -0.16, opacity: 0.5, bob: 3, bobRate: 0.42, tilt: 5, tiltRate: 0.3 },

  // Dominant: a small forward lean and a patient sway — attending to you.
  listening: { ...STILL, lean: 0.08, breath: 0.018, breathRate: 0.8, tilt: 5, tiltRate: 0.3 },
  // Dominant: a quick, shallow bob in speech rhythm.
  speaking: { ...STILL, bob: 2.5, bobRate: 4.2, breath: 0.03, breathRate: 2.1, tilt: 2, tiltRate: 0.9 },
  // The nod, without the lean-in: pleased rather than busy.
  happy: { ...STILL, bob: 6, bobRate: 2.2, breath: 0.04, breathRate: 2.2, tilt: 4, tiltRate: 1.1 },
  // Dominant: slow, deep breath, head drooped, dimmed. A backend waking up.
  sleeping: { ...STILL, breath: 0.05, breathRate: 0.22, lean: -0.06, angle: -9, opacity: 0.72 },
};

const KEYS = Object.keys(STILL) as Array<keyof Motion>;

/** Ease every channel of `current` toward `target`. Returns a new motion. */
export function easeMotion(current: Motion, target: Motion, dt: number, rate = 5): Motion {
  const next = { ...current };
  for (const k of KEYS) next[k] = approach(current[k], target[k], rate, dt);
  return next;
}

export interface Pose {
  dx: number;
  dy: number;
  scale: number;
  rotation: number;
  opacity: number;
}

/** Where a motion puts the character at `elapsed`, as offsets from rest. Pure. */
export function pose(m: Motion, elapsed: number): Pose {
  const wave = (rate: number) => Math.sin(elapsed * rate * Math.PI * 2);
  return {
    dx: m.shake * wave(m.shakeRate),
    dy: m.bob * wave(m.bobRate),
    scale: 1 + m.lean + m.breath * wave(m.breathRate),
    rotation: m.angle + m.tilt * wave(m.tiltRate),
    opacity: m.opacity,
  };
}

export interface CharacterOptions extends BaseNodeSpec {
  /** Width and height of the face, in scene units. */
  size: number;
  /** Emotion → `<svg>` markup. Called once per distinct emotion; results are cached. */
  render: (emotion: string) => string;
  emotion?: string;
  /** Extra or replacement rows, merged over `EMOTIONS`. */
  motions?: Record<string, Motion>;
}

export class CharacterNode extends BaseObject {
  private emotionName: string;
  private readonly motions: Record<string, Motion>;
  private readonly render: (emotion: string) => string;
  private readonly size: number;
  private readonly faces = new Map<string, string>();
  private readonly baseX: number;
  private readonly baseY: number;
  private current: Motion;

  constructor(options: CharacterOptions) {
    super(null, options);
    this.size = options.size;
    this.render = options.render;
    this.motions = { ...EMOTIONS, ...options.motions };
    this.emotionName = options.emotion ?? 'idle';
    // `onUpdate` writes x/y every frame, so rest position is kept apart and
    // the motion added to it — assigning the wiggle straight into x/y parks
    // the character at the scene origin on the first frame.
    this.baseX = this.x;
    this.baseY = this.y;
    this.current = { ...this.motionFor(this.emotionName) };
    this.el.appendChild(this.face(this.emotionName));
  }

  get emotion(): string {
    return this.emotionName;
  }

  /**
   * Change mood. The face swaps now; the motion eases over the next frames,
   * so a character mid-nod winds down into the new gesture. Unknown emotions
   * move like `idle` but are still passed to `render`.
   */
  setEmotion(emotion: string): void {
    if (emotion === this.emotionName) return;
    try {
      this.el.replaceChildren(this.face(emotion));
      this.emotionName = emotion;
    } catch (err) {
      // Keep the previous face rather than blank the character mid-conversation.
      console.error('[CharacterNode] could not render emotion', emotion, err);
    }
  }

  private motionFor(emotion: string): Motion {
    return this.motions[emotion] ?? this.motions.idle ?? STILL;
  }

  private face(emotion: string): SVGElement {
    let markup = this.faces.get(emotion);
    if (markup === undefined) {
      markup = this.render(emotion);
      this.faces.set(emotion, markup);
    }
    return dicebearElement(markup, { width: this.size, height: this.size });
  }

  override onUpdate(dt: number, elapsed: number): void {
    super.onUpdate(dt, elapsed);
    this.current = easeMotion(this.current, this.motionFor(this.emotionName), dt);
    const p = pose(this.current, elapsed);
    this.x = this.baseX + p.dx;
    this.y = this.baseY + p.dy;
    // Scale is set outright and the hover target pinned to it: BaseObject's
    // own ease would low-pass a 4Hz breath into a flat line.
    this.scale = this.scaleTarget = p.scale;
    this.rotation = p.rotation;
    this.opacity = p.opacity;
  }
}
