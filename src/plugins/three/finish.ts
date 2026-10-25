/**
 * The film finish: grain, vignette and chromatic aberration in one full-screen pass, after tone
 * mapping (so the grain is in display space, as a camera's would be). One pass, not three: each
 * pass is a full read and write of the frame, and on a phone that is the cost that matters.
 */
export interface FinishOptions {
  /** Film grain, 0–1. It moves with the scene's clock, so a still frame keeps a still grain. */
  grain?: number;
  /** Darkened corners, 0–1. */
  vignette?: number;
  /** Colour fringes towards the edges, in pixels at the corners. */
  aberration?: number;
}

export const FinishShader = {
  name: 'FinishShader',
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: 0 },
    uVignette: { value: 0 },
    uAberration: { value: 0 },
    uResolution: { value: [1, 1] as [number, number] },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uGrain, uVignette, uAberration;
    uniform vec2 uResolution;
    varying vec2 vUv;
    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }
    void main() {
      vec2 d = vUv - 0.5;
      // Fringe grows with the square of the distance from the centre: clean middle, split corners.
      vec2 shift = d * dot(d, d) * 2.0 * uAberration / uResolution;
      vec4 c = texture2D(tDiffuse, vUv);
      if (uAberration > 0.0) {
        c.r = texture2D(tDiffuse, vUv + shift).r;
        c.b = texture2D(tDiffuse, vUv - shift).b;
      }
      c.rgb *= 1.0 - uVignette * smoothstep(0.25, 0.85, length(d * vec2(1.0, 0.85)) * 1.25);
      // Grain: strongest in the mid-tones, where film shows it.
      float n = hash(floor(vUv * uResolution) + fract(uTime * 7.31) * 97.0) - 0.5;
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb += n * uGrain * 0.18 * (1.0 - abs(l * 2.0 - 1.0) * 0.6);
      gl_FragColor = c;
    }`,
};
