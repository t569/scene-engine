import { BaseObject, circle, path, polyline, rect, text } from './objects.ts';
import { compile, compileTemplate, isTemplate, usesTime } from './expr.ts';
import { PlotNode, SliderNode, TemplateText } from './interactive.ts';
import { Space3D, itemFromSpec } from './space.ts';
import { texElement, type TexRenderer } from './tex.ts';
import { nodeType } from './registry.ts';
import type { AnimatableProp, NodeSpec, VisibleWhen } from './types.ts';

/** What building a node may need from outside the spec itself. */
export interface BuildOptions {
  /** Required only if the spec contains `tex` nodes. */
  renderTex?: TexRenderer;
  /**
   * Decide what a URL in the spec (a model, a texture) may load. Return the URL
   * to fetch, or null to refuse. Without it, plugins allow only same-origin and
   * relative URLs: a spec from a stranger must not make the viewer's browser
   * call arbitrary servers.
   */
  resolveAsset?: (src: string, kind: string) => string | null;
  /** The scene's param names — what expressions may refer to (besides `t`, and `x` in a plot). */
  params?: readonly string[];
}

/**
 * `NodeSpec` to `BaseObject`. The `switch` is exhaustive: the `never` default
 * means adding a member to `NodeSpec` breaks the build here until it is
 * handled, and it doubles as the runtime guard for hand-written JSON.
 *
 * Lives apart from `objects.ts` because it has to know `Space3D`, which itself
 * extends `BaseObject` — in one module that is an import cycle.
 */
export function createObject(spec: NodeSpec, fontFamily?: string, options: BuildOptions = {}): BaseObject {
  const vars = [...(options.params ?? []), 't'];
  const obj = build(spec, fontFamily, options, vars);

  // The interactive layer, on any node.
  if (spec.bind) {
    obj.bindings = Object.entries(spec.bind).map(([prop, src]) => [prop as AnimatableProp, compile(src as string, vars)]);
    obj.timed ||= obj.bindings.some(([, f]) => usesTime(f));
  }
  if (spec.visible_when) {
    const list: VisibleWhen[] = Array.isArray(spec.visible_when) ? spec.visible_when : [spec.visible_when];
    obj.conditions = list.map((c) => {
      const f = compile(c.expr, vars);
      obj.timed ||= usesTime(f);
      // Neither bound: visible while the value is non-zero.
      if (c.min === undefined && c.max === undefined) return { f: (env) => (f(env) !== 0 ? 1 : 0), min: 1, max: 1 };
      return { f, min: c.min ?? -Infinity, max: c.max ?? Infinity };
    });
  }
  if (spec.fill_by) obj.fillBy = spec.fill_by;
  if (spec.control) {
    obj.controls = (['x', 'y'] as const).flatMap((axis) => {
      const c = spec.control?.[axis];
      return c ? [{ axis, param: c.param, range: c.range }] : [];
    });
  }
  return obj;
}

function build(spec: NodeSpec, fontFamily: string | undefined, options: BuildOptions, vars: string[]): BaseObject {
  switch (spec.type) {
    case 'rect':
      return new BaseObject(rect(spec), spec);
    case 'circle':
      return new BaseObject(circle(spec), spec);
    case 'text': {
      const el = text(spec, fontFamily);
      if (!isTemplate(spec.text)) return new BaseObject(el, spec);
      return new TemplateText(el as SVGTextElement, compileTemplate(spec.text, vars), spec);
    }
    case 'path':
      return new BaseObject(path(spec), spec);
    case 'polyline':
      return new BaseObject(polyline(spec), spec);
    case 'tex': {
      if (!options.renderTex) {
        throw new Error('a tex node needs a renderer: parseScene(spec, mount, { renderTex })');
      }
      return new BaseObject(texElement(options.renderTex(spec.tex), spec), spec);
    }
    case 'space3d': {
      const space = new Space3D(spec);
      for (const item of spec.items) space.add(itemFromSpec(item));
      return space;
    }
    case 'plot':
      {
      const f = compile(spec.expr, [...vars, 'x']);
      return new PlotNode(f, usesTime(f), spec);
    }
    case 'slider':
      return new SliderNode(spec, spec.label ? compileTemplate(spec.label, vars) : null);
    default: {
      // A plugin's node type (see registry.ts); the validator has already vouched for it.
      const ext = nodeType((spec as { type: unknown }).type);
      if (ext) return ext.create(spec, { vars, options });
      throw new Error(`Unknown node type: ${JSON.stringify((spec as { type: unknown }).type)}`);
    }
  }
}
