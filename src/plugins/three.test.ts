import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Texture, Mesh, MeshStandardMaterial, SphereGeometry, Vector3, Box3 } from 'three';
import { ResolutionGovernor, crawling, disposeObject, frameSignal, gltfExtensions, mergeStatic, sameOriginOnly } from './three.ts';
import { SceneSpecError, validateSceneSpec } from '../parse.ts';

// DOM- and GPU-free: the pure parts of the three plugin, and scene3d validation
// through the real validateSceneSpec (importing the plugin registers the type).

describe('ResolutionGovernor', () => {
  const feed = (g: ResolutionGovernor, ms: number, n: number) => {
    let changed = 0;
    for (let i = 0; i < n; i++) if (g.sample(ms)) changed++;
    return changed;
  };

  it('lowers the scale when frames come back slow, to a floor', () => {
    const g = new ResolutionGovernor(0.5);
    feed(g, 33, 20);
    expect(g.scale).toBe(0.8);
    feed(g, 33, 200);
    expect(g.scale).toBe(0.5);
  });

  it('holds at vsync, and wants more evidence to rise again after a drop', () => {
    const g = new ResolutionGovernor();
    feed(g, 16.7, 100);
    expect(g.scale).toBe(1); // 60 Hz is within budget
    feed(g, 30, 20);
    expect(g.scale).toBe(0.8);
    feed(g, 16.7, 20 * 5);
    expect(g.scale).toBe(0.8); // five good windows are not enough after a drop
    feed(g, 16.7, 20);
    expect(g.scale).toBe(1);
  });

  it('far over budget, drops within three frames, straight to a scale that fits', () => {
    const g = new ResolutionGovernor(0.1);
    expect(feed(g, 200, 3)).toBe(1); // 10x the 20 ms budget: cost goes with scale squared
    expect(g.scale).toBe(0.32); // sqrt(20 / 200)
  });

  it('ignores stalls (a tab switch is not a slow GPU)', () => {
    const g = new ResolutionGovernor();
    feed(g, 2000, 100);
    expect(g.scale).toBe(1);
  });
});

describe('frameSignal', () => {
  it('hears the gap, unless the GPU did under 40% of it: then fewer pixels would not help', () => {
    expect(frameSignal(33, null)).toBe(33); // no timer: the gap is all there is
    expect(frameSignal(33, 30)).toBe(33); // GPU-bound: drop resolution
    expect(frameSignal(33, 4)).toBe(4); // held at 30 Hz, GPU nearly idle: stay sharp
    expect(frameSignal(33, 0)).toBe(33); // no measurement yet
    // Fed to the governor, a 30 Hz page that costs the GPU 4 ms keeps full resolution.
    const g = new ResolutionGovernor(0.5);
    for (let i = 0; i < 200; i++) g.sample(frameSignal(33, 4));
    expect(g.scale).toBe(1);
  });
});

describe('crawling', () => {
  it('a still camera is not crawling, even when its angle to itself is float noise', () => {
    expect(crawling(0, 0, 8)).toBe(false);
    expect(crawling(1.49e-8, 0, 8)).toBe(false); // what Quaternion.angleTo gives for the same rotation
    expect(crawling(0.001, 0, 8)).toBe(true); // the tail of an orbit's ease-out
    expect(crawling(0, 0.01, 8)).toBe(true);
    expect(crawling(0.05, 0, 8)).toBe(false); // turning: not a tail
  });
});

describe('mergeStatic', () => {
  it('merges meshes that share a material into one per material, keeping world placement', () => {
    const steel = new MeshStandardMaterial();
    const paint = new MeshStandardMaterial();
    const part = new Group();
    const pins = new Group();
    pins.rotation.y = Math.PI / 2;
    for (let i = 0; i < 12; i++) {
      const pin = new Mesh(new BoxGeometry(0.1, 0.1, 0.1), steel);
      pin.position.set(i, 0, 0);
      pins.add(pin);
    }
    part.add(pins, new Mesh(new SphereGeometry(1), steel), new Mesh(new BoxGeometry(1, 1, 1), paint));
    const bounds = new Box3().setFromObject(part);
    expect(mergeStatic(part)).toEqual({ before: 14, after: 2 });
    const after = new Box3().setFromObject(part);
    expect(after.min.distanceTo(bounds.min)).toBeLessThan(1e-5); // float32 vertex data
    expect(after.max.distanceTo(bounds.max)).toBeLessThan(1e-5); // float32 vertex data
  });

  it('leaves kept objects (moving, clickable, recoloured) and their children alone', () => {
    const m = new MeshStandardMaterial();
    const part = new Group();
    const knob = new Group();
    knob.add(new Mesh(new BoxGeometry(), m), new Mesh(new BoxGeometry(), m));
    part.add(new Mesh(new BoxGeometry(), m), new Mesh(new BoxGeometry(), m), knob);
    expect(mergeStatic(part, (o) => o === knob)).toEqual({ before: 2, after: 1 });
    expect(knob.children).toHaveLength(2);
    expect(new Vector3().copy(knob.position).length()).toBe(0);
  });
});

