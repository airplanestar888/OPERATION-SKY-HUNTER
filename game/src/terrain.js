// Operation: Sky Hunter — terrain mesh and ground materials.
//
// Builds the terrain mesh from heightAt() (the single source of truth —
// this file never changes elevations, only how they look). Two layers of
// colour: rich elevation/slope bands baked into vertex colours, plus a
// fragment-shader detail pass (onBeforeCompile) that blends rock on steep
// slopes, dry patches on high ground, damp soil along the winding river
// and fine grain everywhere, so the ground never reads as one flat sheet
// from either altitude.

import { WORLD } from './config.js';
import { fbm, clamp } from './random.js';

const THREE = window.THREE;
const SIZE = WORLD.SIZE;

// The river's winding centre line — must match water.js exactly, because
// the damp-soil band in the terrain shader follows the same curve.
export function riverCenterZ(x) {
  return WORLD.VALLEY_Z + 70 * Math.sin(x * 0.0011) + 35 * Math.sin(x * 0.0023 + 1.7);
}

function groundColor(x, z, h, slope) {
  // slope 0 = flat, 1 = cliff. Returns [r, g, b] in 0..1.
  const n = fbm(x * 0.004 + 3, z * 0.004 + 8, 31, 3);
  const patch = fbm(x * 0.0016 + 11, z * 0.0016 + 4, 47, 3); // broad dirt patches
  let r;
  let g;
  let b;
  if (h > 340) {
    // Highest ground: patchy scree snow on flats, exposed rock on steeps —
    // never a solid flat white cap.
    const snowAmt = clamp((fbm(x * 0.01 + 5, z * 0.01 + 2, 77, 3) * 1.4 - 0.25), 0, 1) * (slope < 0.45 ? 1 : 0.3);
    const rv = 0.42 + n * 0.1;
    r = rv + (0.8 - rv) * snowAmt;
    g = rv * 0.98 + (0.82 - rv * 0.98) * snowAmt;
    b = rv * 0.95 + (0.86 - rv * 0.95) * snowAmt;
  } else if (slope > 0.55) {
    // Exposed rock on steep ground, with brown geological variation.
    const v = 0.32 + n * 0.09;
    const brown = clamp((fbm(x * 0.002 + 21, z * 0.002 + 13, 55, 3) - 0.55) * 2.4, 0, 0.7);
    r = v + (0.42 - v) * brown;
    g = v * 0.97 + (0.35 - v * 0.97) * brown;
    b = v * 0.92 + (0.27 - v * 0.92) * brown;
  } else if (h > 150) {
    // high dry grass / dirt
    r = 0.36 + n * 0.07; g = 0.3 + n * 0.06; b = 0.16;
  } else if (h > 60) {
    // mixed grass and dirt, yellow-green on exposed hills
    r = 0.24 + n * 0.09; g = 0.34 + n * 0.07; b = 0.13;
  } else {
    // lush lowland grass — deeper green than before, never pale
    r = 0.1 + n * 0.05; g = 0.28 + n * 0.09; b = 0.08;
  }
  // Broad dirt patches break up the grass on mid and high ground.
  if (h <= 300 && slope <= 0.55) {
    const dirt = Math.max(0, patch - 0.62) * 2.2;
    r = r + (0.42 - r) * dirt;
    g = g + (0.33 - g) * dirt;
    b = b + (0.2 - b) * dirt;
  }
  // Darken the valley floor — damp riverside ground.
  const valley = Math.exp(-Math.pow((z - riverCenterZ(x)) / 200, 2));
  const d = 1 - 0.18 * valley;
  return [r * d, g * d, b * d];
}

// Fragment-level detail: fine grain, slope rock, dry patches and damp
// riverside soil, all computed per pixel from world position and the
// world-space normal, so the terrain stays varied right down to the
// ground instead of smearing 22 m vertex colours across the screen.
function addTerrainDetail(material) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWorldPos;
        varying vec3 vNormalW;`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        vNormalW = normalize(mat3(modelMatrix) * objectNormal);`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWorldPos;
        varying vec3 vNormalW;
        float vhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(vhash(i), vhash(i + vec2(1.0, 0.0)), u.x),
                     mix(vhash(i + vec2(0.0, 1.0)), vhash(i + vec2(1.0, 1.0)), u.x), u.y);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec2 wp = vWorldPos.xz;
          float n1 = vnoise(wp * 0.045);
          float n2 = vnoise(wp * 0.18 + 7.3);
          float n3 = vnoise(wp * 0.6 + 3.1);
          // Fine grain + mid-scale mottling, so the ground reads as varied
          // grass and dirt from low and high altitude, not one flat colour.
          diffuseColor.rgb *= 0.84 + n3 * 0.32;
          diffuseColor.rgb *= 0.88 + 0.24 * n1;
          // Steep ground exposes stone.
          float slope = 1.0 - vNormalW.y;
          float rockAmt = smoothstep(0.35, 0.62, slope);
          vec3 rockCol = vec3(0.42, 0.40, 0.37) * (0.85 + n2 * 0.3);
          diffuseColor.rgb = mix(diffuseColor.rgb, rockCol, rockAmt * 0.85);
          // Dry sun-baked patches on high exposed ground.
          float dryAmt = smoothstep(0.55, 0.8, n1) * smoothstep(60.0, 140.0, vWorldPos.y);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.45, 0.4, 0.22), dryAmt * 0.45);
          // Damp dark soil along the winding river (wp.y is world Z).
          float rz = -600.0 + 70.0 * sin(wp.x * 0.0011) + 35.0 * sin(wp.x * 0.0023 + 1.7);
          float damp = exp(-pow((wp.y - rz) / 130.0, 2.0));
          diffuseColor.rgb *= 1.0 - damp * 0.22;
        }`);
  };
}

export function buildTerrain(scene, heightAt) {
  const SEG = 192;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);
    // Slope from finite differences.
    const sx = heightAt(x + 24, z) - heightAt(x - 24, z);
    const sz = heightAt(x, z + 24) - heightAt(x, z - 24);
    const slope = clamp(Math.hypot(sx, sz) / 48, 0, 1);
    const col = groundColor(x, z, h, slope);
    colors[i * 3] = col[0];
    colors[i * 3 + 1] = col[1];
    colors[i * 3 + 2] = col[2];
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  addTerrainDetail(material);
  const terrain = new THREE.Mesh(geo, material);
  terrain.receiveShadow = true;
  scene.add(terrain);
  return terrain;
}
