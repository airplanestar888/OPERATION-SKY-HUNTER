// Operation: Sky Hunter — the world.
//
// Procedural terrain with real elevation (hills, a river valley, mountain
// walls at the map edge, a flattened runway plateau), plus the military
// base, forests, towers, roads and sky. heightAt() is the single source of
// truth for elevation: the mesh, the physics and the missions all read it,
// and it is NEVER changed by the visual overhaul.
//
// The visuals live in focused modules now: atmosphere.js (sky, fog,
// lighting presets, clouds, distant ridges), terrain.js (terrain mesh and
// ground materials), vegetation.js (instanced trees, bushes, rocks,
// grass) and water.js (the river). This file orchestrates them and keeps
// the hand-built structures (base, houses, towers, runway, roads).

import { WORLD } from './config.js';
import { fbm, clamp, smoothstep, mulberry32 } from './random.js';
import { createAtmosphere } from './atmosphere.js';
import { buildTerrain } from './terrain.js';
import { buildVegetation } from './vegetation.js';
import { buildRiver } from './water.js';

const THREE = window.THREE;
const SIZE = WORLD.SIZE;
const HALF = SIZE / 2;

// ---- elevation -----------------------------------------------------------
// Unchanged from the original build: every ring, mission, spawn and
// collision reads this, so the shape of the world is frozen.
export function heightAt(x, z) {
  const r = Math.hypot(x, z);
  // Rolling hills.
  let h = (fbm(x * 0.0009, z * 0.0009, 7, 4) - 0.5) * 90;
  // Mountain masses: ridged noise, only where it is strong.
  const m = Math.max(0, fbm(x * 0.00045 + 31, z * 0.00045 + 17, 13, 3) - 0.5) * 2;
  h += Math.pow(m, 1.6) * 260;
  // Mountain wall near the map edge so the world feels enclosed.
  const edge = smoothstep(1300, 2100, r);
  h += edge * 260 * (0.6 + 0.4 * fbm(x * 0.001 + 5, z * 0.001 + 9, 21, 3));
  // River valley carve, running east-west at z = VALLEY_Z.
  const valley = Math.exp(-Math.pow((z - WORLD.VALLEY_Z) / 260, 2));
  h = h * (1 - 0.55 * valley) - 18 * valley;
  // Flattened plateau under the runway so landings are possible.
  const dRun = Math.hypot(x - WORLD.RUNWAY.x, z - WORLD.RUNWAY.z);
  const flat = 1 - smoothstep(180, 430, dRun);
  h = h * (1 - flat) + WORLD.RUNWAY.height * flat;
  return h;
}

