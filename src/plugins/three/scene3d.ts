/**
 * Builds a `scene3d` spec (see spec.ts) into a ThreeNode: camera, controls,
 * studio light, shadow floor, lights and objects, and wires the scene's params
 * to 3D properties, colours, variants and visibility.
 *
 * Params are read only when they change (or every frame for expressions that
 * use `t`), and each change asks for exactly the redraw it needs: a colour or a
 * light's brightness redraws the view; a move redraws shadows too.
 */
import {
  AdditiveBlending,
  AmbientLight,
  AnimationMixer,
  BoxGeometry,
  Box3,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  DoubleSide,
  Euler,
  Fog,
  FrontSide,
  Group,
  HemisphereLight,
  InstancedMesh,
  MathUtils,
  Matrix4,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PMREMGenerator,
  PlaneGeometry,
  PointLight,
  Points,
  PointsMaterial,
  PropertyBinding,
  Quaternion,
  ShadowMaterial,
  SphereGeometry,
  SpotLight,
  TorusGeometry,
  Vector2,
  Vector3,
  type Light,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { compile, usesTime, type Compiled } from '../../expr.ts';
import type { BuildContext } from '../../registry.ts';
import type { VisibleWhen } from '../../types.ts';
import { ThreeNode, instantiate, loadGLTF, mergeStatic, sameOriginOnly } from './node.ts';
import type { InstancesObject, Light3D, Material3D, Object3DSpec, ParticlesObject, PartSpec, Scene3DSpec, Vec3 } from './spec.ts';

/** `f` is what's tested; `src` the compiled expression (for `usesTime`). */
type Condition = { f: Compiled; src: Compiled; min: number; max: number };
type Redraw = 'world' | 'view' | null;

const toConditions = (v: VisibleWhen | VisibleWhen[] | undefined, vars: readonly string[]): Condition[] =>
  (v === undefined ? [] : Array.isArray(v) ? v : [v]).map((c) => {
    const src = compile(c.expr, vars);
    // Neither bound: visible while the value is non-zero (the 2D rule).
    if (c.min === undefined && c.max === undefined) return { f: (env) => (src(env) !== 0 ? 1 : 0), src, min: 1, max: 1 };
    return { f: src, src, min: c.min ?? -Infinity, max: c.max ?? Infinity };
  });

/** Apply KHR_materials_variants to a model copy: swap in each mesh's variant material, or its original. */
async function applyVariant(root: Object3D, gltf: GLTF, name: string): Promise<void> {
  const names: string[] = (gltf.parser.json.extensions?.KHR_materials_variants?.variants ?? []).map((v: { name: string }) => v.name);
  const index = names.indexOf(name);
  const jobs: Promise<void>[] = [];
  root.traverse((o) => {
    const mesh = o as Mesh;
    const ext = mesh.isMesh ? mesh.userData.gltfExtensions?.KHR_materials_variants : undefined;
    if (!ext) return;
    mesh.userData.originalMaterial ??= mesh.material;
    const mapping = (ext.mappings as Array<{ material: number; variants: number[] }>).find((m) => m.variants.includes(index));
    if (!mapping) {
      mesh.material = mesh.userData.originalMaterial;
      return;
    }
    jobs.push(
      gltf.parser.getDependency('material', mapping.material).then((m) => {
        mesh.material = m;
        gltf.parser.assignFinalMaterial(mesh);
      }),
    );
  });
  await Promise.all(jobs);
}

/** mulberry32: a small seeded generator, so a scatter is the same on every load. */
function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Scene3DNode extends ThreeNode {
  /** Resolves when every model has loaded (or failed and been skipped). */
  readonly ready: Promise<void>;

  private readonly vars: readonly string[];
  private readonly binds3d: Array<{ f: Compiled; apply: (v: number) => Redraw }> = [];
  private readonly conds3d: Array<{ all: Condition[]; set: (ok: boolean) => Redraw }> = [];
  private readonly colours: Array<{ mat: MeshStandardMaterial; param: string; palette: Color[] }> = [];
  private readonly variants: Array<{ root: Object3D; gltf: GLTF; param: string; names: string[]; current: string }> = [];
  private readonly clickables = new Map<Object3D, Record<string, number>>();
  private readonly hoverables = new Map<Object3D, Record<string, number>>();
  /** The object under the pointer that has `on_hover`, and the param values to put back when it leaves. */
  private hovered: { obj: Object3D; restore: Record<string, number> } | null = null;
  /** Objects something drives (bind, visible_when, on_click, color_by): never merged away. */
  private readonly dynamic = new Set<Object3D>();
  private readonly mixers: AnimationMixer[] = [];
  /** Each particle cloud's clock: its motion is computed on the GPU from this alone. */
  private readonly clouds: Array<{ value: number }> = [];
  private timed3d = false;
  private seen = -1;
  /** The pointer's last position, to pick once per frame; 'out' when it left the canvas. */
  private hover: { x: number; y: number } | 'out' | null = null;
  /** Camera axes set by `camera.bind`, by key; they override the spec and the path. */
  private readonly camBound: Record<string, number> = {};
  private flight: { points: CatmullRomCurve3; look: CatmullRomCurve3 | null; at: number } | null = null;
  private camDirty = false;
  private readonly camTarget = new Vector3();

  constructor(
    private readonly spec: Scene3DSpec,
    private readonly ctx: BuildContext,
  ) {
    super({ ...spec, shadows: spec.shadows ?? 'soft', fov: spec.camera?.fov ?? 40 });
    this.vars = ctx.vars;

    const target = spec.camera?.target ?? [0, 0.5, 0];
    this.camera.position.set(...(spec.camera?.position ?? [4, 3, 6]));
    this.camera.lookAt(...target);
    if (spec.background) this.setClearColor(spec.background, 1);
    if (spec.fog) this.world.fog = new Fog(spec.fog.color, spec.fog.near ?? 0, spec.fog.far);

    const loads: Promise<void>[] = [];
    const env = spec.environment ?? {};
    if ((env.preset ?? 'studio') === 'studio') {
      const pmrem = new PMREMGenerator(this.renderer);
      this.world.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
    }
    this.world.environmentIntensity = env.intensity ?? 1;
    if (env.src) {
      const url = this.resolve(env.src, 'environment');
      if (url) loads.push(this.loadEnvironment(url, env));
    }

    const floorSize = (spec.floor && spec.floor.size) || 20;
    if (spec.floor !== false && spec.shadows !== 'none') {
      const floor = new Mesh(new CircleGeometry(floorSize / 2, 64), new ShadowMaterial({ opacity: (spec.floor && spec.floor.shadow) ?? 0.25 }));
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      this.world.add(floor);
    }

    const lights = spec.lights ?? [{ type: 'directional', position: [3, 8, 4], intensity: 1.6, castShadow: true }];
    for (const l of lights) this.addLight(l, floorSize);

    for (const o of spec.objects) this.world.add(this.build(o, loads));
    // Ready means on the GPU too: compiled and uploaded, so the first scroll past anything doesn't stall.
    this.ready = Promise.all(loads)
      .then(() => this.warm())
      .then(() => {
        this.invalidate('world');
        this.repaint();
      });

    const cam = spec.camera ?? {};
    for (const [key, src] of Object.entries(cam.bind ?? {})) {
      this.compileBind(src, (v) => {
        if (this.camBound[key] === v) return null;
        this.camBound[key] = v;
        this.camDirty = true;
        return 'view';
      });
    }
    if (cam.path) {
      const curve = (pts: Vec3[]) => new CatmullRomCurve3(pts.map((p) => new Vector3(...p)), false, 'centripetal');
      this.flight = { points: curve(cam.path.points), look: cam.path.target ? curve(cam.path.target) : null, at: 0 };
      this.compileBind(cam.path.along, (v) => {
        const at = Math.min(1, Math.max(0, v));
        if (this.flight!.at === at) return null;
        this.flight!.at = at;
        this.camDirty = true;
        return 'view';
      });
    }
    this.camDirty = !!(cam.path || cam.bind);

    // A camera the spec drives can't also be dragged: the next scroll would snap it back.
    if (spec.orbit !== false && !cam.path && !cam.bind) {
      const c = this.orbit(target);
      const o = typeof spec.orbit === 'object' ? spec.orbit : {};
      c.autoRotate = !!o.autoRotate;
      c.autoRotateSpeed = o.autoRotate ?? 0;
      if (o.minDistance !== undefined) c.minDistance = o.minDistance;
      if (o.maxDistance !== undefined) c.maxDistance = o.maxDistance;
      if (o.minPolarAngle !== undefined) c.minPolarAngle = MathUtils.degToRad(o.minPolarAngle);
      if (o.maxPolarAngle !== undefined) c.maxPolarAngle = MathUtils.degToRad(o.maxPolarAngle);
      c.enablePan = o.pan ?? true;
      c.enableZoom = o.zoom ?? true;
    }

    this.onFrame((dt, elapsed) => this.drive(dt, elapsed));
    if (this.clickables.size || this.hoverables.size) this.wireClicks();
  }

  /* ------------------------------------------------------------- building */

  private resolve(src: string, kind: string): string | null {
    const resolve = this.ctx.options.resolveAsset ?? ((s: string) => sameOriginOnly(s, globalThis.location?.href ?? 'http://localhost/'));
    const url = resolve(src, kind);
    if (!url) console.warn(`scene3d: refused to load ${src} (not allowed by resolveAsset; default is same-origin only)`);
    return url;
  }

  /** An .hdr environment: lighting and reflections, and optionally the backdrop. Replaces the preset when it lands. */
  private async loadEnvironment(url: string, env: NonNullable<Scene3DSpec['environment']>): Promise<void> {
    try {
      const { HDRLoader } = await import('three/addons/loaders/HDRLoader.js');
      const hdr = await new HDRLoader().loadAsync(url);
      if (this.destroyed) return void hdr.dispose();
      const pmrem = new PMREMGenerator(this.renderer);
      const tex = pmrem.fromEquirectangular(hdr).texture;
      pmrem.dispose();
      hdr.dispose();
      this.world.environment?.dispose();
      this.world.environment = tex;
      const turn = MathUtils.degToRad(env.rotation ?? 0);
      this.world.environmentRotation.y = turn;
      if (env.background) {
        this.world.background = tex;
        this.world.backgroundBlurriness = env.blur ?? 0;
        this.world.backgroundIntensity = env.intensity ?? 1;
        this.world.backgroundRotation.y = turn;
      }
      this.invalidate('view');
    } catch (e) {
      console.warn(`scene3d: could not load environment ${url}: ${e instanceof Error ? e.message : e}`);
    }
  }

  /** Path, then spec, then binds; one lookAt. Only when something moved. */
  private placeCamera(): void {
    const cam = this.spec.camera ?? {};
    const pos = this.camera.position;
    const f = this.flight;
    // getPoint, not getPointAt: point k of n is reached at along = k / (n - 1) however far apart the
    // points are, so an author can line chapters of a page up with points. (By arc length, one long
    // leg ate most of the scroll and every other shot drifted off its chapter.)
    if (f) f.points.getPoint(f.at, pos);
    else pos.set(...(cam.position ?? [4, 3, 6]));
    if (f?.look) f.look.getPoint(f.at, this.camTarget);
    else this.camTarget.set(...(cam.target ?? [0, 0.5, 0]));
    const b = this.camBound;
    for (const axis of ['x', 'y', 'z'] as const) {
      const p = b[`position.${axis}`];
      const t = b[`target.${axis}`];
      if (p !== undefined) pos[axis] = p;
      if (t !== undefined) this.camTarget[axis] = t;
    }
    const fov = b.fov;
    if (fov !== undefined && fov !== this.camera.fov) {
      this.camera.fov = Math.min(170, Math.max(1, fov));
      this.camera.updateProjectionMatrix();
    }
    this.camera.lookAt(this.camTarget);
  }

  private compileBind(src: string, apply: (v: number) => Redraw): void {
    const f = compile(src, this.vars);
    this.timed3d ||= usesTime(f);
    this.binds3d.push({ f, apply });
  }

  private addConditions(v: VisibleWhen | VisibleWhen[] | undefined, set: (ok: boolean) => Redraw): void {
    const all = toConditions(v, this.vars);
    if (!all.length) return;
    this.timed3d ||= all.some((c) => usesTime(c.src));
    this.conds3d.push({ all, set });
  }

  private addLight(l: Light3D, floorSize: number): void {
    const color = l.color ?? '#ffffff';
    let light: Light;
    switch (l.type) {
      case 'directional': {
        const d = new DirectionalLight(color, l.intensity ?? 1.5);
        const half = floorSize / 2;
        Object.assign(d.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 0.5, far: 100 });
        d.shadow.mapSize.set(2048, 2048);
        d.target.position.set(...(l.target ?? [0, 0, 0]));
        this.world.add(d.target);
        light = d;
        break;
      }
      case 'point': {
        const p = new PointLight(color, l.intensity ?? 10, l.distance ?? 0, 2);
        p.shadow.mapSize.set(512, 512);
        p.shadow.camera.near = 0.05;
        light = p;
        break;
      }
      case 'spot': {
        const s = new SpotLight(color, l.intensity ?? 20, l.distance ?? 0, MathUtils.degToRad(l.angle ?? 30), l.penumbra ?? 0.3, 2);
        s.shadow.mapSize.set(1024, 1024);
        s.target.position.set(...(l.target ?? [0, 0, 0]));
        this.world.add(s.target);
        light = s;
        break;
      }
      case 'ambient':
        light = new AmbientLight(color, l.intensity ?? 0.3);
        break;
      case 'hemisphere':
        light = new HemisphereLight(color, l.groundColor ?? '#444444', l.intensity ?? 0.5);
        break;
    }
    if (l.position) light.position.set(...l.position);
    if (l.castShadow && (light instanceof DirectionalLight || light instanceof PointLight || light instanceof SpotLight)) {
      light.castShadow = true;
      light.shadow.bias = -0.0005;
      light.shadow.radius = 8;
      light.shadow.blurSamples = 16;
    }
    if (l.id) light.name = l.id;
    // Brightness = bound (or spec) intensity × shown. Lights are dimmed, never hidden:
    // hiding one changes the light count and recompiles every shader.
    const state = { base: light.intensity, shown: 1 };
    const write = (): Redraw => {
      const next = state.base * state.shown;
      if (next === light.intensity) return null;
      light.intensity = next;
      return 'view';
    };
    for (const [key, src] of Object.entries(l.bind ?? {})) {
      if (key === 'intensity') this.compileBind(src, (v) => ((state.base = Math.max(0, v)), write()));
      else this.compileBind(src, this.axisSetter(light.position, key.split('.')[1] as 'x' | 'y' | 'z', 1));
    }
    this.addConditions(l.visible_when, (ok) => ((state.shown = ok ? 1 : 0), write()));
    this.world.add(light);
  }

  private axisSetter(vec: Vector3 | { x: number; y: number; z: number }, axis: 'x' | 'y' | 'z', factor: number) {
    return (v: number): Redraw => {
      const next = v * factor;
      if (vec[axis] === next) return null;
      vec[axis] = next;
      return 'world';
    };
  }

  private material(m: Material3D = {}): MeshStandardMaterial {
    const physical = (m.clearcoat ?? 0) > 0 || (m.transmission ?? 0) > 0;
    const mat = physical ? new MeshPhysicalMaterial() : new MeshStandardMaterial();
    mat.color.set(m.color ?? '#cccccc');
    mat.roughness = m.roughness ?? 0.5;
    mat.metalness = m.metalness ?? 0;
    mat.emissive.set(m.emissive ?? '#000000');
    mat.emissiveIntensity = m.emissiveIntensity ?? 1;
    mat.flatShading = m.flatShading ?? false;
    mat.side = m.side === 'double' ? DoubleSide : m.side === 'back' ? BackSide : FrontSide;
    if (m.opacity !== undefined && m.opacity < 1) {
      mat.transparent = true;
      mat.opacity = m.opacity;
    }
    if (mat instanceof MeshPhysicalMaterial) {
      mat.clearcoat = m.clearcoat ?? 0;
      mat.transmission = m.transmission ?? 0;
    }
    if (m.color_by) this.colours.push({ mat, param: m.color_by.param, palette: m.color_by.palette.map((c) => new Color(c)) });
    return mat;
  }

  private build(o: Object3DSpec, loads: Promise<void>[]): Object3D {
    let obj: Object3D;
    const mesh = (geo: BufferGeometry, m?: Material3D) => new Mesh(geo, this.material(m));
    switch (o.type) {
      case 'box': {
        const [w, h, d] = o.size;
        const r = Math.min(o.radius ?? 0, Math.min(w, h, d) / 2);
        obj = mesh(r > 0 ? new RoundedBoxGeometry(w, h, d, 3, r) : new BoxGeometry(w, h, d), o.material);
        break;
      }
      case 'sphere': {
        const seg = o.segments ?? 48;
        obj = mesh(new SphereGeometry(o.radius, seg, Math.max(2, Math.round(seg / 2))), o.material);
        break;
      }
      case 'cylinder':
        obj = mesh(new CylinderGeometry(o.radiusTop, o.radiusBottom, o.height, o.segments ?? 48), o.material);
        break;
      case 'plane':
        obj = mesh(new PlaneGeometry(o.size[0], o.size[1]), o.material);
        break;
      case 'torus':
        obj = mesh(new TorusGeometry(o.radius, o.tube, 24, 64), o.material);
        break;
      case 'particles':
        obj = this.particles(o);
        break;
      case 'instances':
        obj = this.instances(o);
        break;
      case 'group':
        obj = new Group();
        for (const c of o.children) obj.add(this.build(c, loads));
        if (o.merge) mergeStatic(obj, (x) => this.dynamic.has(x));
        break;
      case 'model': {
        obj = new Group();
        const holder = obj;
        const url = this.resolve(o.src, 'model');
        if (!url) break;
        const parts = Object.entries(o.parts ?? {}).map(([name, p]) => this.part(name, p));
        loads.push(
          loadGLTF(url, { renderer: this.renderer })
            .then(async (gltf) => {
              const copy = await instantiate(gltf);
              this.fitModel(copy, o.fit, o.fitAxis ?? 'max', o.center ?? true);
              this.shadowsOf(copy, o.castShadow ?? true, o.receiveShadow ?? true);
              holder.add(copy);
              for (const p of parts) p.attach(copy);
              if (o.variant) await applyVariant(copy, gltf, o.variant);
              if (o.variant_by) this.variants.push({ root: copy, gltf, param: o.variant_by.param, names: o.variant_by.variants, current: o.variant ?? '' });
              if (o.animation && gltf.animations.length) {
                const clip = typeof o.animation === 'string' ? gltf.animations.find((a) => a.name === o.animation) : gltf.animations[0];
                if (clip) {
                  const mixer = new AnimationMixer(copy);
                  mixer.clipAction(clip).play();
                  this.mixers.push(mixer);
                }
              }
              this.seen = -1; // re-apply params (a variant_by may now have something to switch)
              this.invalidate('world');
            })
            .catch((e: unknown) => console.warn(`scene3d: could not load ${o.src}: ${e instanceof Error ? e.message : e}`)),
        );
        break;
      }
    }
    if (o.position) obj.position.set(...o.position);
    if (o.rotation) obj.rotation.set(...(o.rotation.map((d) => MathUtils.degToRad(d)) as [number, number, number]));
    if (o.scale !== undefined) typeof o.scale === 'number' ? obj.scale.setScalar(o.scale) : obj.scale.set(...o.scale);
    // Falling grains move in the vertex shader; the shadow pass doesn't know, so they cast none.
    const falls = o.type === 'instances' && !!o.fall;
    if (o.type !== 'model' && o.type !== 'particles') this.shadowsOf(obj, o.castShadow ?? !falls, o.receiveShadow ?? !falls);
    if (o.id) obj.name = o.id;
    for (const [key, src] of Object.entries(o.bind ?? {})) {
      if (key === 'scale') {
        this.compileBind(src, (v) => {
          if (obj.scale.x === v && obj.scale.y === v && obj.scale.z === v) return null;
          obj.scale.setScalar(v);
          return 'world';
        });
      } else {
        const [prop, axis] = key.split('.') as ['position' | 'rotation', 'x' | 'y' | 'z'];
        this.compileBind(src, this.axisSetter(obj[prop], axis, prop === 'rotation' ? Math.PI / 180 : 1));
      }
    }
    this.addConditions(o.visible_when, (ok) => {
      if (obj.visible === ok) return null;
      obj.visible = ok;
      return 'world';
    });
    if (o.on_click) this.clickables.set(obj, o.on_click.set);
    if (o.on_hover) this.hoverables.set(obj, o.on_hover.set);
    const driven = o.bind || o.visible_when || o.on_click || o.on_hover || ('material' in o && o.material?.color_by);
    if (driven) this.dynamic.add(obj);
    return obj;
  }

  /**
   * A named node inside a model, driven before the model has even loaded: binds and conditions are
   * compiled now and remembered as offsets, and `attach` finds the node and applies them. Offsets are
   * from the node's rest pose, in its parent's units (the model's own, before `fit`).
   */
  private part(name: string, p: PartSpec): { attach: (root: Object3D) => void } {
    let node: Object3D | null = null;
    const rest = { position: new Vector3(), rotation: new Vector3(), scale: new Vector3(1, 1, 1) };
    const off = { position: new Vector3(), rotation: new Vector3(), scale: 1 };
    let shown = true;
    const mat = p.material ? this.material(p.material) : null;
    const write = (): Redraw => {
      if (!node) return null;
      node.position.copy(rest.position).add(off.position);
      node.rotation.set(rest.rotation.x + off.rotation.x, rest.rotation.y + off.rotation.y, rest.rotation.z + off.rotation.z);
      node.scale.copy(rest.scale).multiplyScalar(off.scale);
      node.visible = shown;
      return 'world';
    };
    for (const [key, src] of Object.entries(p.bind ?? {})) {
      if (key === 'scale') {
        this.compileBind(src, (v) => (off.scale === v ? null : ((off.scale = v), write())));
        continue;
      }
      const [prop, axis] = key.split('.') as ['position' | 'rotation', 'x' | 'y' | 'z'];
      const k = prop === 'rotation' ? Math.PI / 180 : 1;
      this.compileBind(src, (v) => (off[prop][axis] === v * k ? null : ((off[prop][axis] = v * k), write())));
    }
    this.addConditions(p.visible_when, (ok) => (shown === ok ? null : ((shown = ok), write())));
    return {
      attach: (root) => {
        // three renames glTF nodes it loads (spaces to underscores, and so on): try both spellings.
        node = root.getObjectByName(name) ?? root.getObjectByName(PropertyBinding.sanitizeNodeName(name)) ?? null;
        if (!node) return console.warn(`scene3d: no part named ${name} in the model`);
        rest.position.copy(node.position);
        rest.rotation.set(node.rotation.x, node.rotation.y, node.rotation.z);
        rest.scale.copy(node.scale);
        if (mat) node.traverse((m) => void ((m as Mesh).isMesh && ((m as Mesh).material = mat)));
        write();
      },
    };
  }

  /** A seeded scatter of one shape, in one InstancedMesh; `fall` moves it on the GPU. See spec.ts. */
  private instances(o: InstancesObject): InstancedMesh {
    const rand = seeded((o.seed ?? 1) ^ o.count);
    // Grains are a few pixels across: coarse shapes (a 7×5 sphere is 50 triangles), as 10 000 of them add up.
    const geo =
      o.shape === 'box' ? new BoxGeometry(1, 1, 1) : o.shape === 'cylinder' ? new CylinderGeometry(0.5, 0.5, 1, 5, 1, true) : new SphereGeometry(0.5, 7, 5);
    const mat = this.material(o.material);
    const mesh = new InstancedMesh(geo, mat, o.count);
    const { shape, radius = 1, height = radius * 0.5, size = [1, 1, 1] } = o.scatter;
    const jitter = o.jitter ?? 0.3;
    const palette = o.colors?.map((c) => new Color(c));
    const m = new Matrix4();
    const q = new Quaternion();
    const e = new Euler();
    const p = new Vector3();
    const sc = new Vector3();
    for (let i = 0; i < o.count; i++) {
      if (shape === 'box') p.set((rand() - 0.5) * size[0], (rand() - 0.5) * size[1], (rand() - 0.5) * size[2]);
      else {
        const r = radius * Math.sqrt(rand());
        const a = rand() * Math.PI * 2;
        // A heap: higher in the middle, a dome (1 - r²), and grains anywhere below its skin.
        const y = shape === 'heap' ? height * (1 - (r / radius) ** 2) * Math.sqrt(rand()) : 0;
        p.set(r * Math.cos(a), y, r * Math.sin(a));
      }
      e.set(rand() * Math.PI * 2, rand() * Math.PI * 2, rand() * Math.PI * 2);
      const k = 1 + (rand() * 2 - 1) * jitter;
      sc.set(o.size[0] * k, o.size[1] * k, o.size[2] * k);
      mesh.setMatrixAt(i, m.compose(p, q.setFromEuler(e), sc));
      if (palette) mesh.setColorAt(i, palette[Math.floor(rand() * palette.length)]!);
    }
    if (o.fall) {
      const time = { value: 0 };
      this.clouds.push(time);
      const { height: H, speed = 1, spin = 0.5 } = o.fall;
      mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, { uTime: time, uFall: { value: [H, speed, spin * Math.PI * 2] } });
        shader.vertexShader = `uniform float uTime; uniform vec3 uFall;
mat3 tumble(float a, vec3 k) { k = normalize(k); float c = cos(a), s = sin(a);
  return mat3(c + k.x*k.x*(1.0-c), k.y*k.x*(1.0-c) + k.z*s, k.z*k.x*(1.0-c) - k.y*s,
              k.x*k.y*(1.0-c) - k.z*s, c + k.y*k.y*(1.0-c), k.z*k.y*(1.0-c) + k.x*s,
              k.x*k.z*(1.0-c) + k.y*s, k.y*k.z*(1.0-c) - k.x*s, c + k.z*k.z*(1.0-c)); }
${shader.vertexShader}`
          .replace(
            '#include <beginnormal_vertex>',
            `float h = fract(sin(float(gl_InstanceID) * 12.9898) * 43758.5453);
  mat3 spinM = tumble(uTime * uFall.z * (0.5 + h), vec3(h - 0.5, 0.7, fract(h * 7.0) - 0.5));
  vec3 objectNormal = spinM * normal;`,
          )
          .replace('#include <begin_vertex>', 'vec3 transformed = spinM * position;')
          .replace(
            '#include <project_vertex>',
            // Each grain's own drop speed varies a little; it falls from the top of its span and wraps.
            // Not "im": three's instanced normal chunk already declares one.
            `mat4 fallM = instanceMatrix;
  fallM[3].y = mod(fallM[3].y - uTime * uFall.y * (0.75 + 0.5 * h), uFall.x);
  vec4 mvPosition = modelViewMatrix * fallM * vec4(transformed, 1.0);
  gl_Position = projectionMatrix * mvPosition;`,
          );
      };
      mesh.frustumCulled = false; // the stored positions aren't where the grains are drawn
      // Stored heights spread over the span the shader wraps them in.
      for (let i = 0; i < o.count; i++) {
        mesh.getMatrixAt(i, m);
        m.elements[13] = rand() * H;
        mesh.setMatrixAt(i, m);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }

  /**
   * Each point is stored as (ring radius, height, start angle); the vertex shader turns it to
   * angle + ω·t, ω falling off with the radius. Seeded, so a still frame is the same every load.
   */
  private particles(o: ParticlesObject): Points {
    const rand = seeded(0x9e3779b9 ^ o.count);
    const R = o.radius;
    const palette = (o.colors ?? ['#ffffff']).map((c) => new Color(c));
    const pos = new Float32Array(o.count * 3);
    const col = new Float32Array(o.count * 3);
    for (let i = 0; i < o.count; i++) {
      let rho: number;
      let y: number;
      if (o.shape === 'shell') {
        const r = R * (0.6 + 0.4 * Math.cbrt(rand()));
        const cos = 2 * rand() - 1;
        [rho, y] = [r * Math.sqrt(1 - cos * cos), r * cos];
      } else {
        rho = R * (0.25 + 0.75 * Math.sqrt(rand()));
        y = R * 0.06 * (rand() + rand() + rand() - 1.5); // thin, thicker in the middle
      }
      pos.set([rho, y, rand() * Math.PI * 2], i * 3);
      palette[Math.floor(rand() * palette.length)]!.toArray(col, i * 3);
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('color', new BufferAttribute(col, 3));
    const time = { value: 0 };
    this.clouds.push(time);
    const mat = new PointsMaterial({ size: o.size ?? 0.04, vertexColors: true, transparent: true, depthWrite: false, blending: AdditiveBlending });
    // three sizes points by the renderer's canvas, even when drawing into a target. A shared
    // renderer's canvas is the host's, so the scale comes from what is being drawn into instead.
    const scale = { value: 1 };
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, { uTime: time, uSpeed: { value: o.speed ?? 0.25 }, uRadius: { value: R }, uScale: scale });
      shader.vertexShader = `uniform float uTime, uSpeed, uRadius, uScale;\n${shader.vertexShader}`
        .replace(
          '#include <begin_vertex>',
          `float a = position.z + uSpeed * sqrt(uRadius / max(position.x, 0.15 * uRadius)) * uTime;
        vec3 transformed = vec3(position.x * cos(a), position.y + 0.02 * uRadius * sin(2.0 * a), position.x * sin(a));`,
        )
        .replace('( scale / - mvPosition.z )', '( uScale / - mvPosition.z )');
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        '#include <color_fragment>\n\tdiffuseColor.a *= smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));',
      );
    };
    const points = new Points(geo, mat);
    const buffer = new Vector2();
    // Half the height drawn into, per unit of `size` (which three multiplies by the pixel ratio).
    points.onBeforeRender = (renderer) =>
      void (scale.value = (0.5 * (renderer.getRenderTarget()?.height ?? renderer.getDrawingBufferSize(buffer).y)) / renderer.getPixelRatio());
    points.frustumCulled = false; // the stored positions aren't where the points are drawn
    return points;
  }

  private shadowsOf(root: Object3D, cast: boolean, receive: boolean): void {
    root.traverse((m) => {
      if ((m as Mesh).isMesh) {
        m.castShadow = cast;
        m.receiveShadow = receive;
      }
    });
  }

  /** Scale a model so one dimension is `fit` units; optionally centre it on x/z and stand it on y = 0. */
  private fitModel(root: Object3D, fit: number | undefined, axis: 'max' | 'width' | 'height' | 'depth', center: boolean): void {
    const box = new Box3().setFromObject(root);
    if (fit) {
      const size = box.getSize(new Vector3());
      const dim = axis === 'width' ? size.x : axis === 'height' ? size.y : axis === 'depth' ? size.z : Math.max(size.x, size.y, size.z);
      if (dim > 0) root.scale.multiplyScalar(fit / dim);
      box.setFromObject(root);
    }
    if (center) {
      const c = box.getCenter(new Vector3());
      root.position.x -= c.x;
      root.position.z -= c.z;
      root.position.y -= box.min.y;
    }
  }

  /* -------------------------------------------------------------- driving */

  private drive(dt: number, elapsed: number): boolean {
    let world = false;
    let view = false;
    for (const m of this.mixers) {
      m.update(dt);
      world = true;
    }
    for (const c of this.clouds) {
      if (c.value === elapsed) continue;
      c.value = elapsed;
      view = true; // particles cast no shadows
    }
    const version = this.scene?.params.version ?? 0;
    if (this.timed3d || dt === 0 || version !== this.seen) {
      this.seen = version;
      const env = this.envAt(elapsed);
      for (const b of this.binds3d) {
        const v = b.f(env);
        if (!Number.isFinite(v)) continue;
        const r = b.apply(v);
        if (r === 'world') world = true;
        else if (r === 'view') view = true;
      }
      for (const c of this.conds3d) {
        const ok = c.all.every(({ f, min, max }) => {
          const v = f(env);
          return v >= min && v <= max;
        });
        const r = c.set(ok);
        if (r === 'world') world = true;
        else if (r === 'view') view = true;
      }
      for (const c of this.colours) {
        const i = Math.min(c.palette.length - 1, Math.max(0, Math.round(env[c.param] ?? 0) || 0));
        if (!c.mat.color.equals(c.palette[i]!)) {
          c.mat.color.copy(c.palette[i]!);
          view = true;
        }
      }
      for (const v of this.variants) {
        const i = Math.min(v.names.length - 1, Math.max(0, Math.round(env[v.param] ?? 0) || 0));
        const name = v.names[i]!;
        if (name !== v.current) {
          v.current = name;
          void applyVariant(v.root, v.gltf, name).then(() => this.invalidate('view'));
        }
      }
    }
    if (this.camDirty) {
      this.camDirty = false;
      this.placeCamera();
      view = true;
    }
    if (this.hover) {
      const at = this.hover === 'out' ? null : this.hover;
      this.hover = null;
      this.canvas.style.cursor = at && this.owner(this.clickables, at.x, at.y) ? 'pointer' : '';
      const over = at ? this.owner(this.hoverables, at.x, at.y) : null;
      if (over !== (this.hovered?.obj ?? null)) {
        const params = this.scene?.params;
        if (this.hovered) for (const [name, v] of Object.entries(this.hovered.restore)) params?.set(name, v);
        this.hovered = null;
        if (over && params) {
          const set = this.hoverables.get(over)!;
          this.hovered = { obj: over, restore: Object.fromEntries(Object.keys(set).map((n) => [n, params.get(n)])) };
          for (const [name, v] of Object.entries(set)) params.set(name, v);
        }
      }
    }
    if (view) this.invalidate('view');
    return world;
  }

  /** The object in `map` under the pointer: the nearest hit mesh, or the first ancestor of it in the map. */
  private owner(map: Map<Object3D, unknown>, x: number, y: number): Object3D | null {
    if (!map.size) return null;
    let o: Object3D | null = this.pick(x, y, [...map.keys()])?.object ?? null;
    while (o && !map.has(o)) o = o.parent;
    return o;
  }

  private wireClicks(): void {
    const canvas = this.canvas;
    let down: { x: number; y: number } | null = null;
    const pd = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const pu = (e: PointerEvent) => {
      // A click, not the end of an orbit drag.
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      const o = this.owner(this.clickables, e.clientX, e.clientY);
      if (o) for (const [name, v] of Object.entries(this.clickables.get(o)!)) this.scene?.params.set(name, v);
    };
    // Hover is only recorded here; the pick runs once per frame at most, in `drive`.
    const pm = (e: PointerEvent) => (this.hover = { x: e.clientX, y: e.clientY });
    const pl = () => (this.hover = 'out');
    canvas.addEventListener('pointerdown', pd);
    canvas.addEventListener('pointerup', pu);
    canvas.addEventListener('pointermove', pm);
    canvas.addEventListener('pointerleave', pl);
    this.onCleanup(() => {
      canvas.removeEventListener('pointerdown', pd);
      canvas.removeEventListener('pointerup', pu);
      canvas.removeEventListener('pointermove', pm);
      canvas.removeEventListener('pointerleave', pl);
    });
  }
}
