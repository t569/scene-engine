/**
 * A WebGL viewport inside a scene, run by three.js.
 *
 * The SVG renderer draws every face as a DOM node: right for a diagram, wrong
 * for an imported model with twenty thousand triangles, real lights and soft
 * shadows. This node gives such a scene a canvas, driven by the scene's one
 * clock like everything else.
 *
 * Speed is the design constraint, for phones and laptops first:
 * - Draws on demand. Nothing moved, nothing drawn: an idle viewer costs the GPU
 *   nothing. `invalidate()` asks for a frame; controls, resizes and bindings
 *   ask on their own.
 * - Shadows are redrawn only when the world changed, not when the camera did.
 * - Resolution adapts: while frames are coming back slow (orbiting a heavy
 *   model on a phone) it renders fewer pixels, then one full-resolution frame
 *   once things settle, so a still image is always sharp.
 * - Pauses while scrolled off screen.
 * - By default the canvas is an overlay under the SVG rather than inside a
 *   `<foreignObject>`: measured smoother (a third of the janky frames) and it
 *   avoids Safari's foreignObject bugs. `layer: 'inline'` keeps the old way.
 */
import {
  ACESFilmicToneMapping,
  Matrix4,
  Mesh,
  Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  Plane,
  Quaternion,
  Raycaster,
  SRGBColorSpace,
  Scene as World,
  VSMShadowMap,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Intersection,
  type Material,
  type Texture,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BufferGeometry } from 'three';
import { BaseObject } from '../../objects.ts';
import { SVG_NS } from '../../scene.ts';
import type { BaseNodeSpec, SceneLike } from '../../types.ts';

export type ShadowMode = 'soft' | 'sharp' | 'none';
export type Quality = 'auto' | 'high' | 'low';

export interface ThreeOptions extends BaseNodeSpec {
  /** Viewport size in scene units. Centred on the node's x, y like every node. */
  width: number;
  height: number;
  /** Vertical field of view, degrees. */
  fov?: number;
  /** `soft` (blurred, VSM), `sharp` (PCF, cheaper) or `none`. `true`/`false` mean sharp/none. Default sharp. */
  shadows?: ShadowMode | boolean;
  /**
   * `overlay` (default): an HTML canvas under the SVG. SVG nodes draw on top of
   * the 3D view wherever they are in the array. `inline`: the canvas lives in
   * the SVG, so array order is paint order exactly, at some compositing cost.
   */
  layer?: 'overlay' | 'inline';
  /** `demand` (default): draw only when something changed. `always`: every frame. */
  render?: 'demand' | 'always';
  /** `auto` (default) adapts resolution to how fast frames come back. */
  quality?: Quality;
  /** Cap on device pixel ratio. Default 2: a 3× phone would otherwise render 9× the pixels. */
  maxPixelRatio?: number;
}

export type FrameFn = (dt: number, elapsed: number) => boolean | void;

/* ------------------------------------------------------------ pure helpers */

/**
 * Adaptive resolution. Fed the gap between consecutive rendered frames, it
 * lowers the render scale when they come back slower than the budget, and
 * raises it again after a run of good frames. Hysteresis stops it hunting:
 * after a drop it wants twice the evidence before trying to go back up. Pure.
 */
export class ResolutionGovernor {
  scale = 1;
  private window: number[] = [];
  private good = 0;
  private need = 3;

  constructor(
    readonly min = 0.5,
    /** Milliseconds a frame may take: a little over 60 Hz, so vsync itself reads as good. */
    readonly budget = 1000 / 50,
    readonly size = 20,
  ) {}

  /** Returns true when `scale` changed. */
  sample(ms: number): boolean {
    if (!(ms > 0) || ms > 250) return false; // a stall or a tab switch, not a signal
    this.window.push(ms);
    if (this.window.length < this.size) return false;
    const avg = this.window.reduce((a, b) => a + b, 0) / this.window.length;
    this.window.length = 0;
    if (avg > this.budget * 1.15 && this.scale > this.min) {
      this.scale = Math.max(this.min, Math.round(this.scale * 0.8 * 100) / 100);
      this.good = 0;
      this.need = 6;
      return true;
    }
    if (avg <= this.budget && this.scale < 1 && ++this.good >= this.need) {
      this.scale = Math.min(1, Math.round((this.scale / 0.8) * 100) / 100);
      this.good = 0;
      this.need = 3;
      return true;
    }
    return false;
  }
}

