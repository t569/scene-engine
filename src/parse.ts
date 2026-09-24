import { Scene, SVG_NS } from './scene.js';
import { applyPresets, createObject } from './objects.js';
import type { AssetSpec, NodeSpec, SceneSpec } from './types.js';

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
}

function validateNode(node: unknown, i: number): void {
  const at = `scene.objects[${i}]`;
  if (!isRecord(node)) throw new SceneSpecError(`${at} must be an object`);

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
      return;
    default:
      throw new SceneSpecError(
        `${at} has unknown type ${JSON.stringify(node.type)} — expected 'rect', 'circle' or 'text'`,
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
export function parseScene(spec: unknown, mount: Element): Scene {
  validateSceneSpec(spec);

  const scene = new Scene(spec, mount);
  const assets = registerAssets(scene, spec.assets ?? []);

  // Array order, start to finish. Each `add` appends, so the array's order
  // becomes the paint order — the implicit z-index, with nothing to maintain.
  for (const node of spec.objects) {
    const obj = createObject(node, fontFamilyFor(node, assets));
    scene.add(obj, node.id);
    applyPresets(obj, node, scene.svg);
    obj.applyTransform(); // paint once, so a scene that is never started still shows
  }

  return scene;
}
