import { describe, expect, it } from 'vitest';
import { DEFAULT_FORCES, neighbours, spiralLayout, stepForces, zoomAt, type SimEdge, type SimNode } from './graph.ts';

// The physics and the camera maths, without a DOM.

const node = (x: number, y: number, fixed = false): SimNode => ({ x, y, vx: 0, vy: 0, fixed, mass: 1 });

describe('stepForces', () => {
  it('pushes two unlinked stars apart', () => {
    const ns = [node(-5, 0), node(5, 0)];
    stepForces(ns, [], 1, 1 / 60);
    expect(ns[0]!.x).toBeLessThan(-5);
    expect(ns[1]!.x).toBeGreaterThan(5);
  });

  it('pulls linked stars toward the spring length and settles', () => {
    const ns = [node(-300, 0), node(300, 0)];
    const edges: SimEdge[] = [{ a: 0, b: 1, length: 60, strength: 1 }];
    let alpha = 1;
    let energy = Infinity;
    for (let i = 0; i < 1200; i++) {
      energy = stepForces(ns, edges, alpha, 1 / 60);
      alpha *= 0.995;
    }
    const d = Math.hypot(ns[0]!.x - ns[1]!.x, ns[0]!.y - ns[1]!.y);
    expect(d).toBeLessThan(300); // pulled in from 600
    expect(energy).toBeLessThan(1e-2); // and at rest
  });

  it('never moves a star the pointer is holding', () => {
    const ns = [node(0, 0, true), node(1, 0)];
    stepForces(ns, [], 1, 1 / 60);
    expect([ns[0]!.x, ns[0]!.y]).toEqual([0, 0]);
  });

  it('separates stars that start on top of each other, without NaN', () => {
    const ns = [node(0, 0), node(0, 0), node(0, 0)];
    stepForces(ns, [], 1, 1 / 60);
    for (const p of ns) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    expect(new Set(ns.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`)).size).toBe(3);
  });

  it('does nothing when cold or paused', () => {
    const ns = [node(-5, 0), node(5, 0)];
    expect(stepForces(ns, [], 0, 1 / 60)).toBe(0);
    expect(stepForces(ns, [], 1, 0)).toBe(0);
    expect(ns[0]!.x).toBe(-5);
  });

  it('is frame-rate independent in its friction', () => {
    const a = [node(-5, 0), node(5, 0)];
    const b = [node(-5, 0), node(5, 0)];
    stepForces(a, [], 1, 1 / 30);
    stepForces(b, [], 1, 1 / 60);
    stepForces(b, [], 1, 1 / 60);
    // Not identical (forces are re-evaluated), but the same order of motion.
    expect(Math.abs(a[0]!.x - b[0]!.x)).toBeLessThan(Math.abs(a[0]!.x + 5));
    expect(DEFAULT_FORCES.retention).toBeGreaterThan(0);
  });
});

describe('layout helpers', () => {
  it('starts every load from the same spiral', () => {
    expect(spiralLayout(5)).toEqual(spiralLayout(5));
    expect(new Set(spiralLayout(50).map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)).size).toBe(50);
  });

  it('knows each star’s neighbours both ways', () => {
    const adj = neighbours(3, [{ a: 0, b: 1 }]);
    expect([...adj[0]!]).toEqual([1]);
    expect([...adj[1]!]).toEqual([0]);
    expect(adj[2]!.size).toBe(0);
  });

  it('zooms about the pointer, keeping the point under it still', () => {
    const cam = { tx: 100, ty: 50, k: 1 };
    const next = zoomAt(cam, 300, 200, 2);
    const before = { x: (300 - cam.tx) / cam.k, y: (200 - cam.ty) / cam.k };
    const after = { x: (300 - next.tx) / next.k, y: (200 - next.ty) / next.k };
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
    expect(zoomAt(cam, 0, 0, 1000).k).toBe(6); // clamped
  });
});
