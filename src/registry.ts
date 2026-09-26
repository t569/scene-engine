/**
 * Node types added by plugins.
 *
 * The core can't import a plugin (it would drag three.js into every SVG
 * banner), yet a plugin's node should be writable in a `SceneSpec` like any
 * other and validated at the same trust boundary. So a plugin registers its
 * type here, on import: a validator, run by `validateSceneSpec` with the same
 * helpers the core uses, and a builder, run by `createObject`.
 *
 * For TypeScript, a plugin also adds its spec to `NodeTypeMap` by module
 * augmentation, so `{ type: 'scene3d', ... }` type-checks in a `SceneSpec`.
 */
import type { BaseObject } from './objects.ts';
import type { BuildOptions } from './factory.ts';

/** What a validator may use: the core's own checks, bound to the spec being validated. */
export interface SpecContext {
  /** Throws a `SceneSpecError` naming `at` unless `src` compiles (params, `t`, plus `extra` names). */
  checkExpr(src: unknown, at: string, extra?: string[]): void;
  /** Throws unless `name` is one of the scene's params. */
  checkParamRef(name: unknown, at: string): void;
  /** Throws unless `c` is an inert colour string (hex, name, rgb(), hsl()). */
  checkColor(c: unknown, at: string): void;
  /** Throws a `SceneSpecError` with `message`. */
  fail(message: string): never;
}

/** What a builder gets: the variables expressions may use, and the host's options. */
export interface BuildContext {
  vars: readonly string[];
  options: BuildOptions;
}

export interface NodeTypeDef<S = unknown> {
  validate(node: Record<string, unknown>, at: string, ctx: SpecContext): void;
  create(spec: S, ctx: BuildContext): BaseObject;
}

const types = new Map<string, NodeTypeDef<never>>();
const BUILT_IN = new Set(['rect', 'circle', 'text', 'path', 'polyline', 'tex', 'space3d', 'plot', 'slider']);

/** Add a node type. Registering a built-in name, or the same name twice with a different definition, throws. */
export function registerNodeType<S>(type: string, def: NodeTypeDef<S>): void {
  if (BUILT_IN.has(type)) throw new Error(`"${type}" is a built-in node type`);
  const existing = types.get(type);
  if (existing && existing !== (def as unknown as NodeTypeDef<never>)) throw new Error(`node type "${type}" is already registered`);
  types.set(type, def as unknown as NodeTypeDef<never>);
}

export function nodeType(type: unknown): NodeTypeDef<unknown> | undefined {
  return typeof type === 'string' ? (types.get(type) as NodeTypeDef<unknown> | undefined) : undefined;
}

export function registeredTypes(): string[] {
  return [...types.keys()];
}