describe('disposeObject', () => {
  it("frees a model copy's own resources but not the cached glTF's", () => {
    const geo = new BoxGeometry();
    const tex = new Texture();
    const mat = new MeshStandardMaterial({ map: tex });
    const variant = new MeshStandardMaterial();
    const gltf = { scene: new Group().add(new Mesh(geo, mat)), parser: { associations: new Map<unknown, unknown>([[mat, {}], [tex, {}], [variant, {}]]) } };
    const copy = new Group().add(new Mesh(geo, variant));
    copy.userData.gltf = gltf;
    const recoloured = new Mesh(new SphereGeometry(), mat.clone()); // owned material, cached texture
    const own = new Mesh(new SphereGeometry(), new MeshStandardMaterial());
    copy.add(recoloured, own);
    const freed: unknown[] = [];
    for (const x of [geo, tex, mat, variant, recoloured.geometry, recoloured.material, own.geometry, own.material]) x.addEventListener('dispose', () => freed.push(x));
    disposeObject(new Group().add(copy));
    expect(freed).toEqual([recoloured.geometry, recoloured.material, own.geometry, own.material]);
  });
});

describe('gltfExtensions', () => {
  const glb = (json: object) => {
    let text = JSON.stringify(json);
    while (text.length % 4) text += ' ';
    const body = new TextEncoder().encode(text);
    const buf = new ArrayBuffer(20 + body.length);
    const v = new DataView(buf);
    v.setUint32(0, 0x46546c67, true); // "glTF"
    v.setUint32(4, 2, true);
    v.setUint32(8, buf.byteLength, true);
    v.setUint32(12, body.length, true);
    v.setUint32(16, 0x4e4f534a, true); // "JSON"
    new Uint8Array(buf, 20).set(body);
    return buf;
  };

  it('reads extensionsUsed from a .glb and from a .gltf', () => {
    expect(gltfExtensions(glb({ asset: { version: '2.0' }, extensionsUsed: ['EXT_meshopt_compression', 'KHR_texture_basisu'] }))).toEqual([
      'EXT_meshopt_compression',
      'KHR_texture_basisu',
    ]);
    expect(gltfExtensions(new TextEncoder().encode(JSON.stringify({ extensionsUsed: ['KHR_draco_mesh_compression'] })).buffer)).toEqual([
      'KHR_draco_mesh_compression',
    ]);
  });

  it('says nothing, rather than throwing, about files it cannot read', () => {
    expect(gltfExtensions(glb({ asset: { version: '2.0' } }))).toEqual([]);
    expect(gltfExtensions(new Uint8Array([1, 2, 3]).buffer)).toEqual([]);
  });
});

describe('sameOriginOnly', () => {
  const base = 'https://shop.example/p/viewer.html';
  it('allows relative and same-origin URLs', () => {
    expect(sameOriginOnly('models/shoe.glb', base)).toBe('https://shop.example/p/models/shoe.glb');
    expect(sameOriginOnly('/m/a.glb', base)).toBe('https://shop.example/m/a.glb');
  });
  it('refuses other origins and non-web schemes', () => {
    expect(sameOriginOnly('https://tracker.example/pixel.glb', base)).toBeNull();
    expect(sameOriginOnly('javascript:alert(1)', base)).toBeNull();
    expect(sameOriginOnly('data:model/gltf+json,{}', base)).toBeNull();
  });
});

