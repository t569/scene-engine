import { describe, expect, it } from 'vitest';
import { clampDelta, MAX_DELTA } from './scene.ts';
import { approach } from './objects.ts';
import { SceneSpecError, validateSceneSpec } from './parse.ts';

// Three asserts, no DOM, no jsdom. Everything with a real failure mode in this
// engine is either clock arithmetic or schema validation, and neither needs a
// document — so the test suite doesn't pull one in.

describe('clampDelta', () => {
  it('caps a backgrounded-tab gap instead of letting the scene teleport', () => {
    expect(clampDelta(5000)).toBe(MAX_DELTA);
  });

  it('passes an ordinary frame through in seconds', () => {
    expect(clampDelta(16.7)).toBeCloseTo(0.0167, 6);
  });

  it('treats a non-advancing or bogus timestamp as no time passing', () => {
    expect(clampDelta(0)).toBe(0);
    expect(clampDelta(-1)).toBe(0);
    expect(clampDelta(Number.NaN)).toBe(0);
  });
});

describe('approach', () => {
  it('lands in the same place whatever the frame rate', () => {
    // This is the invariant that dies the moment someone "simplifies" the
    // easing back to a fixed `* 0.2` per frame: one 16ms frame must equal two
    // 8ms frames, or a 120Hz display animates at twice the speed of a 60Hz one.
    const oneBigFrame = approach(0, 1, 5, 0.016);

    let twoSmallFrames = approach(0, 1, 5, 0.008);
    twoSmallFrames = approach(twoSmallFrames, 1, 5, 0.008);

    expect(twoSmallFrames).toBeCloseTo(oneBigFrame, 12);
  });

  it('does not move on a zero-length frame', () => {
    expect(approach(0, 1, 5, 0)).toBe(0);
  });
});

describe('validateSceneSpec', () => {
  const ok = { width: 100, height: 100, objects: [{ type: 'rect', width: 10, height: 10 }] };

  it('accepts a well-formed scene', () => {
    expect(() => validateSceneSpec(ok)).not.toThrow();
  });

  it('names the offending path when a node type is unknown', () => {
    const bad = { ...ok, objects: [{ type: 'hexagon' }] };
    expect(() => validateSceneSpec(bad)).toThrow(SceneSpecError);
    expect(() => validateSceneSpec(bad)).toThrow(/objects\[0\].*hexagon/);
  });

  it('rejects a node missing the fields its renderer will read', () => {
    expect(() => validateSceneSpec({ ...ok, objects: [{ type: 'circle' }] })).toThrow(/radius/);
  });
});
