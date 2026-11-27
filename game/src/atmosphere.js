// Operation: Sky Hunter — atmosphere, sky, lighting presets, clouds and
// distant mountain ranges.
//
// Owns everything that makes the world feel deep instead of flat: the
// gradient sky dome with sun disc and horizon haze, distance fog, three
// switchable time-of-day presets (clear day / golden hour / overcast),
// shader-driven volumetric-style clouds and procedural mountain ranges
// beyond the map edge. The presets only ever touch light, sky and fog —
// never gameplay.
//
// Mountains: NO cones or pyramids. Each distant range is a procedural
// heightfield massif — multi-octave ridged noise with domain warping,
// jagged crest lines, asymmetric slopes, eroded gullies and tapered ends,
// so every silhouette is distinct. Three layers (far / mid / near) with
// atmospheric perspective: farther layers are lighter, less saturated and
// lifted toward the fog colour.
//
// Clouds: NO sphere clusters. One InstancedMesh of camera-facing quads
// with a fragment-shader density field (domain-warped fbm, soft edges,
// sunlit tops / grey undersides, sun-side brightening, manual fog).
// world.clouds keeps the same shape main.js already drives (entries with
// .position and .userData.speed), so the existing drift loop keeps working
// and this module rebuilds the instance matrices from those positions
// every frame.

import { mulberry32, fbm, clamp, smoothstep } from './random.js';

const THREE = window.THREE;

export const TIME_PRESETS = {
  clear: {
    label: 'CLEAR DAY',
    sun: { color: 0xfff2d8, intensity: 1.15, offset: [700, 1100, 420] },
    hemi: { sky: 0xbfd9ee, ground: 0x4a5a3a, intensity: 0.5 },
    fog: { color: 0xcfdde8, near: 1100, far: 4500 },
    sky: { top: 0x2a6cb4, mid: 0x7fb2dd, low: 0xd8e6ef },
    exposure: 1.0,
    cloud: 0xffffff,
  },
  golden: {
    label: 'GOLDEN HOUR',
    sun: { color: 0xffb35c, intensity: 1.6, offset: [1400, 420, 600] },
    hemi: { sky: 0xffd9a0, ground: 0x5a4a3a, intensity: 0.45 },
    fog: { color: 0xe8c9a0, near: 900, far: 3800 },
    sky: { top: 0x3a5a8c, mid: 0xe8a860, low: 0xffd9a0 },
    exposure: 1.0,
    cloud: 0xffe0b8,
  },
  overcast: {
    label: 'OVERCAST',
    sun: { color: 0xdfe8f0, intensity: 0.9, offset: [400, 1400, 300] },
    hemi: { sky: 0xcfd8e0, ground: 0x555a52, intensity: 0.85 },
    fog: { color: 0xc8ccd0, near: 700, far: 3200 },
    sky: { top: 0x6a7a8c, mid: 0x9aa8b4, low: 0xc8ccd0 },
    exposure: 0.95,
    cloud: 0xd8dde2,
  },
};

export const TIME_ORDER = ['clear', 'golden', 'overcast'];

