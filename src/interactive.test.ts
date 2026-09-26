import { describe, expect, it } from 'vitest';
import { ExprError, compile, compileTemplate, usesTime } from './expr.ts';
import { Params } from './params.ts';
import { plotPath, sliderValueAt } from './interactive.ts';
import { SceneSpecError, validateSceneSpec } from './parse.ts';

// Still DOM-free: the language, the param store and the two pure node cores
// are where an interactive scene can go wrong, and none needs a document.

describe('expressions', () => {
  const run = (src: string, env: Record<string, number> = {}) => compile(src, Object.keys(env))(env);

  it('follows ordinary precedence, with ^ right-associative and binding tighter than unary minus', () => {
    expect(run('1 + 2 * 3')).toBe(7);
    expect(run('(1 + 2) * 3')).toBe(9);
    expect(run('2 ^ 3 ^ 2')).toBe(512);
    expect(run('-2 ^ 2')).toBe(-4);
    expect(run('2 ^ -1')).toBe(0.5);
    expect(run('7 % 3')).toBe(1);
  });

  it('reads variables, constants and whitelisted functions', () => {
    expect(run('a * x + b', { a: 2, x: 3, b: 1 })).toBe(7);
    expect(run('sin(pi / 2)')).toBeCloseTo(1, 12);
    expect(run('max(1, a, 3)', { a: 5 })).toBe(5);
    expect(run('clamp(a, 0, 1)', { a: 4 })).toBe(1);
    expect(run('1.5e2')).toBe(150);
  });

  it('refuses anything that is not the language — at compile time', () => {
    for (const bad of [
      'alert(1)', // not a whitelisted function
      'constructor', // not a declared variable
      '__proto__',
      'a.b', // no member access
      'a[0]',
      '"text"', // no strings
      'x => x', // no functions
      '1 +', // incomplete
      '(1',
      'sin(1, 2)', // wrong arity
      'a',  // undeclared
    ]) {
      expect(() => compile(bad, ['x']), bad).toThrow(ExprError);
    }
  });

  it('caps length and nesting', () => {
    expect(() => compile('1+'.repeat(300) + '1', [])).toThrow(/longer than/);
    expect(() => compile('('.repeat(60) + '1' + ')'.repeat(60), [])).toThrow(/nested/);
  });

  it('reads only own properties of the environment', () => {
    const f = compile('a', ['a']);
    expect(f(Object.create({ a: 5 }))).toBeNaN();
  });

  it('fills templates, with optional fixed digits', () => {
    const t = compileTemplate('a = {a:2}, twice = {2*a}, done', ['a']);
    expect(t({ a: 1.5 })).toBe('a = 1.50, twice = 3, done');
    expect(compileTemplate('{1/a}', ['a'])({ a: 0 })).toBe('—');
  });
});

describe('usesTime', () => {
  it('flags only expressions and templates that read t', () => {
    expect(usesTime(compile('90*sin(t)', ['t']))).toBe(true);
    expect(usesTime(compile('sqrt(a) + tan(a)', ['a', 't']))).toBe(false); // letters, not the variable
    expect(usesTime(compileTemplate('a = {a:2}', ['a', 't']))).toBe(false);
    expect(usesTime(compileTemplate('a = {a:2}, t = {t:1}', ['a', 't']))).toBe(true);
  });
});

describe('Params', () => {
  it('clamps and snaps to the step from min, without float drift', () => {
    const p = new Params({ a: { value: 1, min: 0, max: 2, step: 0.1 } });
    p.set('a', 0.33333);
    expect(p.get('a')).toBe(0.3);
    p.set('a', 9);
    expect(p.get('a')).toBe(2);
  });

  it('notifies only on a real change, and bumps its version', () => {
    const p = new Params({ a: { value: 1, min: 0, max: 5, step: 1 } });
    const seen: number[] = [];
    p.on((_, v) => seen.push(v));
    const v0 = p.version;
    p.set('a', 1.2); // snaps back to 1: no change
    p.set('a', 3);
    expect(seen).toEqual([3]);
    expect(p.version).toBe(v0 + 1);
    expect(p.set('nope', 1)).toBe(false);
  });
});