// ---- runway texture (drawn once on a canvas, no image files) -------------
function makeRunwayTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 1024;
  const g = c.getContext('2d');
  g.fillStyle = '#2b2b30';
  g.fillRect(0, 0, 256, 1024);
  // Asphalt speckle.
  const rnd = mulberry32(99);
  for (let i = 0; i < 2600; i++) {
    const v = 30 + Math.floor(rnd() * 40);
    g.fillStyle = `rgb(${v},${v},${v + 4})`;
    g.fillRect(rnd() * 256, rnd() * 1024, 2, 2);
  }
  // Edge lines.
  g.fillStyle = '#e8e8e8';
  g.fillRect(10, 0, 6, 1024);
  g.fillRect(240, 0, 6, 1024);
  // Centreline dashes.
  for (let y = 40; y < 1024; y += 96) g.fillRect(124, y, 8, 52);
  // Threshold bars at both ends.
  for (let i = 0; i < 8; i++) {
    g.fillRect(28 + i * 26, 24, 16, 44);
    g.fillRect(28 + i * 26, 956, 16, 44);
  }
  // Runway numbers: 09 on one end, 27 on the other.
  g.fillStyle = '#f2f2f2';
  g.font = 'bold 92px Arial';
  g.textAlign = 'center';
  g.save();
  g.translate(128, 190);
  g.fillText('09', 0, 0);
  g.restore();
  g.save();
  g.translate(128, 880);
  g.rotate(Math.PI);
  g.fillText('27', 0, 0);
  g.restore();
  // Touchdown zone marks.
  for (let y = 300; y <= 700; y += 200) {
    g.fillRect(52, y, 40, 26);
    g.fillRect(164, y, 40, 26);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

// ---- world build ---------------------------------------------------------
export function createWorld(scene, renderer) {
  const world = { heightAt, obstacles: [], clouds: [], towerLights: [] };

  // Sky, fog, sun, hemisphere light, clouds and distant ridges.
  const atmo = createAtmosphere(scene, renderer);
  world.sun = atmo.sun;
  world.sunOffset = atmo.sunOffset;
  world.clouds = atmo.clouds;
  world.applyPreset = atmo.applyPreset;

  // Terrain mesh with elevation-based materials and fragment detail.
  world.terrain = buildTerrain(scene, heightAt);
  // Layered instanced vegetation, rocks and grass.
  const veg = buildVegetation(scene, heightAt);
  // The winding river with its animated water shader.
  const river = buildRiver(scene, heightAt);
  world.updateVisuals = (dt, time) => {
    atmo.update(dt, time);
    veg.update(dt, time);
    river.update(dt, time);
  };

  const rnd = mulberry32(20261127);

  // ---- roads: base <-> runway, and along the valley ----------------------
  function roadStrip(x0, z0, x1, z1, width) {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const nx = -dz / len;
    const nz = dx / len;
    const N = Math.max(2, Math.floor(len / 60));
    const verts = [];
    const idx = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const x = x0 + dx * t;
      const z = z0 + dz * t;
      const y = heightAt(x, z) + 0.7;
      verts.push(x + nx * width, y, z + nz * width, x - nx * width, y, z - nz * width);
      if (i > 0) {
        const a = (i - 1) * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x4a4a4e, roughness: 1 }));
  }
  scene.add(roadStrip(WORLD.BASE.x, WORLD.BASE.z, WORLD.RUNWAY.x, WORLD.RUNWAY.z - 230, 7));
  scene.add(roadStrip(-1800, WORLD.VALLEY_Z + 120, 1800, WORLD.VALLEY_Z + 120, 6));

  // ---- military base: hangars, control tower, radar ----------------------
  const baseGroup = new THREE.Group();
  const hangarMat = new THREE.MeshStandardMaterial({ color: 0x6d7278, roughness: 0.8, metalness: 0.25 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x3c4148, roughness: 0.85, metalness: 0.2 });
  for (let i = 0; i < 4; i++) {
    const hx = WORLD.BASE.x - 90 + i * 62;
    const hz = WORLD.BASE.z - 60 + (i % 2) * 46;
    const hy = heightAt(hx, hz);
    const hangar = new THREE.Mesh(new THREE.BoxGeometry(44, 14, 30), hangarMat);
    hangar.position.set(hx, hy + 7, hz);
    hangar.castShadow = true;
    hangar.receiveShadow = true;
    baseGroup.add(hangar);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, 44, 12, 1, false, 0, Math.PI), darkMat);
    roof.rotation.z = Math.PI / 2;
    roof.rotation.y = Math.PI / 2;
    roof.position.set(hx, hy + 14, hz);
    baseGroup.add(roof);
    world.obstacles.push({ x: hx, z: hz, r: 24, top: hy + 16, kind: 'hangar' });
  }
  // Control tower.
  {
    const tx = WORLD.BASE.x + 130;
    const tz = WORLD.BASE.z + 40;
    const ty = heightAt(tx, tz);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(4, 6, 42, 8), darkMat);
    shaft.position.set(tx, ty + 21, tz);
    shaft.castShadow = true;
    baseGroup.add(shaft);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(18, 8, 18), new THREE.MeshStandardMaterial({ color: 0x9fb6c6, roughness: 0.4, metalness: 0.3 }));
    cab.position.set(tx, ty + 46, tz);
    baseGroup.add(cab);
    world.obstacles.push({ x: tx, z: tz, r: 10, top: ty + 50, kind: 'tower' });
  }
  // Radar dome.
  {
    const rx = WORLD.BASE.x + 90;
    const rz = WORLD.BASE.z - 110;
    const ry = heightAt(rx, rz);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(2, 3, 18, 8), darkMat);
    mast.position.set(rx, ry + 9, rz);
    baseGroup.add(mast);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(7, 16, 12), new THREE.MeshStandardMaterial({ color: 0xdfe6ea, roughness: 0.5 }));
    dome.position.set(rx, ry + 22, rz);
    dome.castShadow = true;
    baseGroup.add(dome);
    world.obstacles.push({ x: rx, z: rz, r: 9, top: ry + 29, kind: 'radar' });
  }
  scene.add(baseGroup);

  // Scattered farmhouses / outposts.
  const houseMat = new THREE.MeshStandardMaterial({ color: 0x8a7a5e, roughness: 1 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x7a3a2e, roughness: 1 });
  for (let i = 0; i < 26; i++) {
    const x = (rnd() * 2 - 1) * 1600;
    const z = (rnd() * 2 - 1) * 1600;
    const h = heightAt(x, z);
    if (h < 4 || h > 170) continue;
    if (Math.hypot(x - WORLD.RUNWAY.x, z - WORLD.RUNWAY.z) < 320) continue;
    if (Math.abs(z - WORLD.VALLEY_Z) < 90) continue;
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(14, 7, 11), houseMat);
    body.position.y = 3.5;
    body.castShadow = true;
    g.add(body);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(10.5, 5, 4), roofMat);
    roof.position.y = 9.5;
    roof.rotation.y = Math.PI / 4;
    g.add(roof);
    g.position.set(x, h, z);
    g.rotation.y = rnd() * Math.PI;
    scene.add(g);
    world.obstacles.push({ x, z, r: 9, top: h + 12, kind: 'house' });
  }

  // ---- comm towers (tall obstacles with blinking lights) -----------------
  const towerSpots = [
    [-900, -1200], [700, -1500], [1500, -300], [-1400, 400],
    [1100, 700], [-600, 1500], [1600, 1500],
  ];
  const towerMat = new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.6, metalness: 0.5 });
  towerSpots.forEach(([x, z]) => {
    const h = heightAt(x, z);
    const height = 62 + rnd() * 30;
    const tower = new THREE.Group();
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2.4, height, 6), towerMat);
    mast.position.y = height / 2;
    mast.castShadow = true;
    tower.add(mast);
    for (let k = 1; k <= 3; k++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(14 - k * 3, 0.8, 0.8), towerMat);
      bar.position.y = height * (0.35 + k * 0.18);
      tower.add(bar);
    }
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(1.6, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xff2222 }),
    );
    lamp.position.y = height + 1;
    tower.add(lamp);
    tower.position.set(x, h, z);
    scene.add(tower);
    world.towerLights.push(lamp.material);
    world.obstacles.push({ x, z, r: 5, top: h + height + 2, kind: 'commtower' });
  });

  // ---- runway ------------------------------------------------------------
  {
    const rw = WORLD.RUNWAY;
    const strip = new THREE.Mesh(
      new THREE.PlaneGeometry(rw.width, rw.length),
      new THREE.MeshStandardMaterial({ map: makeRunwayTexture(), roughness: 0.9 }),
    );
    strip.rotation.x = -Math.PI / 2;
    strip.rotation.z = Math.PI / 2; // runway runs east-west
    strip.position.set(rw.x, rw.height + 0.4, rw.z);
    strip.receiveShadow = true;
    scene.add(strip);
    // Edge lights: amber along the sides, green at thresholds.
    const lightGeo = new THREE.SphereGeometry(0.7, 6, 5);
    const amber = new THREE.MeshBasicMaterial({ color: 0xffb020 });
    const green = new THREE.MeshBasicMaterial({ color: 0x20ff60 });
    const lights = new THREE.InstancedMesh(lightGeo, amber, 44);
    const m = new THREE.Matrix4();
    let li = 0;
    for (let i = 0; i < 22; i++) {
      const t = -rw.length / 2 + (i / 21) * rw.length;
      m.makeTranslation(rw.x + t, rw.height + 0.9, rw.z - rw.width / 2 - 2);
      lights.setMatrixAt(li++, m);
      m.makeTranslation(rw.x + t, rw.height + 0.9, rw.z + rw.width / 2 + 2);
      lights.setMatrixAt(li++, m);
    }
    scene.add(lights);
    const thGeo = new THREE.SphereGeometry(0.9, 6, 5);
    [-rw.length / 2, rw.length / 2].forEach((t) => {
      for (let s = -1; s <= 1; s += 2) {
        const th = new THREE.Mesh(thGeo, green);
        th.position.set(rw.x + t, rw.height + 0.9, rw.z + s * (rw.width / 2 - 2));
        scene.add(th);
      }
    });
  }

  return world;
}
