import { Scene, SVG_NS } from './scene.ts';
import { applyPresets } from './objects.ts';
import { createObject, type BuildOptions } from './factory.ts';
import { SHAPES } from './space.ts';
import { ANIMATABLE, EASES } from './timeline.ts';
import { ExprError, compile, compileTemplate, isReservedName } from './expr.ts';
import type { AssetSpec, NodeSpec, SceneSpec } from './types.ts';

/**
 * Ceilings on anything whose cost grows with a number in the spec. A spec may
 * come from a model; `steps: [100000, 100000]` is a frozen tab, not a scene.
 */
export const LIMITS = {
  objects: 2000,
  polylinePoints: 5000,
  segmentsPerProp: 200,
  gridSteps: 200,
  curveSteps: 4000,
  items3d: 32,
  params: 32,
  plotSamples: 2000,
  palette: 64,
} as const;

/** A CSS colour: hex, a name, or rgb()/hsl(). Nothing that could end an attribute. */
const COLOR = /^[#\w(),.%\s-]{1,64}$/;

export class SceneSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SceneSpecError';
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Runtime guard for a spec the engine did not write.
 *
 * This is a trust boundary and stays one: specs arrive as JSON from a backend
 * campaign record, a hand-edited file, or a model's output. TypeScript has
 * nothing to say about any of those at runtime, so every field the renderer
 * will dereference is checked here, with an error naming the offending path —
 * the alternative is a silently blank scene and no clue why.
 */
export function validateSceneSpec(spec: unknown): asserts spec is SceneSpec {
  if (!isRecord(spec)) throw new SceneSpecError('scene must be an object');
  if (!num(spec.width) || !num(spec.height)) {
    throw new SceneSpecError('scene.width and scene.height must be numbers');
  }
  if (!Array.isArray(spec.objects)) {
    throw new SceneSpecError('scene.objects must be an array');
  }
  if (spec.objects.length > LIMITS.objects) {
    throw new SceneSpecError(`scene.objects has ${spec.objects.length} entries — the limit is ${LIMITS.objects}`);
  }
  const names = validateParams(spec.params);
  // Every expression in the spec is compiled here, so a bad one fails the load
  // with its path named — not a frame later, and not silently.
  exprVars = [...names, 't'];
  if (spec.assets !== undefined) {
    if (!Array.isArray(spec.assets)) throw new SceneSpecError('scene.assets must be an array');
    spec.assets.forEach(validateAsset);
  }
  spec.objects.forEach(validateNode);
}

function validateAsset(asset: unknown, i: number): void {
  const at = `scene.assets[${i}]`;
  if (!isRecord(asset)) throw new SceneSpecError(`${at} must be an object`);
  if (typeof asset.id !== 'string') throw new SceneSpecError(`${at}.id must be a string`);
  if (asset.kind !== 'font' && asset.kind !== 'image') {
    throw new SceneSpecError(`${at}.kind must be 'font' or 'image'`);
  }
  if (typeof asset.src !== 'string') throw new SceneSpecError(`${at}.src must be a string`);
  // Both are spliced into an @font-face rule, and a <style> inside an svg
  // styles the whole document. A quote, backslash or newline in either could
  // close the string and restyle the host page.
  for (const key of ['src', 'family', 'id'] as const) {
    const v = asset[key];
    if (typeof v === 'string' && /["\\\n\r<>]/.test(v)) {
      throw new SceneSpecError(`${at}.${key} contains a character not allowed in a font reference`);
    }
  }
}

/** Variables expressions may use while one spec is being validated. */
let exprVars: string[] = ['t'];

const NAME = /^[A-Za-z_]\w{0,31}$/;

function validateParams(params: unknown): string[] {
  if (params === undefined) return [];
  if (!isRecord(params)) throw new SceneSpecError('scene.params must be an object');
  const names = Object.keys(params);
  if (names.length > LIMITS.params) throw new SceneSpecError(`scene.params has more than ${LIMITS.params} entries`);
  for (const name of names) {
    const at = `scene.params.${name}`;
    if (!NAME.test(name) || isReservedName(name)) {
      throw new SceneSpecError(`${at}: a param name must be a plain identifier and not a built-in (t, x, pi, sin, …)`);
    }
    const p = params[name];
    if (!isRecord(p) || !num(p.value)) throw new SceneSpecError(`${at} needs a numeric value`);
    for (const k of ['min', 'max', 'step'] as const) {
      if (p[k] !== undefined && !num(p[k])) throw new SceneSpecError(`${at}.${k} must be a number`);
    }
    if (num(p.min) && num(p.max) && p.min > p.max) throw new SceneSpecError(`${at}.min is above max`);
    if (p.step !== undefined && !((p.step as number) > 0)) throw new SceneSpecError(`${at}.step must be positive`);
  }
  return names;
}

function checkExpr(src: unknown, at: string, extra: string[] = []): void {
  if (typeof src !== 'string') throw new SceneSpecError(`${at} must be an expression string`);
  try {
    compile(src, [...exprVars, ...extra]);
  } catch (e) {
    throw new SceneSpecError(`${at}: ${e instanceof ExprError ? e.message : 'invalid expression'}`);
  }
}

function checkTemplate(src: string, at: string): void {
  try {
    compileTemplate(src, exprVars);
  } catch (e) {
    throw new SceneSpecError(`${at}: ${e instanceof ExprError ? e.message : 'invalid template'}`);
  }
}

function checkParamRef(name: unknown, at: string): void {
  if (typeof name !== 'string' || name === 't' || !exprVars.includes(name)) {
    throw new SceneSpecError(`${at} must name one of scene.params`);
  }
}

function validateInteractive(node: Record<string, unknown>, at: string): void {
  if (node.bind !== undefined) {
    if (!isRecord(node.bind)) throw new SceneSpecError(`${at}.bind must be an object`);
    for (const [prop, src] of Object.entries(node.bind)) {
      if (!(ANIMATABLE as readonly string[]).includes(prop)) {
        throw new SceneSpecError(`${at}.bind.${prop} is not bindable — expected one of ${ANIMATABLE.join(', ')}`);
      }
      checkExpr(src, `${at}.bind.${prop}`);
    }
  }
  if (node.visible_when !== undefined) {
    const many = Array.isArray(node.visible_when);
    const list: unknown[] = many ? (node.visible_when as unknown[]) : [node.visible_when];
    list.forEach((c, i) => {
      const cat = `${at}.visible_when${many ? `[${i}]` : ''}`;
      if (!isRecord(c)) throw new SceneSpecError(`${cat} must be { expr, min?, max? }`);
      checkExpr(c.expr, `${cat}.expr`);
      if (c.min !== undefined && !num(c.min)) throw new SceneSpecError(`${cat}.min must be a number`);
      if (c.max !== undefined && !num(c.max)) throw new SceneSpecError(`${cat}.max must be a number`);
    });
  }
  if (node.on_click !== undefined) {
    if (!isRecord(node.on_click) || !isRecord(node.on_click.set)) {
      throw new SceneSpecError(`${at}.on_click must be { set: { param: value } }`);
    }
    for (const [name, v] of Object.entries(node.on_click.set)) {
      checkParamRef(name, `${at}.on_click.set.${name}`);
      if (!num(v)) throw new SceneSpecError(`${at}.on_click.set.${name} must be a number`);
    }
  }
  if (node.fill_by !== undefined) {
    const f = node.fill_by;
    if (!isRecord(f)) throw new SceneSpecError(`${at}.fill_by must be { param, palette }`);
    checkParamRef(f.param, `${at}.fill_by.param`);
    if (
      !Array.isArray(f.palette) ||
      f.palette.length < 1 ||
      f.palette.length > LIMITS.palette ||
      !f.palette.every((c) => typeof c === 'string' && COLOR.test(c))
    ) {
      throw new SceneSpecError(`${at}.fill_by.palette must be 1 to ${LIMITS.palette} colours`);
    }
  }
  if (node.control !== undefined) {
    if (!isRecord(node.control)) throw new SceneSpecError(`${at}.control must be { x?, y? }`);
    for (const [axis, c] of Object.entries(node.control)) {
      const cat = `${at}.control.${axis}`;
      if (axis !== 'x' && axis !== 'y') throw new SceneSpecError(`${cat}: only x and y can be controlled`);
      if (!isRecord(c)) throw new SceneSpecError(`${cat} must be { param, range }`);
      checkParamRef(c.param, `${cat}.param`);
      if (!Array.isArray(c.range) || c.range.length !== 2 || !c.range.every(num)) {
        throw new SceneSpecError(`${cat}.range must be [from, to] in scene units`);
      }
    }
  }
}

function pair(v: unknown): boolean {
  return Array.isArray(v) && v.length === 2 && v.every(num) && v[0] !== v[1];
}

function positiveInt(v: unknown, max: number): boolean {
  return num(v) && Number.isInteger(v) && v >= 1 && v <= max;
}

function validateAnimate(animate: unknown, at: string): void {
  if (animate === undefined) return;
  if (!isRecord(animate)) throw new SceneSpecError(`${at}.animate must be an object`);
  for (const [key, value] of Object.entries(animate)) {
    if (key === 'loop') {
      if (!num(value) || value <= 0) throw new SceneSpecError(`${at}.animate.loop must be a positive number of seconds`);
      continue;
    }
    if (!(ANIMATABLE as readonly string[]).includes(key)) {
      throw new SceneSpecError(`${at}.animate.${key} is not animatable — expected one of ${ANIMATABLE.join(', ')}`);
    }
    if (!Array.isArray(value) || value.length > LIMITS.segmentsPerProp) {
      throw new SceneSpecError(`${at}.animate.${key} must be an array of at most ${LIMITS.segmentsPerProp} segments`);
    }
    value.forEach((seg: unknown, i: number) => {
      const sat = `${at}.animate.${key}[${i}]`;
      if (!isRecord(seg) || !num(seg.at) || !num(seg.dur) || seg.dur < 0 || !num(seg.to)) {
        throw new SceneSpecError(`${sat} needs numeric at, dur (≥ 0) and to`);
      }
      if (seg.from !== undefined && !num(seg.from)) throw new SceneSpecError(`${sat}.from must be a number`);
      if (seg.ease !== undefined && !(typeof seg.ease === 'string' && seg.ease in EASES)) {
        throw new SceneSpecError(`${sat}.ease must be one of ${Object.keys(EASES).join(', ')}`);
      }
    });
  }
}

function validateItem3d(item: unknown, at: string): void {
  if (!isRecord(item)) throw new SceneSpecError(`${at} must be an object`);
  if (typeof item.shape !== 'string' || !Object.prototype.hasOwnProperty.call(SHAPES, item.shape)) {
    throw new SceneSpecError(`${at}.shape must be one of ${Object.keys(SHAPES).join(', ')}`);
  }
  if (item.params !== undefined) {
    if (!isRecord(item.params) || !Object.values(item.params).every(num)) {
      throw new SceneSpecError(`${at}.params must map names to numbers`);
    }
  }
  if (item.steps !== undefined) {
    const max = SHAPES[item.shape]!.kind === 'surface' ? LIMITS.gridSteps : LIMITS.curveSteps;
    if (!Array.isArray(item.steps) || !item.steps.every((n) => positiveInt(n, max))) {
      throw new SceneSpecError(`${at}.steps must be whole numbers from 1 to ${max}`);
    }
  }
}

function validateNode(node: unknown, i: number): void {
  const at = `scene.objects[${i}]`;
  if (!isRecord(node)) throw new SceneSpecError(`${at} must be an object`);

  validateAnimate(node.animate, at);
  validateInteractive(node, at);

  switch (node.type) {
    case 'rect':
      if (!num(node.width) || !num(node.height)) {
        throw new SceneSpecError(`${at} (rect) needs numeric width and height`);
      }
      return;
    case 'circle':
      if (!num(node.radius)) throw new SceneSpecError(`${at} (circle) needs a numeric radius`);
      return;
    case 'text':
      if (typeof node.text !== 'string') throw new SceneSpecError(`${at} (text) needs a text string`);
      checkTemplate(node.text, `${at}.text`);
      return;
    case 'plot':
      checkExpr(node.expr, `${at}.expr`, ['x']);
      if (!pair(node.domain) || !pair(node.range)) {
        throw new SceneSpecError(`${at} (plot) needs domain and range as [from, to] with from ≠ to`);
      }
      if (!num(node.width) || !num(node.height)) throw new SceneSpecError(`${at} (plot) needs numeric width and height`);
      if (node.samples !== undefined && !positiveInt(node.samples, LIMITS.plotSamples)) {
        throw new SceneSpecError(`${at}.samples must be a whole number from 1 to ${LIMITS.plotSamples}`);
      }
      return;
    case 'slider':
      checkParamRef(node.param, `${at}.param`);
      if (!num(node.width) || node.width <= 0) throw new SceneSpecError(`${at} (slider) needs a positive width`);
      if (node.label !== undefined) {
        if (typeof node.label !== 'string') throw new SceneSpecError(`${at}.label must be a string`);
        checkTemplate(node.label, `${at}.label`);
      }
      return;
    case 'path':
      if (typeof node.d !== 'string') throw new SceneSpecError(`${at} (path) needs a d string`);
      return;
    case 'polyline':
      if (
        !Array.isArray(node.points) ||
        node.points.length < 2 ||
        node.points.length > LIMITS.polylinePoints ||
        !node.points.every((p) => Array.isArray(p) && p.length === 2 && num(p[0]) && num(p[1]))
      ) {
        throw new SceneSpecError(
          `${at} (polyline) needs 2 to ${LIMITS.polylinePoints} points, each [x, y]`,
        );
      }
      return;
    case 'tex':
      if (typeof node.tex !== 'string' || !num(node.width) || !num(node.height)) {
        throw new SceneSpecError(`${at} (tex) needs a tex string and numeric width and height`);
      }
      return;
    case 'space3d':
      if (!Array.isArray(node.items) || node.items.length === 0 || node.items.length > LIMITS.items3d) {
        throw new SceneSpecError(`${at} (space3d) needs 1 to ${LIMITS.items3d} items`);
      }
      node.items.forEach((item, j) => validateItem3d(item, `${at}.items[${j}]`));
      if (node.camera !== undefined) {
        if (!isRecord(node.camera) || !Object.values(node.camera).every(num)) {
          throw new SceneSpecError(`${at}.camera must map names to numbers`);
        }
      }
      return;
    default:
      throw new SceneSpecError(
        `${at} has unknown type ${JSON.stringify(node.type)} — expected one of rect, circle, text, path, polyline, tex, space3d, plot, slider`,
      );
  }
}

/**
 * Fonts declared in `assets` become one `<style>` block inside the scene's own
 * svg, so they live and die with the scene instead of leaking into the host
 * page's `<head>`. Images are registered but not preloaded — there is no image
 * node type yet, so preloading them would be work for nobody.
 */
function registerAssets(scene: Scene, assets: AssetSpec[]): Map<string, AssetSpec> {
  const byId = new Map(assets.map((a) => [a.id, a]));

  const faces = assets
    .filter((a) => a.kind === 'font')
    .map((a) => `@font-face{font-family:"${a.family ?? a.id}";src:url("${a.src}");}`)
    .join('\n');

  if (faces) {
    const style = document.createElementNS(SVG_NS, 'style');
    style.textContent = faces;
    scene.svg.appendChild(style);
  }

  return byId;
}

function fontFamilyFor(spec: NodeSpec, assets: Map<string, AssetSpec>): string | undefined {
  if (spec.type !== 'text' || !spec.asset_id) return undefined;
  const asset = assets.get(spec.asset_id);
  if (!asset) throw new SceneSpecError(`unknown asset_id ${JSON.stringify(spec.asset_id)}`);
  if (asset.kind !== 'font') {
    throw new SceneSpecError(`asset ${JSON.stringify(spec.asset_id)} is not a font`);
  }
  return asset.family ?? asset.id;
}

/**
 * JSON in, running scene out. The caller still has to `start()` it — parsing
 * and animating are separate so a host can build a scene, inspect or adjust it,
 * and only then hand it the clock.
 */
export function parseScene(spec: unknown, mount: Element, options: BuildOptions = {}): Scene {
  validateSceneSpec(spec);

  const scene = new Scene(spec, mount);
  const assets = registerAssets(scene, spec.assets ?? []);

  // Array order, start to finish. Each `add` appends, so the array's order
  // becomes the paint order — the implicit z-index, with nothing to maintain.
  for (const node of spec.objects) {
    const obj = createObject(node, fontFamilyFor(node, assets), { ...options, params: scene.params.names() });
    scene.add(obj, node.id);
    applyPresets(obj, node, scene.svg);
    // Paint the t = 0 frame, so a scene that is never started still shows —
    // bound values, live text and hidden-until-solved nodes included.
    obj.onUpdate(0, 0);
    obj.applyTransform();
  }

  return scene;
}
