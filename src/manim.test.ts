import { describe, expect, it } from 'vitest';
import { EASES, compileAnimate, localTime, sampleSegments } from './timeline.ts';
import { bandByDepth, buildPrimitives, itemFromSpec, project, type Primitive } from './space.ts';
import { SceneSpecError, validateSceneSpec, LIMITS } from './parse.ts';
import { EMOTIONS, STILL, easeMotion, pose } from './plugins/character.ts';
import type { EaseName, Segment } from './types.ts';

// Still no DOM: timeline, projection, validation and motion are all pure, and
// they are where the failure modes are. The DOM halves are thin on purpose.

describe('easing', () => {
  const returning: EaseName[] = ['thereAndBack', 'wiggle'];

  it('starts every curve at 0 and ends each where it says it does', () => {
    for (const [name, f] of Object.entries(EASES) as Array<[EaseName, (x: number) => number]>) {
      expect(f(0), name).toBeCloseTo(0, 9);
      expect(f(1), name).toBeCloseTo(returning.includes(name) ? 0 : 1, 9);
    }
  });

  it("matches Manim's smooth: symmetric, through the midpoint", () => {
    expect(EASES.smooth(0.5)).toBeCloseTo(0.5, 12);
    expect(EASES.smooth(0.2) + EASES.smooth(0.8)).toBeCloseTo(1, 12);
  });

  it('holds step at 0 until the very end, like Blender CONSTANT', () => {
    expect(EASES.step(0.999)).toBe(0);
    expect(EASES.step(1)).toBe(1);
  });
});

describe('sampleSegments', () => {
  const script: Segment[] = [
    { at: 1, dur: 1, to: 100, ease: 'linear' },
    { at: 3, dur: 2, to: 0, ease: 'linear' },
  ];

  it('reads like a script: hold, move, hold, move back', () => {
    expect(sampleSegments(script, 0, 5)).toBe(5); // before the first segment
    expect(sampleSegments(script, 1.5, 0)).toBe(50); // halfway through the first
    expect(sampleSegments(script, 2.5, 0)).toBe(100); // held between segments
    expect(sampleSegments(script, 4, 0)).toBe(50); // second starts from where the first ended
    expect(sampleSegments(script, 99, 0)).toBe(0); // held after the last
  });

  it('lets `from` override the carried value', () => {
    expect(sampleSegments([{ at: 0, dur: 1, from: 10, to: 20, ease: 'linear' }], 0.5, 999)).toBe(15);
  });

  it('treats a zero-length segment as a cut', () => {
    expect(sampleSegments([{ at: 1, dur: 0, to: 7 }], 1, 0)).toBe(7);
  });
});

describe('compileAnimate', () => {
  it('is a pure function of time, so seeking in any order gives the same frames', () => {
    const at = compileAnimate({ x: [{ at: 0, dur: 2, to: 200 }], opacity: [{ at: 1, dur: 1, to: 0 }] }, { x: 0, opacity: 1 });
    const forward = [0, 0.5, 1.2, 1.9].map(at);
    const shuffled = [1.9, 0, 1.2, 0.5].map(at);
    expect([shuffled[1], shuffled[3], shuffled[2], shuffled[0]]).toEqual(forward);
  });

  it('wraps time when looping — the shape an ad banner needs', () => {
    expect(localTime(7.5, 3)).toBeCloseTo(1.5);
    const at = compileAnimate({ loop: 2, x: [{ at: 0, dur: 2, to: 10, ease: 'linear' }] }, {});
    expect(at(0.5).x).toBeCloseTo(at(4.5).x!);
  });
});

describe('project', () => {
  it('is the identity-ish side view at yaw 0, pitch 0, orthographic', () => {
    const [x, y, depth] = project([1, 2, 3], { yaw: 0, pitch: 0, zoom: 10 });
    expect(x).toBeCloseTo(10);
    expect(y).toBeCloseTo(-30); // model z is up; scene y grows down
    expect(depth).toBeCloseTo(2); // model y points into the screen
  });

  it('shrinks farther points under perspective', () => {
    const cam = { yaw: 0, pitch: 0, zoom: 10, distance: 10 };
    const near = project([1, -2, 0], cam);
    const far = project([1, 2, 0], cam);
    expect(Math.abs(far[0])).toBeLessThan(Math.abs(near[0]));
  });
});