describe('plotPath', () => {
  const box = { domain: [0, 10] as [number, number], range: [-1, 1] as [number, number], width: 100, height: 50 };

  it('maps the domain across the box, y up', () => {
    const d = plotPath(compile('0', ['x']), {}, box, 2);
    expect(d).toBe('M-50 0L0 0L50 0');
  });

  it('lifts the pen where the function is undefined or leaves the range', () => {
    const d = plotPath(compile('1 / (x - 5)', ['x']), {}, box, 10);
    // Around the pole the line breaks and restarts, rather than drawing through it.
    expect(d.match(/M/g)!.length).toBeGreaterThan(1);
  });

  it('follows its params', () => {
    const f = compile('a * x / 10', ['x', 'a']);
    expect(plotPath(f, { a: 0 }, box, 1)).not.toBe(plotPath(f, { a: 1 }, box, 1));
  });
});

describe('sliderValueAt', () => {
  it('maps the track onto the param range and clamps past the ends', () => {
    expect(sliderValueAt(0, 200, [0, 10])).toBe(5);
    expect(sliderValueAt(-100, 200, [0, 10])).toBe(0);
    expect(sliderValueAt(500, 200, [0, 10])).toBe(10);
  });
});

describe('validating an interactive spec', () => {
  const base = { width: 400, height: 300, params: { a: { value: 1, min: 0, max: 3, step: 0.5 } } };
  const bad = (objects: unknown[], msg: RegExp, extra: object = {}) =>
    expect(() => validateSceneSpec({ ...base, ...extra, objects })).toThrow(msg);

  it('accepts sliders, plots, bindings, handles, templates and goals', () => {
    expect(() =>
      validateSceneSpec({
        ...base,
        objects: [
          { type: 'slider', param: 'a', x: 200, y: 260, width: 200, label: 'a = {a:1}' },
          { type: 'plot', expr: 'exp(-a*x)*sin(4*x)', domain: [0, 6], range: [-1, 1], width: 300, height: 150, x: 200, y: 120 },
          { type: 'circle', radius: 8, control: { x: { param: 'a', range: [50, 350] } }, bind: { y: '40 + 10*sin(t)' } },
          { type: 'text', text: 'Correct!', visible_when: { expr: 'abs(a - 2)', max: 0.01 } },
        ],
      }),
    ).not.toThrow();
  });

  it('names the path of a bad expression', () => {
    bad([{ type: 'circle', radius: 1, bind: { x: 'alert(1)' } }], /objects\[0\]\.bind\.x: unknown function/);
    bad([{ type: 'plot', expr: 'b * x', domain: [0, 1], range: [0, 1], width: 10, height: 10 }], /unknown name "b"/);
    bad([{ type: 'text', text: 'value {constructor}' }], /objects\[0\]\.text/);
  });

  it('refuses controls and sliders on params that do not exist, and reserved param names', () => {
    bad([{ type: 'slider', param: 'b', width: 100 }], /must name one of scene.params/);
    bad([{ type: 'circle', radius: 1, control: { x: { param: 't', range: [0, 1] } } }], /must name one of scene.params/);
    bad([], /not a built-in/, { params: { sin: { value: 1 } } });
    bad([], /min is above max/, { params: { a: { value: 1, min: 5, max: 1 } } });
  });

  it('checks buttons and palettes against the params, and keeps colours inert', () => {
    const ok = { type: 'rect', width: 1, height: 1, on_click: { set: { a: 2 } }, fill_by: { param: 'a', palette: ['#fff', 'rgb(1, 2, 3)'] } };
    expect(() => validateSceneSpec({ ...base, objects: [ok] })).not.toThrow();
    bad([{ ...ok, on_click: { set: { b: 1 } } }], /on_click\.set\.b must name one of scene.params/);
    bad([{ ...ok, on_click: { set: { a: 'x' } } }], /on_click\.set\.a must be a number/);
    bad([{ ...ok, fill_by: { param: 'a', palette: [] } }], /fill_by\.palette/);
    bad([{ ...ok, fill_by: { param: 'a', palette: ['red" onload="x'] } }], /fill_by\.palette/);
  });

  it('keeps plots bounded', () => {
    bad(
      [{ type: 'plot', expr: 'x', domain: [0, 1], range: [0, 1], width: 10, height: 10, samples: 1e6 }],
      /samples must be/,
    );
    expect(() => validateSceneSpec({ ...base, objects: [{ type: 'plot', expr: 'x', domain: [1, 1], range: [0, 1], width: 1, height: 1 }] })).toThrow(SceneSpecError);
  });
});
