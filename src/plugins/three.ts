/**
 * `@t569/scene-engine/three`: WebGL scenes, by code (`ThreeNode`) or as data
 * (`{ type: 'scene3d', … }` in a SceneSpec, registered on import).
 *
 * Opt-in: `three` is a peer dependency of this entry alone, so importing the
 * core never pulls in three.js.
 */
import { registerNodeType } from '../registry.ts';
import { Scene3DNode } from './three/scene3d.ts';
import { validateScene3D, type Scene3DSpec } from './three/spec.ts';

export {
  ThreeNode,
  ResolutionGovernor,
  configureLoaders,
  disposeObject,
  gltfExtensions,
  instantiate,
  loadGLTF,
  loadModel,
  mergeStatic,
  sameOriginOnly,
  type FrameFn,
  type LoaderConfig,
  type Quality,
  type ShadowMode,
  type ThreeOptions,
} from './three/node.ts';
export { Scene3DNode } from './three/scene3d.ts';
export {
  LIMITS_3D,
  validateScene3D,
  type Light3D,
  type Material3D,
  type Object3DSpec,
  type Scene3DSpec,
  type Vec3,
} from './three/spec.ts';

registerNodeType<Scene3DSpec>('scene3d', {
  validate: validateScene3D,
  create: (spec, ctx) => new Scene3DNode(spec, ctx),
});