function makeSkyDome() {
  const geo = new THREE.SphereGeometry(5200, 24, 12);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x2a6cb4) },
      mid: { value: new THREE.Color(0x7fb2dd) },
      low: { value: new THREE.Color(0xd8e6ef) },
      haze: { value: new THREE.Color(0xcfdde8) },
      sunDir: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
      sunColor: { value: new THREE.Color(0xfff2d8) },
    },
    vertexShader: `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec3 vPos;
      uniform vec3 top; uniform vec3 mid; uniform vec3 low; uniform vec3 haze;
      uniform vec3 sunDir; uniform vec3 sunColor;
      void main() {
        vec3 d = normalize(vPos);
        float h = d.y;
        vec3 c = h > 0.25 ? mix(mid, top, smoothstep(0.25, 0.9, h))
                          : mix(low, mid, smoothstep(-0.05, 0.25, h));
        // Haze band hugging the horizon — the world fades into the sky.
        // It is tinted with the fog colour so distant ridges, terrain and
        // sky melt into one another instead of meeting at a hard line.
        float hazeBand = 1.0 - smoothstep(0.0, 0.28, abs(h));
        c = mix(c, haze, hazeBand * 0.55);
        c = mix(c, low, hazeBand * 0.15);
        // Sun disc with a soft glow, plus a wide atmospheric scatter halo.
        float s = max(dot(d, normalize(sunDir)), 0.0);
        c += sunColor * (pow(s, 600.0) * 1.2 + pow(s, 18.0) * 0.22 + pow(s, 6.0) * 0.08);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}

// ---- natural mountain massifs -------------------------------------------
// One procedural heightfield per massif: a ridgeline that rises and falls
// along its length (several distinct peaks, never one triangle), asymmetric
// cross-slopes, eroded gullies and tapered ends. Vertex colours carry the
// geology — scrub at the foot, grey-brown rock, lighter exposed stone and
// patchy pale scree on the highest flats — so no face reads as flat white
// or flat grey.

function buildMassifGeometry(rnd, opts) {
  const { width, depth, peak, seed } = opts;
  const NX = 56;
  const NZ = 18;
  const pos = [];
  const col = [];
  const idx = [];
  // Crest height along the length: broad envelope (tapered ends) times
  // multi-octave ridged noise, so the skyline has several unequal peaks.
  const crestAt = (u) => {
    const env = smoothstep(0, 0.16, u) * smoothstep(1, 0.84, u);
    const broad = 0.55 + 0.45 * fbm(u * 2.2 + seed, seed * 0.37, seed, 3);
    const ridge = 1 - Math.abs(2 * fbm(u * 5.1 + seed * 1.7, seed * 0.91, seed + 4, 3) - 1);
    const c = peak * env * broad * (0.62 + 0.38 * ridge);
    return c * (0.8 + 0.2 * fbm(u * 9.3 + seed * 2.3, seed * 1.13, seed + 8, 2));
  };
  // Heightfield sampled on a grid, with colours baked per vertex.
  const H = [];
  for (let j = 0; j <= NZ; j++) {
    H.push([]);
    for (let i = 0; i <= NX; i++) {
      const u = i / NX;
      const v = j / NZ;
      const x = (u - 0.5) * width;
      const z = (v - 0.5) * depth;
      const crest = crestAt(u);
      // Crest line wanders across the width of the massif.
      const zc = (fbm(u * 3.1 + seed * 0.53, seed * 0.71, seed + 11, 3) - 0.5) * depth * 0.34;
      const d = z - zc;
      // Asymmetric slopes: one side steep, the other a long gentle fall.
      const fall = d >= 0
        ? Math.pow(1 - Math.min(1, d / (depth * 0.44)), 1.35)
        : Math.pow(1 - Math.min(1, -d / (depth * 0.62)), 0.8);
      let h = crest * Math.max(0, fall);
      // Eroded gullies: channels carved down the slopes where the noise
      // runs strong, so the faces are not smooth sheets.
      const gully = Math.max(0, fbm(x * 0.006 + seed, z * 0.006 + seed * 0.31, seed + 5, 3) - 0.58) * 2.4;
      h *= 1 - gully * 0.38 * fall;
      // Fine rocky surface detail.
      const detail = 1 - Math.abs(2 * fbm(x * 0.011 + seed * 0.77, z * 0.011, seed + 15, 3) - 1);
      h += detail * peak * 0.05 * fall;
      H[j].push(Math.max(0, h));
    }
  }
  const rockVar = (x, z) => fbm(x * 0.004 + seed * 1.31, z * 0.004, seed + 21, 3);
  for (let j = 0; j <= NZ; j++) {
    for (let i = 0; i <= NX; i++) {
      const u = i / NX;
      const v = j / NZ;
      const x = (u - 0.5) * width;
      const z = (v - 0.5) * depth;
      const h = H[j][i];
      pos.push(x, h, z);
      // Slope from finite differences on the grid.
      const hx = H[j][Math.min(NX, i + 1)] - H[j][Math.max(0, i - 1)];
      const hz = H[Math.min(NZ, j + 1)][i] - H[Math.max(0, j - 1)][i];
      const slope = clamp(Math.hypot(hx, hz) / (width / NX * 2 + depth / NZ * 2) * 2.2, 0, 1);
      const n = rockVar(x, z);
      const patch = fbm(x * 0.0016 + seed * 0.43, z * 0.0016, seed + 27, 3);
      let r, g, b;
      const hn = peak > 0 ? h / peak : 0;
      if (hn > 0.8 && slope < 0.35) {
        // Highest flats: patchy pale scree, never a solid white cap.
        const snowAmt = clamp((patch - 0.55) * 2.0, 0.1, 0.65);
        const sr = 0.48 + n * 0.1;
        r = sr + (0.72 - sr) * snowAmt;
        g = sr * 0.98 + (0.74 - sr * 0.98) * snowAmt;
        b = sr * 0.95 + (0.78 - sr * 0.95) * snowAmt;
      } else if (slope > 0.5) {
        // Steep faces: darker shaded rock.
        const v = 0.26 + n * 0.07;
        r = v; g = v * 0.97; b = v * 0.93;
      } else if (hn < 0.2) {
        // Foot of the mountain: scrub and soil blending into the terrain.
        r = 0.2 + patch * 0.14; g = 0.24 + patch * 0.08; b = 0.12 + n * 0.04;
      } else {
        // Mid slopes: grey rock with subtle brown geological variation.
        const v = 0.34 + n * 0.08;
        const brown = clamp((patch - 0.55) * 2.4, 0, 0.7);
        r = v + (0.48 - v) * brown;
        g = v * 0.96 + (0.4 - v * 0.96) * brown;
        b = v * 0.9 + (0.3 - v * 0.9) * brown;
      }
      col.push(r, g, b);
    }
  }
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      const a = j * (NX + 1) + i;
      const b = a + 1;
      const c = a + NX + 1;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// Distant ranges in three layers: far hazy silhouettes, midground
// detailed ridges, foreground rocky slopes overlapping the terrain edge.
// Bases sit below the terrain's edge wall, so only the natural tops show.
function makeRanges(scene) {
  const rnd = mulberry32(777);
  const group = new THREE.Group();
  const layers = [
    { count: 8, rMin: 2950, rMax: 3350, peakMin: 520, peakMax: 980, wMin: 1300, wMax: 1900, lift: 0.14 },
    { count: 7, rMin: 2400, rMax: 2900, peakMin: 380, peakMax: 660, wMin: 1000, wMax: 1500, lift: 0.05 },
    { count: 5, rMin: 2050, rMax: 2400, peakMin: 260, peakMax: 480, wMin: 800, wMax: 1200, lift: 0.0 },
  ];
  const mats = [];
  layers.forEach((layer, li) => {
    for (let i = 0; i < layer.count; i++) {
      const a = ((i + li * 0.37) / layer.count) * Math.PI * 2 + rnd() * 0.5;
      const r = layer.rMin + rnd() * (layer.rMax - layer.rMin);
      const peak = layer.peakMin + rnd() * (layer.peakMax - layer.peakMin);
      const width = layer.wMin + rnd() * (layer.wMax - layer.wMin);
      const geo = buildMassifGeometry(rnd, {
        width,
        depth: 380 + rnd() * 220,
        peak,
        seed: 100 + li * 37 + i * 13 + rnd() * 7,
      });
      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.96,
        metalness: 0,
        emissive: 0xcfdde8,
        emissiveIntensity: layer.lift,
      });
      mats.push({ mat, lift: layer.lift });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(Math.cos(a) * r, -50, Math.sin(a) * r);
      // Long axis tangential to the ring, with a little random skew so
      // neighbouring massifs never line up into a repeated wall.
      m.rotation.y = -a + Math.PI / 2 + (rnd() - 0.5) * 0.3;
      group.add(m);
    }
  });
  scene.add(group);
  return { group, mats };
}

// ---- shader clouds -------------------------------------------------------
// One InstancedMesh of camera-facing quads. The fragment shader paints a
// domain-warped fbm density field per cloud — soft billowing edges, sunlit
// tops fading to grey undersides, sun-side brightening and manual fog —
// so clouds read as atmosphere, not geometry. Four cloud types:
// 0 small scattered cumulus, 1 medium fluffy cumulus, 2 large distant
// formations, 3 thin wispy high-altitude streaks.

function makeClouds(scene) {
  const rnd = mulberry32(4242);
  const clouds = [];
  // type, count, altitude range, width range, speed range, opacity, haze
  const kinds = [
    { type: 0, count: 12, yMin: 380, yMax: 520, wMin: 60, wMax: 120, sMin: 2, sMax: 4, op: 0.95, haze: 0.1 },
    { type: 1, count: 12, yMin: 400, yMax: 560, wMin: 130, wMax: 230, sMin: 2, sMax: 4.5, op: 0.95, haze: 0.15 },
    { type: 2, count: 8, yMin: 430, yMax: 620, wMin: 320, wMax: 540, sMin: 1.2, sMax: 2.2, op: 0.6, haze: 0.7 },
    { type: 3, count: 5, yMin: 760, yMax: 950, wMin: 420, wMax: 720, sMin: 3.5, sMax: 5.5, op: 0.5, haze: 0.45 },
  ];
  kinds.forEach((k) => {
    for (let i = 0; i < k.count; i++) {
      const w = k.wMin + rnd() * (k.wMax - k.wMin);
      const h = k.type === 3 ? w * (0.05 + rnd() * 0.04) : w * (0.34 + rnd() * 0.16);
      clouds.push({
        position: new THREE.Vector3((rnd() * 2 - 1) * 2100, k.yMin + rnd() * (k.yMax - k.yMin), (rnd() * 2 - 1) * 2100),
        userData: {
          speed: k.sMin + rnd() * (k.sMax - k.sMin),
          sx: w,
          sy: h,
          seed: rnd() * 100,
          type: k.type,
          opacity: k.op,
          haze: k.haze,
        },
      });
    }
  });

  const uniforms = {
    uTime: { value: 0 },
    uTint: { value: new THREE.Color(0xffffff) },
    uShadow: { value: new THREE.Color(0x8b9aa8) },
    uSunDir: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
    uFogColor: { value: new THREE.Color(0xcfdde8) },
    uFogNear: { value: 1100 },
    uFogFar: { value: 4500 },
  };
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    uniforms,
    vertexShader: `
      attribute vec4 aCloud;
      varying vec2 vUv;
      varying vec4 vCloud;
      varying float vDepth;
      varying vec2 vSunXY;
      uniform vec3 uSunDir;
      void main() {
        vUv = uv;
        vCloud = aCloud;
        vec3 center = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        float sx = length(vec3(instanceMatrix[0][0], instanceMatrix[0][1], instanceMatrix[0][2]));
        float sy = length(vec3(instanceMatrix[1][0], instanceMatrix[1][1], instanceMatrix[1][2]));
        vec4 mv = modelViewMatrix * vec4(center, 1.0);
        mv.xy += position.xy * vec2(sx, sy);
        vDepth = -mv.z;
        vec4 sv = viewMatrix * vec4(uSunDir, 0.0);
        vSunXY = normalize(sv.xy + vec2(0.0001, 0.0));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec2 vUv;
      varying vec4 vCloud;
      varying float vDepth;
      varying vec2 vSunXY;
      uniform float uTime;
      uniform vec3 uTint; uniform vec3 uShadow;
      uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar;
      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }
      float vnoise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        float a = hash21(i);
        float b = hash21(i + vec2(1.0, 0.0));
        float c = hash21(i + vec2(0.0, 1.0));
        float d = hash21(i + vec2(1.0, 1.0));
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }
      float fbm2(vec2 p) {
        float s = 0.0; float a = 0.5;
        for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
        return s;
      }
      void main() {
        float seed = vCloud.x;
        float ctype = vCloud.y;
        float opacity = vCloud.z;
        float hazeAmt = vCloud.w;
        // Domain-warped density field; the warp breaks any visible tiling
        // and the very slow time scroll keeps the field alive without a
        // visible loop.
        vec2 q = vUv * 2.4 + seed;
        if (ctype > 2.5) { q = vec2(vUv.x * 1.4 + seed, vUv.y * 3.4 + seed * 1.7); }
        vec2 w = vec2(fbm2(q + vec2(0.0, uTime * 0.004)), fbm2(q + vec2(5.2, -uTime * 0.003)));
        float d = fbm2(q + 0.9 * w);
        float dens;
        if (ctype < 0.5) { dens = smoothstep(0.5, 0.74, d); }
        else if (ctype < 1.5) { dens = smoothstep(0.46, 0.7, d); }
        else if (ctype < 2.5) { dens = smoothstep(0.42, 0.68, d); }
        else { dens = smoothstep(0.55, 0.76, d); }
        // Soft elliptical silhouette, fading at the bottom edge.
        vec2 c = (vUv - 0.5) * vec2(1.0, 1.9);
        float fall = smoothstep(0.52, 0.16, length(c));
        fall *= smoothstep(0.02, 0.3, vUv.y);
        float a = dens * fall * opacity;
        if (a < 0.015) discard;
        // Lighting: bright sunlit tops, soft grey undersides, a gentle
        // brightening on the sun-facing side and denser cores slightly
        // brighter, so the cloud has internal depth.
        float grad = smoothstep(0.05, 0.85, vUv.y);
        vec3 col = mix(uShadow, uTint, grad);
        float sunSide = dot(normalize(vUv - 0.5 + vec2(0.0001)), vSunXY) * 0.5 + 0.5;
        col *= 0.9 + 0.18 * sunSide;
        col *= 0.88 + 0.22 * d;
        // Manual fog: distant formations melt into the haze.
        float f = smoothstep(uFogNear, uFogFar, vDepth);
        col = mix(col, uFogColor, f * (0.35 + 0.65 * hazeAmt));
        a *= 1.0 - f * 0.35 * hazeAmt;
        gl_FragColor = vec4(col, a);
      }`,
  });
  const geo = new THREE.PlaneGeometry(1, 1);
  const data = new Float32Array(clouds.length * 4);
  clouds.forEach((c, i) => {
    data[i * 4] = c.userData.seed;
    data[i * 4 + 1] = c.userData.type;
    data[i * 4 + 2] = c.userData.opacity;
    data[i * 4 + 3] = c.userData.haze;
  });
  geo.setAttribute('aCloud', new THREE.InstancedBufferAttribute(data, 4));
  const mesh = new THREE.InstancedMesh(geo, mat, clouds.length);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  scene.add(mesh);
  return { clouds, mesh, uniforms };
}

export function createAtmosphere(scene, renderer) {
  // Lighting: one sun with shadows + a sky/ground hemisphere fill.
  const sun = new THREE.DirectionalLight(0xfff1d6, 1.6);
  sun.position.set(900, 1400, 500);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -260;
  sun.shadow.camera.right = 260;
  sun.shadow.camera.top = 260;
  sun.shadow.camera.bottom = -260;
  sun.shadow.camera.near = 200;
  sun.shadow.camera.far = 3200;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  scene.add(sun.target);
  const hemi = new THREE.HemisphereLight(0xbfd9ee, 0x4a5a3a, 0.65);
  scene.add(hemi);
  scene.fog = new THREE.Fog(0xcfdde8, 1100, 4500);

  const sky = makeSkyDome();
  scene.add(sky);
  const ranges = makeRanges(scene);
  const cloudSys = makeClouds(scene);
  const clouds = cloudSys.clouds;

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sunOffset = new THREE.Vector3(700, 1100, 420);
  let current = 'clear';

  function applyPreset(name) {
    const p = TIME_PRESETS[name] || TIME_PRESETS.clear;
    current = TIME_PRESETS[name] ? name : 'clear';
    sun.color.setHex(p.sun.color);
    sun.intensity = p.sun.intensity;
    sunOffset.set(p.sun.offset[0], p.sun.offset[1], p.sun.offset[2]);
    hemi.color.setHex(p.hemi.sky);
    hemi.groundColor.setHex(p.hemi.ground);
    hemi.intensity = p.hemi.intensity;
    scene.fog.color.setHex(p.fog.color);
    scene.fog.near = p.fog.near;
    scene.fog.far = p.fog.far;
    sky.material.uniforms.top.value.setHex(p.sky.top);
    sky.material.uniforms.mid.value.setHex(p.sky.mid);
    sky.material.uniforms.low.value.setHex(p.sky.low);
    sky.material.uniforms.haze.value.setHex(p.fog.color);
    sky.material.uniforms.sunDir.value.copy(sunOffset).normalize();
    sky.material.uniforms.sunColor.value.setHex(p.sun.color);
    // Cloud lighting follows the preset: tint for the sunlit tops, a
    // darker cool-grey shadow for the undersides, fog for the haze.
    const u = cloudSys.uniforms;
    u.uTint.value.setHex(p.cloud);
    u.uShadow.value.setHex(p.cloud).multiplyScalar(0.52).lerp(new THREE.Color(0x8b9aa8), 0.35);
    u.uSunDir.value.copy(sunOffset).normalize();
    u.uFogColor.value.setHex(p.fog.color);
    u.uFogNear.value = p.fog.near;
    u.uFogFar.value = p.fog.far;
    // Distant ridges lift toward the current fog colour.
    ranges.mats.forEach(({ mat, lift }) => {
      mat.emissive.setHex(p.fog.color);
      mat.emissiveIntensity = lift;
    });
    if (renderer) renderer.toneMappingExposure = p.exposure;
    return p.label;
  }

  function update(dt = 0.016, time = 0) {
    // Rebuild the billboard matrices from the cloud positions (main.js
    // drifts the positions themselves, so this module never owns the
    // motion). The shader billboards each quad toward the camera.
    cloudSys.uniforms.uTime.value = time;
    clouds.forEach((cloud, i) => {
      m4.compose(
        new THREE.Vector3(cloud.position.x, cloud.position.y, cloud.position.z),
        q,
        new THREE.Vector3(cloud.userData.sx, cloud.userData.sy, 1),
      );
      cloudSys.mesh.setMatrixAt(i, m4);
    });
    cloudSys.mesh.instanceMatrix.needsUpdate = true;
  }

  applyPreset('clear');
  update();
  return { sun, hemi, clouds, sunOffset, applyPreset, update, get current() { return current; } };
}
