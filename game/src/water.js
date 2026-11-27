// Operation: Sky Hunter — the river.
//
// A winding ribbon of water following the valley floor, with a small
// custom shader: shallow colour near the banks, flow ripples drifting
// downstream, sun glint where the ripples peak, and a fresnel sky
// reflection at grazing angles. The centre line is riverCenterZ() from
// terrain.js — the same curve the terrain's damp-soil band follows, so
// water and wet banks always line up.

import { WORLD } from './config.js';
import { riverCenterZ } from './terrain.js';

const THREE = window.THREE;
const HALF = WORLD.SIZE / 2;

export function buildRiver(scene, heightAt) {
  const N = 140;
  const verts = [];
  const uvs = [];
  const idx = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = -HALF + t * WORLD.SIZE;
    const zc = riverCenterZ(x);
    const halfW = 15 + 4 * Math.sin(x * 0.0016 + 2.0);
    const y = heightAt(x, zc) + 1.2;
    verts.push(x, y, zc - halfW, x, y, zc + halfW);
    uvs.push(t, 0, t, 1);
    if (i > 0) {
      const a = (i - 1) * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uDeep: { value: new THREE.Color(0x2f6f8f) },
      uShallow: { value: new THREE.Color(0x7fb8c8) },
      uSky: { value: new THREE.Color(0xbfd4e6) },
    },
  ]);
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    opacity: 0.9,
    fog: true,
    vertexShader: `
      #include <fog_pars_vertex>
      varying float vAcross;
      varying float vAlong;
      varying vec3 vWorldPos;
      void main() {
        vAcross = uv.y;
        vAlong = uv.x;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      #include <fog_pars_fragment>
      uniform float uTime;
      uniform vec3 uDeep;
      uniform vec3 uShallow;
      uniform vec3 uSky;
      varying float vAcross;
      varying float vAlong;
      varying vec3 vWorldPos;
      float whash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float wnoise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(whash(i), whash(i + vec2(1.0, 0.0)), u.x),
                   mix(whash(i + vec2(0.0, 1.0)), whash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      void main() {
        float edge = abs(vAcross - 0.5) * 2.0; // 0 mid-river, 1 at the banks
        // Flow: ripples drift downstream (along +X) with time.
        float flow = wnoise(vec2(vAlong * 220.0 - uTime * 0.55, vAcross * 14.0));
        float flow2 = wnoise(vec2(vAlong * 90.0 - uTime * 0.3 + 4.7, vAcross * 30.0));
        vec3 col = mix(uDeep, uShallow, smoothstep(0.55, 0.95, edge));
        col *= 0.92 + flow * 0.16;
        // Sun glint where the ripples peak, stronger mid-river.
        float glint = smoothstep(0.72, 0.95, flow * 0.6 + flow2 * 0.4);
        col += vec3(1.0, 0.95, 0.8) * glint * 0.5 * (1.0 - edge * 0.6);
        // Fresnel sky reflection at grazing angles.
        vec3 vdir = normalize(cameraPosition - vWorldPos);
        float fres = pow(1.0 - max(vdir.y, 0.0), 2.0);
        col = mix(col, uSky, fres * 0.55);
        gl_FragColor = vec4(col, 0.9);
        #include <fog_fragment>
      }`,
  });
  const river = new THREE.Mesh(geo, mat);
  scene.add(river);
  return {
    update(dt, time) {
      void dt;
      uniforms.uTime.value = time;
    },
  };
}