describe('scene3d validation', () => {
  const base = {
    width: 800,
    height: 600,
    params: { colour: { value: 0, min: 0, max: 2, step: 1 }, way: { value: 0, min: 0, max: 1, step: 1 }, spin: { value: 0, min: 0, max: 360 } },
  };
  const scene3d = (extra: object = {}) => ({
    type: 'scene3d',
    x: 400,
    y: 300,
    width: 800,
    height: 600,
    camera: { position: [3, 2, 4], target: [0, 0.5, 0], fov: 35 },
    orbit: { autoRotate: 1, minDistance: 1, maxDistance: 10, maxPolarAngle: 85 },
    lights: [{ type: 'directional', position: [3, 8, 4], castShadow: true }, { type: 'point', intensity: 5, visible_when: { expr: 'way' } }],
    objects: [
      { type: 'model', src: 'models/shoe.glb', fit: 2, variant_by: { param: 'way', variants: ['street', 'beach'] }, bind: { 'rotation.y': 'spin' } },
      { type: 'group', children: [{ type: 'box', size: [1, 1, 1], radius: 0.1, material: { color_by: { param: 'colour', palette: ['#fff', '#111', 'rgb(1,2,3)'] } }, on_click: { set: { colour: 2 } } }] },
    ],
    ...extra,
  });
  const ok = (node: object) => validateSceneSpec({ ...base, objects: [node] });
  const bad = (node: object, msg: RegExp) => expect(() => ok(node)).toThrow(msg);

  it('accepts a full scene: models, primitives, lights, params driving colour, variant, rotation and clicks', () => {
    expect(() => ok(scene3d())).not.toThrow();
    // 2D controls in the same spec drive it:
    expect(() =>
      validateSceneSpec({ ...base, objects: [scene3d(), { type: 'circle', radius: 10, on_click: { set: { colour: 1 } } }, { type: 'slider', param: 'spin', width: 200 }] }),
    ).not.toThrow();
  });

  it('keeps model URLs to the web: no javascript:, data: or file:', () => {
    for (const src of ['javascript:alert(1)', 'data:model/gltf+json,{}', 'file:///etc/passwd', ' JavaScript:x']) {
      bad(scene3d({ objects: [{ type: 'model', src }] }), /src must be an http\(s\) or relative URL/);
    }
    expect(() => ok(scene3d({ objects: [{ type: 'model', src: 'https://cdn.example/a.glb' }] }))).not.toThrow();
  });

  it('caps what costs: shadow-casting lights, objects, nesting, segments', () => {
    const caster = { type: 'spot', castShadow: true };
    bad(scene3d({ lights: [caster, caster, caster, caster, caster] }), /at most 4 may cast shadows/);
    bad(scene3d({ objects: Array.from({ length: 501 }, () => ({ type: 'sphere', radius: 1 })) }), /more than 500 objects/);
    let deep: object = { type: 'box', size: [1, 1, 1] };
    for (let i = 0; i < 10; i++) deep = { type: 'group', children: [deep] };
    bad(scene3d({ objects: [deep] }), /nest more than 8 deep/);
    bad(scene3d({ objects: [{ type: 'sphere', radius: 1, segments: 10000 }] }), /segments must be a whole number from 3 to 128/);
  });

  it('takes glow and particles as data, and caps the particle count', () => {
    const cloud = { type: 'particles', count: 3000, radius: 2, colors: ['#fff', '#8cf'], speed: 0.3 };
    expect(() => ok(scene3d({ bloom: { strength: 1, threshold: 0.6 }, objects: [cloud] }))).not.toThrow();
    bad(scene3d({ bloom: { strength: 50 } }), /bloom\.strength/);
    bad(scene3d({ objects: [cloud, { ...cloud, count: 48_000 }] }), /more than 50000 particles/);
    bad(scene3d({ objects: [{ ...cloud, colors: ['url(javascript:1)'] }] }), /colors\[0\]/);
  });

  it('takes a cinematic scene as data: flight path, camera binds, HDRI, fog, finish, model parts', () => {
    const film = scene3d({
      camera: { fov: 30, path: { points: [[0, 1, 6], [4, 1, 0], [0, 2, -6]], target: [[0, 0, 0], [0, 0.5, 0]], along: 'smoothstep(0, 1, spin)' }, bind: { fov: '30 + 10 * spin' } },
      environment: { src: 'hdri/studio.hdr', background: true, blur: 0.4, rotation: 90, intensity: 0.8 },
      fog: { color: '#05050a', near: 4, far: 30 },
      exposure: 1.2,
      finish: { grain: 0.3, vignette: 0.5, aberration: 3 },
      objects: [{ type: 'model', src: 'models/car.glb', parts: { 'wheel FL': { bind: { 'rotation.x': '720 * t' } }, body: { material: { color_by: { param: 'colour', palette: ['#f00', '#00f'] } } } } }],
    });
    expect(() => ok(film)).not.toThrow();
    bad(scene3d({ camera: { path: { points: [[0, 0, 0]], along: 'spin' } } }), /path\.points must be a list of 2 to 64/);
    bad(scene3d({ camera: { path: { points: [[0, 0, 0], [1, 1]], along: 'spin' } } }), /path\.points\[1\] must be \[x, y, z\]/);
    bad(scene3d({ camera: { path: { points: [[0, 0, 0], [1, 1, 1]], along: 'fetch(1)' } } }), /unknown function/);
    bad(scene3d({ camera: { bind: { roll: 'spin' } } }), /camera\.bind\.roll is not bindable/);
    bad(scene3d({ environment: { src: 'javascript:alert(1)' } }), /environment\.src must be an http\(s\) or relative URL/);
    bad(scene3d({ fog: { color: '#000', near: 10, far: 5 } }), /fog\.far must be beyond near/);
    bad(scene3d({ finish: { grain: 4 } }), /finish\.grain/);
    bad(scene3d({ minResolution: 0.01 }), /minResolution must be a number from 0.25 to 1/);
    bad(scene3d({ objects: [{ type: 'model', src: 'a.glb', parts: { lid: { bind: { 'material.color': '1' } } } }] }), /parts\.lid\.bind\.material\.color is not bindable/);
  });

  it('takes seeded scatters and falling grains, and caps the copies', () => {
    const cumin = { type: 'instances', count: 4000, shape: 'sphere', size: [0.05, 0.02, 0.02], scatter: { shape: 'heap', radius: 0.6, height: 0.25 }, colors: ['#8a5a2b', '#a87440'] };
    expect(() => ok(scene3d({ objects: [cumin, { ...cumin, scatter: { shape: 'box', size: [4, 0, 4] }, fall: { height: 3, speed: 0.8, spin: 1 } }] }))).not.toThrow();
    bad(scene3d({ objects: [cumin, { ...cumin, count: 16_001 }] }), /more than 20000 instances/);
    bad(scene3d({ objects: [{ ...cumin, shape: 'teapot' }] }), /shape must be one of sphere, box, cylinder/);
    bad(scene3d({ objects: [{ ...cumin, scatter: { shape: 'cloud' } }] }), /scatter\.shape must be one of heap, disc, box/);
    bad(scene3d({ objects: [{ ...cumin, fall: { height: 0 } }] }), /fall\.height must be a positive number/);
  });

  it('takes hover as data, checked like clicks', () => {
    expect(() => ok(scene3d({ objects: [{ type: 'sphere', radius: 1, on_hover: { set: { colour: 2 } } }] }))).not.toThrow();
    bad(scene3d({ objects: [{ type: 'sphere', radius: 1, on_hover: { set: { nope: 1 } } }] }), /on_hover\.set\.nope must name one of scene.params/);
    bad(scene3d({ objects: [{ type: 'sphere', radius: 1, on_hover: { set: { colour: 'red' } } }] }), /on_hover\.set\.colour must be a number/);
  });

  it('names the path of what is wrong', () => {
    bad(scene3d({ objects: [{ type: 'box', size: [1, 1, 1], bind: { 'material.color': 'colour' } }] }), /objects\[0\]\.objects\[0\]\.bind\.material\.color is not bindable/);
    bad(scene3d({ objects: [{ type: 'box', size: [1, 1, 1], material: { color_by: { param: 'nope', palette: ['#fff'] } } }] }), /color_by\.param must name one of scene.params/);
    bad(scene3d({ objects: [{ type: 'box', size: [1, 1, 1], material: { color: 'red" onload="x' } }] }), /material\.color must be a colour/);
    bad(scene3d({ objects: [{ type: 'teapot' }] }), /type must be one of model, box/);
    bad(scene3d({ lights: [{ type: 'laser' }] }), /lights\[0\]\.type must be one of/);
    bad(scene3d({ objects: [{ type: 'box', size: [1, 1, 1], bind: { 'position.x': 'alert(1)' } }] }), /unknown function/);
  });

  it('lists plugin types among the known ones', () => {
    expect(() => validateSceneSpec({ ...base, objects: [{ type: 'hologram' }] })).toThrow(SceneSpecError);
    expect(() => validateSceneSpec({ ...base, objects: [{ type: 'hologram' }] })).toThrow(/scene3d/);
  });
});
