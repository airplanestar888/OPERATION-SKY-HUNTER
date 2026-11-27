// Operation: Sky Hunter — vegetation, rocks and ground cover.
//
// Layered instanced pines (trunk + three foliage tiers), bushes, rocks
// and grass tufts, placed by a forest mask so the map reads as dense
// forest in some regions and open hills in others, with clusters along
// the river and the roads. Everything is InstancedMesh (7 draw calls in
// total) with per-instance colour variation and a gentle wind sway driven
// by one shared time uniform. Vegetation is visual only — it never
// enters the physics obstacle list.

import { WORLD } from './config.js';
import { fbm, clamp, mulberry32 } from './random.js';
import { riverCenterZ } from './terrain.js';

const THREE = window.THREE;
const HALF = WORLD.SIZE / 2;

// One shared clock for every swaying material.
const windTime = { value: 0 };

// Adds a subtle wind sway to an instanced standard material: the top of
// each instance leans with a sine wave whose phase comes from the
// instance's world position, so neighbours never move in lock-step.
function addWindSway(material, strength, height) {
  const half = (height / 2).toFixed(2);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 iOff = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          float swayPhase = iOff.x * 0.15 + iOff.z * 0.17;
          float swayAmt = smoothstep(-${half}, ${half}, transformed.y) * ${strength.toFixed(2)};
          transformed.x += sin(uTime * 1.3 + swayPhase) * swayAmt;
          transformed.z += cos(uTime * 1.1 + swayPhase) * swayAmt * 0.7;
        #endif`);
  };
}

function scatter(rnd, heightAt, count, accept) {
  const spots = [];
  let guard = 0;
  while (spots.length < count && guard++ < count * 12) {
    const x = (rnd() * 2 - 1) * (HALF - 60);
    const z = (rnd() * 2 - 1) * (HALF - 60);
    const h = heightAt(x, z);
    const spot = accept(x, z, h, rnd);
    if (spot) spots.push(spot);
  }
  return spots;
}