/**
 * The extensions a glTF declares it uses, read straight from the bytes, so the
 * loader fetches a decoder (Meshopt, KTX2, Draco) only when a model needs one.
 * Handles binary .glb and JSON .gltf. Pure.
 */
export function gltfExtensions(data: ArrayBuffer): string[] {
  const bytes = new Uint8Array(data);
  let json: string;
  // .glb: 12-byte header ("glTF", version, length), then chunk 0 = JSON.
  if (bytes.length >= 20 && bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46) {
    const view = new DataView(data);
    const len = view.getUint32(12, true);
    json = new TextDecoder().decode(bytes.subarray(20, 20 + len));
  } else {
    json = new TextDecoder().decode(bytes);
  }
  try {
    const doc = JSON.parse(json) as { extensionsUsed?: unknown };
    return Array.isArray(doc.extensionsUsed) ? doc.extensionsUsed.filter((e): e is string => typeof e === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * The default asset policy: same-origin and relative URLs only. A spec may be
 * written by a stranger; it must not make the viewer's browser call arbitrary
 * servers (tracking, fingerprinting). Hosts widen it with `resolveAsset`. Pure.
 */
export function sameOriginOnly(src: string, base: string): string | null {
  try {
    const url = new URL(src, base);
    const origin = new URL(base).origin;
    return url.origin === origin && (url.protocol === 'http:' || url.protocol === 'https:') ? url.href : null;
  } catch {
    return null;
  }
}

/* ----------------------------------------------------------------- loaders */

export interface LoaderConfig {
  /** Folder with basis_transcoder.js/.wasm (three ships them in examples/jsm/libs/basis/). Needed for KTX2 textures. */
  ktx2TranscoderPath?: string;
  /** Folder with the Draco decoder (three ships it in examples/jsm/libs/draco/). Needed for Draco meshes. */
  dracoDecoderPath?: string;
}

const loaderConfig: LoaderConfig = {};
// One of each: every KTX2 and Draco loader spins up its own worker pool.
let ktx2: Promise<import('three/addons/loaders/KTX2Loader.js').KTX2Loader> | null = null;
let draco: Promise<import('three/addons/loaders/DRACOLoader.js').DRACOLoader> | null = null;

export function configureLoaders(config: LoaderConfig): void {
  Object.assign(loaderConfig, config);
  ktx2 = null;
  draco = null;
}

const gltfCache = new Map<string, Promise<GLTF>>();

/**
 * Load a glTF / .glb once per URL; later calls share the parsed result.
 * Decoders for compressed geometry and textures are fetched only when the
 * file says it needs them. KTX2 textures need a `renderer` (to pick a GPU
 * format) and `configureLoaders({ ktx2TranscoderPath })`.
 */
export function loadGLTF(url: string, opts: { renderer?: WebGLRenderer } = {}): Promise<GLTF> {
  const key = new URL(url, globalThis.location?.href ?? 'http://localhost/').href;
  let p = gltfCache.get(key);
  if (!p) {
    p = fetchGLTF(key, opts.renderer);
    gltfCache.set(key, p);
    p.catch(() => gltfCache.delete(key)); // a failed load may succeed next time
  }
  return p;
}

async function fetchGLTF(url: string, renderer?: WebGLRenderer): Promise<GLTF> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`model ${url}: HTTP ${res.status}`);
  const data = await res.arrayBuffer();
  const exts = gltfExtensions(data);
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  if (exts.includes('EXT_meshopt_compression')) {
    const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js');
    loader.setMeshoptDecoder(MeshoptDecoder);
  }
  if (exts.includes('KHR_texture_basisu')) {
    if (!loaderConfig.ktx2TranscoderPath) throw new Error(`model ${url} uses KTX2 textures: call configureLoaders({ ktx2TranscoderPath })`);
    if (!renderer) throw new Error(`model ${url} uses KTX2 textures: load it through a ThreeNode (it needs a renderer)`);
    ktx2 ??= import('three/addons/loaders/KTX2Loader.js').then(({ KTX2Loader }) => new KTX2Loader().setTranscoderPath(loaderConfig.ktx2TranscoderPath!));
    const k = await ktx2;
    k.detectSupport(renderer);
    loader.setKTX2Loader(k);
  }
  if (exts.includes('KHR_draco_mesh_compression')) {
    if (!loaderConfig.dracoDecoderPath) throw new Error(`model ${url} uses Draco: call configureLoaders({ dracoDecoderPath })`);
    draco ??= import('three/addons/loaders/DRACOLoader.js').then(({ DRACOLoader }) => new DRACOLoader().setDecoderPath(loaderConfig.dracoDecoderPath!));
    loader.setDRACOLoader(await draco);
  }
  return loader.parseAsync(data, url.slice(0, url.lastIndexOf('/') + 1));
}

/**
 * A fresh copy of a loaded model's scene, skinned meshes included. Copies
 * share geometry and materials with the cached original, so they cost almost
 * nothing, but changing a material changes every copy: clone it first.
 */
export async function instantiate(gltf: GLTF): Promise<Object3D> {
  const { clone } = await import('three/addons/utils/SkeletonUtils.js');
  const copy = clone(gltf.scene);
  copy.userData.gltf = gltf;
  return copy;
}

/** Load (cached) and copy a model. See `loadGLTF` and `instantiate`. */
export async function loadModel(url: string, opts: { renderer?: WebGLRenderer } = {}): Promise<Object3D> {
  return instantiate(await loadGLTF(url, opts));
}

/**
 * Merge the static meshes under `root` that share a material (and shadow
 * flags) into one mesh each: one draw call instead of dozens. Each call costs
 * CPU to submit (on integrated GPUs, through ANGLE, noticeably): a PCB model
 * went from 279 to 100 calls and 7.1 to 4.5 ms of CPU per animated frame.
 *
 * Meshes are baked into `root`'s space, so merge per movable part, never
 * across parts you'll move, pick or hide separately. `keep(o)` protects an
 * object and everything under it. Skinned, instanced, morphing and
 * multi-material meshes are left as they are. Returns mesh counts.
 */
export function mergeStatic(root: Object3D, keep: (o: Object3D) => boolean = () => false): { before: number; after: number } {
  root.updateMatrixWorld(true);
  const toRoot = root.matrixWorld.clone().invert();
  const groups = new Map<string, Mesh[]>();
  let before = 0;
  const walk = (o: Object3D) => {
    if (o !== root && keep(o)) return;
    const m = o as Mesh & { isSkinnedMesh?: boolean; isInstancedMesh?: boolean };
    if (m.isMesh) {
      before++;
      const plain = !m.isSkinnedMesh && !m.isInstancedMesh && !Array.isArray(m.material) && m.visible && !Object.keys(m.geometry.morphAttributes).length;
      if (plain) {
        const key = `${(m.material as Material).uuid}|${m.castShadow}|${m.receiveShadow}|${m.renderOrder}`;
        (groups.get(key) ?? groups.set(key, []).get(key)!).push(m);
      }
    }
    for (const c of o.children) walk(c);
  };
  walk(root);
  let merged = 0;
  for (const meshes of groups.values()) {
    if (meshes.length < 2) continue;
    const geos = meshes.map((m) => m.geometry.clone().applyMatrix4(new Matrix4().multiplyMatrices(toRoot, m.matrixWorld)));
    // mergeGeometries needs the same attributes everywhere, and all indexed or none.
    const names = geos.map((g) => Object.keys(g.attributes)).reduce((a, b) => a.filter((n) => b.includes(n)));
    const mixed = geos.some((g) => !g.index);
    const ready: BufferGeometry[] = geos.map((g) => {
      for (const n of Object.keys(g.attributes)) if (!names.includes(n)) g.deleteAttribute(n);
      return mixed && g.index ? g.toNonIndexed() : g;
    });
    const geo = mergeGeometries(ready, false);
    for (const g of new Set([...geos, ...ready])) g.dispose();
    if (!geo) continue;
    const first = meshes[0]!;
    const mesh = new Mesh(geo, first.material);
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.renderOrder = first.renderOrder;
    root.add(mesh);
    for (const m of meshes) m.removeFromParent();
    merged += meshes.length - 1;
  }
  return { before, after: before - merged };
}

/** Free an object tree's GPU memory: geometries, materials and their textures. */
export function disposeObject(root: Object3D): void {
  root.traverse((o) => {
    const mesh = o as Mesh;
    mesh.geometry?.dispose();
    const mats = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
    for (const m of mats as Material[]) {
      for (const v of Object.values(m)) if ((v as Texture | null)?.isTexture) (v as Texture).dispose();
      m.dispose();
    }
  });
}

/* -------------------------------------------------------------------- node */

const SETTLE_MS = 150;
let hostRuleAdded = false;

export class ThreeNode extends BaseObject {
  /** The three.js scene. Named `world` so it can't be confused with the engine's `Scene`. */
  readonly world = new World();
  readonly camera: PerspectiveCamera;
  readonly renderer: WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  /** Set by `orbit()`. */
  orbitControls: OrbitControls | null = null;
  readonly governor: ResolutionGovernor;

  private readonly frames = new Set<FrameFn>();
  private readonly ray = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly placeholder: SVGGraphicsElement;
  private readonly overlay: boolean;
  protected readonly shadowMode: ShadowMode;
  private needsRender = true;
  private needsShadows = true;
  private onScreen = true;
  private observer: IntersectionObserver | null = null;
  private cssSize = { w: 0, h: 0 };
  private ratio = 0;
  private placed = '';
  private lastOpacity = '';
  private streak = 0;
  private lastRender = 0;
  private lowRes = false;
  private readonly lastQ = new Quaternion();
  private readonly lastP = new Vector3();
  private restore: Array<() => void> = [];
  private backdrop: HTMLDivElement | null = null;
  private backdropAt = '';

  constructor(private readonly opts: ThreeOptions) {
    const g = document.createElementNS(SVG_NS, 'g');
    super(g, opts);
    const { width: w, height: h } = opts;
    this.overlay = (opts.layer ?? 'overlay') === 'overlay';
    this.shadowMode = opts.shadows === true ? 'sharp' : opts.shadows === false ? 'none' : (opts.shadows ?? 'sharp');

    this.canvas = document.createElement('canvas');
    if (this.overlay) {
      // Holds the node's box in the SVG, so its screen position (and the node's
      // own x, y, scale, rotation) can be read back and given to the canvas.
      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('x', String(-w / 2));
      rect.setAttribute('y', String(-h / 2));
      rect.setAttribute('width', String(w));
      rect.setAttribute('height', String(h));
      rect.setAttribute('fill', 'none');
      rect.style.pointerEvents = 'none';
      g.appendChild(rect);
      this.placeholder = rect;
      this.canvas.style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${h}px;transform-origin:0 0;display:block;touch-action:none;`;
    } else {
      const fo = document.createElementNS(SVG_NS, 'foreignObject');
      fo.setAttribute('x', String(-w / 2));
      fo.setAttribute('y', String(-h / 2));
      fo.setAttribute('width', String(w));
      fo.setAttribute('height', String(h));
      g.appendChild(fo);
      this.placeholder = fo;
      this.canvas.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;';
      fo.appendChild(this.canvas);
    }

    this.renderer = new WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = this.shadowMode !== 'none';
    this.renderer.shadowMap.type = this.shadowMode === 'soft' ? VSMShadowMap : PCFShadowMap;
    // We decide when shadows are redrawn (see `invalidate`), except in `always` mode.
    this.renderer.shadowMap.autoUpdate = opts.render === 'always';

    this.camera = new PerspectiveCamera(opts.fov ?? 45, w / h, 0.05, 500);
    // The floor is in real pixels: never below 0.75 per CSS pixel. On a 2x phone that is half
    // resolution and looks fine; on a 1x laptop, half would be visibly soft.
    this.governor = new ResolutionGovernor(Math.min(1, Math.max(0.5, 0.75 / this.baseRatio())));
  }

  override onMount(scene: SceneLike): void {
    super.onMount(scene);
    const svg = scene.svg;
    if (this.overlay) {
      const mount = svg.parentElement;
      if (mount) {
        if (getComputedStyle(mount).position === 'static') {
          mount.style.position = 'relative';
          this.restore.push(() => (mount.style.position = ''));
        }
        // The SVG stays on top: positioned, transparent, and letting pointer
        // events through wherever nothing is painted, down to the canvas.
        const prev = { position: svg.style.position, pe: svg.style.pointerEvents, bg: svg.style.background };
        svg.style.position = 'relative';
        svg.style.pointerEvents = 'none';
        svg.classList.add('se-3d-host');
        if (!hostRuleAdded) {
          const style = document.createElement('style');
          style.textContent = '.se-3d-host > g { pointer-events: visiblePainted; }';
          document.head.appendChild(style);
          hostRuleAdded = true;
        }
        // An opaque SVG background would hide the canvas under it: it moves to a layer behind both, the SVG's size.
        if (prev.bg) {
          this.backdrop = document.createElement('div');
          this.backdrop.style.cssText = `position:absolute;pointer-events:none;background:${prev.bg};`;
          svg.style.background = 'transparent';
          mount.insertBefore(this.backdrop, svg);
        }
        mount.insertBefore(this.canvas, svg);
        this.restore.push(() => {
          svg.style.position = prev.position;
          svg.style.pointerEvents = prev.pe;
          svg.style.background = prev.bg;
          svg.classList.remove('se-3d-host');
          this.canvas.remove();
          this.backdrop?.remove();
        });
      }
    }
    // Off screen, nothing is drawn. The observer only flips a flag: the clock still decides when to draw.
    if (typeof IntersectionObserver !== 'undefined') {
      this.observer = new IntersectionObserver(([e]) => {
        this.onScreen = e?.isIntersecting ?? true;
        if (this.onScreen) this.needsRender = true;
      });
      this.observer.observe(this.canvas);
    }
  }

  /**
   * Ask for a frame. `world`: something in the scene changed (shadows are
   * redrawn too). `view`: only the camera, a colour or a light's brightness did.
   */
  invalidate(what: 'world' | 'view' = 'world'): void {
    this.needsRender = true;
    if (what === 'world') this.needsShadows = true;
  }

  /** Run `fn` every frame on the scene clock. Return true when it changed the world. Returns the unsubscribe. */
  onFrame(fn: FrameFn): () => void {
    this.frames.add(fn);
    return () => this.frames.delete(fn);
  }

  /** Orbit, pan and zoom with the pointer; wired to draw on demand and to adapt resolution. */
  orbit(target: [number, number, number] = [0, 0, 0]): OrbitControls {
    if (this.orbitControls) return this.orbitControls;
    const c = new OrbitControls(this.camera, this.canvas);
    c.target.set(...target);
    c.enableDamping = true;
    // Stronger than three's 0.05: the glide after a drag ends in about half the time.
    c.dampingFactor = 0.1;
    c.addEventListener('change', () => this.invalidate('view'));
    c.update();
    this.orbitControls = c;
    // dt, so auto-rotate turns by time, not by frame: an uneven frame is not a lurch.
    this.onFrame((dt) => void c.update(dt));
    return c;
  }

  override onUpdate(dt: number, elapsed: number): void {
    super.onUpdate(dt, elapsed);
    for (const fn of this.frames) if (fn(dt, elapsed) === true) this.invalidate('world');
    if (!this.onScreen) return;
    this.fit();
    const always = this.opts.render === 'always';
    if (this.needsRender || always) {
      const now = performance.now();
      // The camera is gliding to a stop (the tail of an ease-out) and nothing else moved:
      // that is when the eye reads detail, so draw it sharp. A still camera over animated
      // content is not a tail; it may need the reduced resolution as much as an orbit does.
      const cam = this.camera;
      const turn = cam.quaternion.angleTo(this.lastQ);
      const shift = cam.position.distanceTo(this.lastP);
      const small = 0.003 * Math.max(1, cam.position.length());
      const crawl = !this.needsShadows && (turn > 0 || shift > 0) && turn < 0.003 && shift < small;
      this.lastQ.copy(cam.quaternion);
      this.lastP.copy(cam.position);
      const busy = this.streak >= 2 && !crawl;
      if (busy && this.streak > 2) this.governor.sample(now - this.lastRender);
      const auto = (this.opts.quality ?? 'auto') !== 'high';
      this.drawFrame(busy && auto ? this.governor.scale : 1);
      this.lastRender = now;
      this.streak++;
    } else {
      this.streak = 0;
      // Settled after a burst of reduced-resolution frames: one sharp frame.
      if (this.lowRes && performance.now() - this.lastRender > SETTLE_MS) this.drawFrame(1);
    }
  }

  private drawFrame(scale: number): void {
    this.applyRatio(scale);
    if (this.opts.render !== 'always') this.renderer.shadowMap.needsUpdate = this.needsShadows;
    this.renderer.render(this.world, this.camera);
    this.needsRender = false;
    this.needsShadows = false;
    this.lowRes = scale < 1;
  }

  private baseRatio(): number {
    const cap = this.opts.quality === 'low' ? 1 : (this.opts.maxPixelRatio ?? 2);
    return Math.min(globalThis.devicePixelRatio || 1, cap);
  }

  private applyRatio(scale: number): void {
    const ratio = Math.round(this.baseRatio() * scale * 100) / 100;
    if (ratio === this.ratio) return;
    this.ratio = ratio;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(this.cssSize.w, this.cssSize.h, false);
  }

  /**
   * Place the canvas (overlay) and size its drawing buffer to real screen
   * pixels. Both come from the placeholder's screen matrix: it includes the
   * SVG's scaling to its box and the node's own transform.
   */
  private fit(): void {
    const m = this.placeholder.getScreenCTM();
    if (!m) return;
    const { width: w, height: h } = this.opts;
    if (this.overlay) {
      const mount = this.canvas.parentElement;
      if (mount) {
        const box = mount.getBoundingClientRect();
        const x = m.a * (-w / 2) + m.c * (-h / 2) + m.e - box.left - mount.clientLeft + mount.scrollLeft;
        const y = m.b * (-w / 2) + m.d * (-h / 2) + m.f - box.top - mount.clientTop + mount.scrollTop;
        const t = `matrix(${m.a},${m.b},${m.c},${m.d},${x},${y})`;
        if (t !== this.placed) {
          this.canvas.style.transform = t;
          this.placed = t;
        }
        const svg = this.scene?.svg;
        if (this.backdrop && svg) {
          const r = svg.getBoundingClientRect();
          const at = `${r.left - box.left - mount.clientLeft + mount.scrollLeft}px,${r.top - box.top - mount.clientTop + mount.scrollTop}px,${r.width}px,${r.height}px`;
          if (at !== this.backdropAt) {
            const [l, tp, wd, ht] = at.split(',');
            Object.assign(this.backdrop.style, { left: l, top: tp, width: wd, height: ht });
            this.backdropAt = at;
          }
        }
      }
    }
    const cw = Math.max(1, Math.round(w * Math.hypot(m.a, m.b)));
    const ch = Math.max(1, Math.round(h * Math.hypot(m.c, m.d)));
    if (cw === this.cssSize.w && ch === this.cssSize.h) return;
    this.cssSize = { w: cw, h: ch };
    this.ratio = 0; // force setSize at the new size
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.invalidate('view');
  }

  /** The overlay canvas follows the node's opacity (and `visible_when`). */
  override applyTransform(): void {
    super.applyTransform();
    if (!this.overlay) return;
    const o = this.el.getAttribute('opacity') ?? '1';
    if (o !== this.lastOpacity) {
      this.canvas.style.opacity = o;
      this.lastOpacity = o;
    }
  }

  /** Pointer → ray, through the canvas's own screen box: what the camera sees, whatever the SVG's scale. */
  private aim(clientX: number, clientY: number): Raycaster {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    return this.ray;
  }

  /** The nearest visible mesh under the pointer, among `targets` (default: everything). */
  pick(clientX: number, clientY: number, targets: Object3D[] = this.world.children): Intersection | null {
    const hits = this.aim(clientX, clientY).intersectObjects(targets, true);
    return hits.find((h) => h.object instanceof Mesh && h.object.visible) ?? null;
  }

  /** Where the pointer's ray meets the horizontal plane at height `y`: for dragging things across a floor. */
  groundPoint(clientX: number, clientY: number, y = 0): Vector3 | null {
    return this.aim(clientX, clientY).ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -y), new Vector3());
  }

  /** `loadModel`, with this node's renderer (so KTX2 textures work). Adds nothing to the world. */
  loadModel(url: string): Promise<Object3D> {
    return loadModel(url, { renderer: this.renderer });
  }

  override onDestroy(): void {
    this.frames.clear();
    this.observer?.disconnect();
    this.orbitControls?.dispose();
    disposeObject(this.world);
    this.world.environment?.dispose();
    this.renderer.dispose();
    // Browsers allow ~16 live WebGL contexts per page; give this one back now, not at GC.
    this.renderer.forceContextLoss();
    for (const fn of this.restore.splice(0)) fn();
    super.onDestroy();
  }
}