describe('3D primitives', () => {
  const cam = { yaw: 0.6, pitch: 0.5, zoom: 30 };

  it('builds one face per grid cell, and none before the surface is revealed', () => {
    const torus = itemFromSpec({ shape: 'torus', steps: [4, 3] });
    const faces = (p: Primitive[]) => p.filter((q) => q.kind === 'face').length;
    expect(faces(buildPrimitives([torus], cam))).toBe(12);
    expect(faces(buildPrimitives([{ ...torus, reveal: 0 } as typeof torus], cam))).toBe(0);
  });

  it('draws only the requested fraction of a curve', () => {
    const helix = itemFromSpec({ shape: 'helix', steps: [100] });
    expect(buildPrimitives([{ ...helix, draw: 0.5 } as typeof helix], cam)).toHaveLength(50);
  });

  it('puts the farthest primitives in band 0 — painted first, so nearer ones cover them', () => {
    const prims = buildPrimitives([itemFromSpec({ shape: 'sphere' })], cam);
    const bands = bandByDepth(prims, 5);
    const maxDepth = (b: Primitive[]) => Math.max(...b.map((p) => p.depth));
    expect(maxDepth(bands[0]!)).toBeGreaterThan(maxDepth(bands[4]!));
    expect(bands.flat()).toHaveLength(prims.length);
  });

  it('refuses a shape it does not know', () => {
    expect(() => itemFromSpec({ shape: 'teapot' })).toThrow(/unknown shape/);
  });
});

describe('validateSceneSpec — the trust boundary for authored and generated scenes', () => {
  const scene = (objects: unknown[], extra: object = {}) => ({ width: 100, height: 100, objects, ...extra });
  const bad = (spec: unknown, msg: RegExp) => {
    expect(() => validateSceneSpec(spec)).toThrow(SceneSpecError);
    expect(() => validateSceneSpec(spec)).toThrow(msg);
  };

  it('accepts every new node type', () => {
    expect(() =>
      validateSceneSpec(
        scene([
          { type: 'path', d: 'M0 0L10 10', draw: 0, animate: { draw: [{ at: 0, dur: 1, to: 1 }], loop: 3 } },
          { type: 'polyline', points: [[0, 0], [5, 5], [9, 0]], closed: true },
          { type: 'tex', tex: 'e^{i\\pi}+1=0', width: 80, height: 20 },
          { type: 'space3d', orbit: true, camera: { yaw: 1 }, items: [{ shape: 'klein8', steps: [40, 32] }] },
        ]),
      ),
    ).not.toThrow();
  });

  it('rejects animating something that is not animatable, and unknown eases', () => {
    bad(scene([{ type: 'circle', radius: 1, animate: { fill: [] } }]), /animate\.fill is not animatable/);
    bad(scene([{ type: 'circle', radius: 1, animate: { x: [{ at: 0, dur: 1, to: 1, ease: 'bogus' }] } }]), /ease must be one of/);
  });

  it('caps costs a generated spec could blow up', () => {
    bad(scene([{ type: 'space3d', items: [{ shape: 'torus', steps: [LIMITS.gridSteps + 1, 10] }] }]), /steps must be whole numbers/);
    bad(scene(Array.from({ length: LIMITS.objects + 1 }, () => ({ type: 'circle', radius: 1 }))), /limit is/);
  });

  it('does not let a shape name reach Object.prototype', () => {
    bad(scene([{ type: 'space3d', items: [{ shape: 'constructor' }] }]), /shape must be one of/);
  });

  it('refuses a font reference that could break out of its CSS string', () => {
    bad(
      scene([], { assets: [{ id: 'f', kind: 'font', src: 'x.woff");} body{display:none' }] }),
      /not allowed in a font reference/,
    );
  });
});

describe('character motion', () => {
  it('eases toward the new emotion rather than jumping, and gets there', () => {
    let m = EMOTIONS.idle!;
    m = easeMotion(m, EMOTIONS.error!, 1 / 60);
    expect(m.shake).toBeGreaterThan(0);
    expect(m.shake).toBeLessThan(EMOTIONS.error!.shake);
    for (let i = 0; i < 600; i++) m = easeMotion(m, EMOTIONS.error!, 1 / 60);
    expect(m.shake).toBeCloseTo(EMOTIONS.error!.shake, 3);
  });

  it('rests at lean and angle only, when every wave is at zero', () => {
    const p = pose(EMOTIONS.sleeping!, 0);
    expect(p).toEqual({ dx: 0, dy: 0, scale: 1 + EMOTIONS.sleeping!.lean, rotation: EMOTIONS.sleeping!.angle, opacity: EMOTIONS.sleeping!.opacity });
    expect(pose(STILL, 12.3).scale).toBe(1);
  });
});
