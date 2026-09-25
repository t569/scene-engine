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
  AmbientLight,
  AnimationMixer,
  BoxGeometry,
  Box3,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  BackSide,
  DoubleSide,
  FrontSide,
  Group,
  HemisphereLight,
  MathUtils,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PMREMGenerator,
  PlaneGeometry,
  PointLight,
  ShadowMaterial,
  SphereGeometry,
  SpotLight,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
  type Light,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { compile, usesTime, type Compiled } from '../../expr.ts';
import type { BuildContext } from '../../registry.ts';
import type { VisibleWhen } from '../../types.ts';
import { ThreeNode, instantiate, loadGLTF, mergeStatic, sameOriginOnly } from './node.ts';
import type { Light3D, Material3D, Object3DSpec, Scene3DSpec } from './spec.ts';

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

export class Scene3DNode extends ThreeNode {
  /** Resolves when every model has loaded (or failed and been skipped). */
  readonly ready: Promise<void>;

  private readonly vars: readonly string[];
  private readonly binds3d: Array<{ f: Compiled; apply: (v: number) => Redraw }> = [];
  private readonly conds3d: Array<{ all: Condition[]; set: (ok: boolean) => Redraw }> = [];
  private readonly colours: Array<{ mat: MeshStandardMaterial; param: string; palette: Color[] }> = [];
  private readonly variants: Array<{ root: Object3D; gltf: GLTF; param: string; names: string[]; current: string }> = [];
  private readonly clickables = new Map<Object3D, Record<string, number>>();
  /** Objects something drives (bind, visible_when, on_click, color_by): never merged away. */
  private readonly dynamic = new Set<Object3D>();
  private readonly mixers: AnimationMixer[] = [];
  private timed3d = false;
  private seen = -1;
  private hover: { x: number; y: number } | null = null;

  constructor(
    private readonly spec: Scene3DSpec,
    private readonly ctx: BuildContext,
  ) {
    super({ ...spec, shadows: spec.shadows ?? 'soft', fov: spec.camera?.fov ?? 40 });
    this.vars = ctx.vars;

    const target = spec.camera?.target ?? [0, 0.5, 0];
    this.camera.position.set(...(spec.camera?.position ?? [4, 3, 6]));
    this.camera.lookAt(...target);
    if (spec.background) this.renderer.setClearColor(spec.background, 1);

    if ((spec.environment?.preset ?? 'studio') === 'studio') {
      const pmrem = new PMREMGenerator(this.renderer);
      this.world.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
      this.world.environmentIntensity = spec.environment?.intensity ?? 1;
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

    const loads: Promise<void>[] = [];
    for (const o of spec.objects) this.world.add(this.build(o, loads));
    this.ready = Promise.all(loads).then(() => this.invalidate('world'));

    if (spec.orbit !== false) {
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
    if (this.clickables.size) this.wireClicks();
  }

  /* ------------------------------------------------------------- building */

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
      case 'group':
        obj = new Group();
        for (const c of o.children) obj.add(this.build(c, loads));
        if (o.merge) mergeStatic(obj, (x) => this.dynamic.has(x));
        break;
      case 'model': {
        obj = new Group();
        const holder = obj;
        const resolve = this.ctx.options.resolveAsset ?? ((src: string) => sameOriginOnly(src, globalThis.location?.href ?? 'http://localhost/'));
        const url = resolve(o.src, 'model');
        if (!url) {
          console.warn(`scene3d: refused to load ${o.src} (not allowed by resolveAsset; default is same-origin only)`);
          break;
        }
        loads.push(
          loadGLTF(url, { renderer: this.renderer })
            .then(async (gltf) => {
              const copy = await instantiate(gltf);
              this.fitModel(copy, o.fit, o.fitAxis ?? 'max', o.center ?? true);
              this.shadowsOf(copy, o.castShadow ?? true, o.receiveShadow ?? true);
              holder.add(copy);
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
    if (o.type !== 'model') this.shadowsOf(obj, o.castShadow ?? true, o.receiveShadow ?? true);
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
    const driven = o.bind || o.visible_when || o.on_click || ('material' in o && o.material?.color_by);
    if (driven) this.dynamic.add(obj);
    return obj;
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
    if (this.hover) {
      this.canvas.style.cursor = this.clickTarget(this.hover.x, this.hover.y) ? 'pointer' : '';
      this.hover = null;
    }
    if (view) this.invalidate('view');
    return world;
  }

  private clickTarget(x: number, y: number): Record<string, number> | null {
    let o: Object3D | null = this.pick(x, y, [...this.clickables.keys()])?.object ?? null;
    while (o && !this.clickables.has(o)) o = o.parent;
    return o ? this.clickables.get(o)! : null;
  }

  private wireClicks(): void {
    const canvas = this.canvas;
    let down: { x: number; y: number } | null = null;
    const pd = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const pu = (e: PointerEvent) => {
      // A click, not the end of an orbit drag.
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      const set = this.clickTarget(e.clientX, e.clientY);
      if (set) for (const [name, v] of Object.entries(set)) this.scene?.params.set(name, v);
    };
    // Hover is only recorded here; the pick runs once per frame at most, in `drive`.
    const pm = (e: PointerEvent) => (this.hover = { x: e.clientX, y: e.clientY });
    canvas.addEventListener('pointerdown', pd);
    canvas.addEventListener('pointerup', pu);
    canvas.addEventListener('pointermove', pm);
    this.onCleanup(() => {
      canvas.removeEventListener('pointerdown', pd);
      canvas.removeEventListener('pointerup', pu);
      canvas.removeEventListener('pointermove', pm);
    });
  }
}
