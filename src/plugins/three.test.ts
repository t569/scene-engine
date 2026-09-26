import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, Vector3, Box3 } from 'three';
import { ResolutionGovernor, gltfExtensions, mergeStatic, sameOriginOnly } from './three.ts';
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

  it('ignores stalls (a tab switch is not a slow GPU)', () => {
    const g = new ResolutionGovernor();
    feed(g, 2000, 100);
    expect(g.scale).toBe(1);
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
