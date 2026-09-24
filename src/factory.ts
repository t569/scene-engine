import { BaseObject, circle, path, polyline, rect, text } from './objects.ts';
import { Space3D, itemFromSpec } from './space.ts';
import { texElement, type TexRenderer } from './tex.ts';
import type { NodeSpec } from './types.ts';

/** What building a node may need from outside the spec itself. */
export interface BuildOptions {
  /** Required only if the spec contains `tex` nodes. */
  renderTex?: TexRenderer;
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
  switch (spec.type) {
    case 'rect':
      return new BaseObject(rect(spec), spec);
    case 'circle':
      return new BaseObject(circle(spec), spec);
    case 'text':
      return new BaseObject(text(spec, fontFamily), spec);
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
    default: {
      const unreachable: never = spec;
      throw new Error(`Unknown node type: ${JSON.stringify(unreachable)}`);
    }
  }
}
