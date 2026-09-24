/**
 * DiceBear as a scene node — the engine's first real plugin.
 *
 * Opt-in: imported from `@t569/scene-engine/dicebear`, never re-exported
 * from the core index, so importing `Scene` does not drag this in.
 *
 * It takes an SVG **string**, not a DiceBear instance, so this file imports
 * nothing from `@dicebear/*` and the engine keeps its empty `dependencies`.
 * The host decides how the markup was produced.
 *
 * Why this adapter is thinner than the spec's Rive sketch: DiceBear hands back
 * markup, not an engine with a loop of its own. There is no foreign rAF to take
 * ownership of — only a decision about whose clock animates it, which
 * `dicebearOptions` makes explicit.
 */
import { BaseObject } from '../objects.ts';
import type { BaseNodeSpec } from '../types.ts';

/** DiceBear's animation speeds. `none` renders a static character. */
export type AnimationVariant = 'none' | 'slowest' | 'slow' | 'medium' | 'fast' | 'fastest';

/** What we persist about a chosen avatar. Deterministic: same input, same SVG. */
export interface DicebearChoice {
  /** A style name as published by `@dicebear/styles`, e.g. `shapes`, `thumbs`. */
  style: string;
  /**
   * Anything stable and identifying. Declared loosely because the usual source
   * is a user id, and those arrive as numbers from plenty of backends — see the
   * coercion in `dicebearOptions`.
   */
  seed: string | number;
  animationVariant?: AnimationVariant;
}

export interface DicebearOptionsInput {
  /**
   * True when the SVG is going into a `Scene`.
   *
   * DiceBear's animation is CSS keyframes baked into the SVG, running on the
   * browser's compositor clock. Inside a scene that would be a *second* clock
   * beside `Scene.tick` — precisely the desync the engine exists to prevent —
   * so the character is forced static and the scene owns all motion.
   *
   * Outside a scene (a plain `<img>` avatar) there is no clock to conflict
   * with, and the embedded loop is exactly what you want.
   */
  inScene: boolean;
  size?: number;
}

/**
 * `DicebearChoice` -> the options object to hand `new Avatar(style, options)`.
 *
 * Pure, so this is the part worth a test; the DOM half below is a two-line
 * parse that fails loudly.
 */
export function dicebearOptions(
  choice: DicebearChoice,
  { inScene, size }: DicebearOptionsInput,
): { seed: string; size?: number; animationVariant: AnimationVariant } {
  return {
    // Coerced, not trusted. DiceBear validates its options against a JSON Schema
    // and throws `OptionsValidationError: /seed has an invalid type` on a number
    // — which, thrown from a render, takes the whole React tree down. A numeric
    // id is the single most likely seed anyone will pass, so it is handled here,
    // at the one point every caller funnels through, rather than at each of them.
    seed: String(choice.seed),
    ...(size === undefined ? {} : { size }),
    animationVariant: inScene ? 'none' : (choice.animationVariant ?? 'medium'),
  };
}

export class DicebearNodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DicebearNodeError';
  }
}

export interface DicebearBox {
  /** Size to draw the character at, in scene units. */
  width: number;
  height: number;
}

/**
 * Parse a DiceBear SVG string into an element ready to drop into a scene node.
 *
 * Separate from `dicebearNode` so a caller with its own `BaseObject` subclass —
 * one that animates the character from some state of its own — can use it
 * without building a node just to discard it.
 */
export function dicebearElement(svg: string, box: DicebearBox): SVGElement {
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');

  // parseFromString reports malformed input as a <parsererror> document rather
  // than throwing, so a bad string would otherwise mount as an invisible node.
  const failure = parsed.querySelector('parsererror');
  if (failure) throw new DicebearNodeError(`could not parse SVG: ${failure.textContent?.trim()}`);

  const root = parsed.documentElement;
  if (root.tagName.toLowerCase() !== 'svg') {
    throw new DicebearNodeError(`expected an <svg> root, got <${root.tagName}>`);
  }

  // A nested <svg> is a legal SVG element with its own viewport, so DiceBear's
  // markup keeps its own coordinate system and we only position the box.
  // Centred on the node's origin so `rotation`/`scale` pivot about the middle,
  // matching `rect()` and `circle()`.
  const el = document.importNode(root, true) as unknown as SVGElement;
  el.setAttribute('x', String(-box.width / 2));
  el.setAttribute('y', String(-box.height / 2));
  el.setAttribute('width', String(box.width));
  el.setAttribute('height', String(box.height));
  el.setAttribute('overflow', 'visible');
  return el;
}

/**
 * Adopt a DiceBear SVG string as a scene object.
 *
 * The result is an ordinary `BaseObject`: the scene transforms it, and the
 * caller drives `x`/`scale`/`rotation` exactly as with a native shape.
 */
export function dicebearNode(
  svg: string,
  spec: BaseNodeSpec & DicebearBox,
): BaseObject {
  return new BaseObject(dicebearElement(svg, spec), spec);
}