export function buildVegetation(scene, heightAt) {
  const rnd = mulberry32(20261127);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();

  function nearRunway(x, z, d) {
    return Math.hypot(x - WORLD.RUNWAY.x, z - WORLD.RUNWAY.z) < d;
  }
  function slopeAt(x, z) {
    return Math.abs(heightAt(x + 20, z) - heightAt(x - 20, z)) / 40;
  }

  // ---- trees: layered pines, dense where the forest mask says so ------
  const treeSpots = scatter(rnd, heightAt, 1100, (x, z, h) => {
    if (h < 4 || h > 185) return null;
    if (nearRunway(x, z, 330)) return null;
    if (Math.abs(z - riverCenterZ(x)) < 26) return null; // keep the river clear
    if (slopeAt(x, z) > 0.5) return null;
    const forest = fbm(x * 0.0012 + 5, z * 0.0012 + 9, 13, 3);
    const nearRiver = Math.abs(z - riverCenterZ(x)) < 130;
    if (forest < 0.55 && !nearRiver && rnd() > 0.22) return null; // sparse outside forests
    return { x, z, h, s: 0.6 + rnd() * 1.2 };
  });

  const trunkGeo = new THREE.CylinderGeometry(0.5, 0.8, 5, 5);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeSpots.length);
  const foliageMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  addWindSway(foliageMat, 0.35, 6);
  // Three foliage tiers make a real pine silhouette instead of one cone.
  const tierDefs = [
    { r: 3.6, h: 7, y: 7.0 },
    { r: 2.7, h: 6, y: 10.5 },
    { r: 1.8, h: 5, y: 13.5 },
  ];
  const tiers = tierDefs.map((t) => {
    const m = new THREE.InstancedMesh(new THREE.ConeGeometry(t.r, t.h, 6), foliageMat, treeSpots.length);
    m.castShadow = true;
    m.frustumCulled = false;
    return m;
  });
  trunks.frustumCulled = false;
  treeSpots.forEach((t, i) => {
    q.setFromAxisAngle(up, rnd() * Math.PI * 2);
    m4.compose(new THREE.Vector3(t.x, t.h + 2.5 * t.s, t.z), q, new THREE.Vector3(t.s, t.s, t.s));
    trunks.setMatrixAt(i, m4);
    col.setHSL(0.07 + rnd() * 0.02, 0.32 + rnd() * 0.12, 0.2 + rnd() * 0.08);
    trunks.setColorAt(i, col);
    tierDefs.forEach((td, k) => {
      m4.compose(new THREE.Vector3(t.x, t.h + td.y * t.s, t.z), q, new THREE.Vector3(t.s, t.s, t.s));
      tiers[k].setMatrixAt(i, m4);
    });
    // Layered greens: darker at the base tier, sunlit at the top.
    col.setHSL(0.29 + rnd() * 0.05, 0.42 + rnd() * 0.18, 0.2 + rnd() * 0.08);
    tiers[0].setColorAt(i, col);
    col.setHSL(0.29 + rnd() * 0.05, 0.45 + rnd() * 0.18, 0.26 + rnd() * 0.08);
    tiers[1].setColorAt(i, col);
    col.setHSL(0.28 + rnd() * 0.05, 0.42 + rnd() * 0.18, 0.32 + rnd() * 0.09);
    tiers[2].setColorAt(i, col);
  });
  scene.add(trunks);
  tiers.forEach((t) => scene.add(t));

  // ---- bushes and shrubs ----------------------------------------------
  const bushSpots = scatter(rnd, heightAt, 600, (x, z, h) => {
    if (h < 4 || h > 170) return null;
    if (nearRunway(x, z, 320)) return null;
    if (Math.abs(z - riverCenterZ(x)) < 22) return null;
    if (slopeAt(x, z) > 0.6) return null;
    return { x, z, h, s: 0.7 + rnd() * 1.1 };
  });
  const bushMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  addWindSway(bushMat, 0.22, 2);
  const bushes = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.6, 0), bushMat, bushSpots.length);
  bushes.frustumCulled = false;
  bushSpots.forEach((b, i) => {
    q.setFromAxisAngle(up, rnd() * Math.PI * 2);
    m4.compose(
      new THREE.Vector3(b.x, b.h + 0.7 * b.s, b.z), q,
      new THREE.Vector3(b.s * (1 + rnd() * 0.5), b.s * 0.62, b.s * (1 + rnd() * 0.5)),
    );
    bushes.setMatrixAt(i, m4);
    col.setHSL(0.27 + rnd() * 0.06, 0.38 + rnd() * 0.16, 0.2 + rnd() * 0.09);
    bushes.setColorAt(i, col);
  });
  scene.add(bushes);

  // ---- rocks: exposed stone on slopes and along the banks -------------
  const rockSpots = scatter(rnd, heightAt, 420, (x, z, h) => {
    if (h < 2 || h > 320) return null;
    if (nearRunway(x, z, 320)) return null;
    const nearBank = Math.abs(z - riverCenterZ(x)) < 55 && Math.abs(z - riverCenterZ(x)) > 20;
    const steep = slopeAt(x, z) > 0.4;
    if (!nearBank && !steep && rnd() > 0.3) return null;
    return { x, z, h, s: 0.5 + rnd() * 1.6 };
  });
  const rockMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
  const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1.4, 0), rockMat, rockSpots.length);
  rocks.castShadow = true;
  rocks.frustumCulled = false;
  rockSpots.forEach((r, i) => {
    q.setFromAxisAngle(new THREE.Vector3(rnd(), rnd(), rnd()).normalize(), rnd() * Math.PI);
    m4.compose(
      new THREE.Vector3(r.x, r.h + 0.3 * r.s, r.z), q,
      new THREE.Vector3(r.s, r.s * (0.6 + rnd() * 0.5), r.s),
    );
    rocks.setMatrixAt(i, m4);
    const v = 0.32 + rnd() * 0.18;
    col.setRGB(v, v * 0.97, v * 0.92);
    rocks.setColorAt(i, col);
  });
  scene.add(rocks);

  // ---- grass tufts: ground cover on open grassland ---------------------
  const grassSpots = scatter(rnd, heightAt, 2500, (x, z, h) => {
    if (h < 4 || h > 150) return null;
    if (nearRunway(x, z, 320)) return null;
    if (Math.abs(z - riverCenterZ(x)) < 24) return null;
    if (slopeAt(x, z) > 0.3) return null;
    return { x, z, h, s: 0.6 + rnd() * 1.1 };
  });
  const grassMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  addWindSway(grassMat, 0.5, 1.6);
  // Tall narrow tufts (grass blades, not cones) in a darker green, so the
  // ground cover reads against the pale dry grass instead of vanishing.
  const grass = new THREE.InstancedMesh(new THREE.ConeGeometry(0.55, 2.2, 5), grassMat, grassSpots.length);
  grass.frustumCulled = false;
  grassSpots.forEach((g, i) => {
    q.setFromAxisAngle(up, rnd() * Math.PI * 2);
    m4.compose(new THREE.Vector3(g.x, g.h + 0.6 * g.s, g.z), q, new THREE.Vector3(g.s, g.s, g.s));
    grass.setMatrixAt(i, m4);
    col.setHSL(0.19 + rnd() * 0.07, 0.5 + rnd() * 0.2, 0.26 + rnd() * 0.12);
    grass.setColorAt(i, col);
  });
  scene.add(grass);

  return {
    update(dt, time) {
      void dt;
      windTime.value = time;
    },
  };
}
