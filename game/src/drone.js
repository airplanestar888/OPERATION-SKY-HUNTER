// Operation: Sky Hunter — aircraft selector and drone models.
//
// The player flies one aircraft at a time, chosen from the AIRCRAFT
// registry below. Every entry is a GLB file, loaded asynchronously and
// swapped in when ready; while one loads, a small wireframe placeholder
// shows instead, and a failed load raises a clear on-screen error.
// Adding a new aircraft is one registry line plus its file — no redesign,
// no other code changes.
//
//   { id, name, file, scale, flipY, spinNames, spinAxis, spinDir,
//     gimbalNode, strobeMaterial, fpvEye }
//
//   file           path under game/ (a GLB file, always present)
//   scale          model scale inside the outer group
//   flipY          Y rotation applied to the model (both GLB noses point
//                  +Z; the game flies nose -Z, so they are turned 180°)
//   spinNames      substrings matched against node names, case-insensitive
//                  — every matching node spins (one pusher propeller on
//                  the fixed-wing; four rotors on a quad)
//   spinAxis       the local axis the spin nodes turn around (Z for the
//                  fixed-wing pusher prop, Y for the quad's horizontal
//                  rotors)
//   spinDir        optional (name) => +1 / -1: per-rotor spin direction
//                  (the quad alternates FL/RR against FR/RL); without it
//                  every rotor spins the same way
//   gimbalNode     node the camera gimbal tracks with (null = none)
//   strobeMaterial material blinked as the strobe (null = none)
//   fpvEye         { forward, up } in game metres: where the first-person
//                  camera sits, measured from the aircraft centre along
//                  the flight direction and above it. The eye sits OVER
//                  the body (above the fuselage, roughly above the
//                  centre), looking forward — and in FPV only the
//                  prop/rotor nodes and their blur discs stay visible,
//                  the rest of the body is hidden (see setFpvMode), so
//                  the spinning props read at the frame edges like real
//                  FPV footage while the fuselage can never block the
//                  view. The old scheme (eye ahead of the nose, whole
//                  model hidden) put the camera ahead of the front
//                  rotors, so the props were behind the camera and
//                  invisible. Measured from the GLB files (accessor
//                  min/max, Studio_Floor excluded): the quad nose tip is
//                  2.98 m ahead of centre (model z +0.635 × 4.7),
//                  fuselage top +1.15 m, rotor plane +0.47 m, front
//                  rotors 1.36 m ahead and 2.30 m out to each side; the
//                  fixed-wing nose tip is 1.77 m ahead (model z +2.85
//                  × 0.62), fuselage top +0.32 m, pusher prop at the
//                  tail. Every registry entry must carry fpvEye; main.js
//                  falls back to a safe generic (3.0 m forward) if one
//                  is missing.
//
// The outer group is the stable identity for the whole session: main.js
// positions and rotates it, so the model inside it can be swapped
// without anything else noticing. Physics, collision, HUD and missions
// never see which aircraft is flying — the switch is visual only.
//
// SKY HUNTER QUAD (verified from the file itself):
//   - Root node SKY_HUNTER_QUAD_ROOT; the Blender "Studio_Floor" node is
//     never built (the parser skips it by name, and it is not under the
//     root). Four rotors Prop_FL / Prop_FR / Prop_RL / Prop_RR, horizontal
//     blades spinning around the vertical Y axis, alternating directions.
//     Scale 4.7 is measured, not guessed: the quad spans 1.40 m
//     (motors at ±0.49 m plus 0.21 m blades), and the fixed-wing spans
//     6.63 m in game (10.7 m × 0.62), so 6.63 / 1.40 ≈ 4.7 puts both
//     aircraft in the same visual size class for the chase camera.
//   - Mat_Quad_TelemetryDisp carries an emissive display texture
//     (quad_disp_emit); Mat_Quad_StatusBlue / StatusViolet / OpticalCyan
//     / CyanSoft glow via emissive factors.
//
// SKY HUNTER (verified from the file itself):
//   - Root node SKY_HUNTER_ROOT; the Blender "Studio_Floor" node is never
//     built (the parser skips it by name, and it is not under the root).
//   - Propeller node spins around the longitudinal axis (Z — its blades
//     lie in the XY plane); a blur disc is added at its hub, sized from
//     the blade geometry.
//   - Sensor_Gimbal_Yaw is the gimbal the update loop tracks with.
//   - Mat_Strobe_White is the strobe material (emissive, blinked);
//     Mat_Nav_Red / Mat_Nav_Green glow via their emissive materials.
//   - window.__oshDroneModel reports the model on screen ('quad' |
//     'skyhunter' | 'loading' | 'glb-failed') so playtests and screenshots
//     can tell which aircraft is showing.

import { FLIGHT } from './config.js';
import { angleDiff } from './random.js';
import { loadGLB } from './glb.js';

const THREE = window.THREE;

export const AIRCRAFT = [
  {
    id: 'quad',
    name: 'SKY HUNTER QUAD',
    file: 'assets/quad.glb',
    scale: 4.7,
    flipY: Math.PI,
    spinNames: ['prop'],
    spinAxis: new THREE.Vector3(0, 1, 0),
    // Real quad-rotors alternate: FL and RR spin one way, FR and RL the
    // other. spinDir maps a spin-node name to its direction (+1 / -1);
    // entries without it spin every rotor the same way.
    spinDir: (name) => (/FL|RR/i.test(name) ? 1 : -1),
    gimbalNode: null,
    strobeMaterial: null,
    // Eye over the body: 1.0 m behind centre, 1.35 m up — 0.88 m above
    // the rotor plane (+0.47 m), so the front rotors (1.36 m ahead,
    // 2.30 m out) fall inside the FPV frame at both edges while the
    // rear rotors stay out of view.
    fpvEye: { forward: -1.0, up: 1.35 },
  },
  {
    id: 'skyhunter',
    name: 'SKY HUNTER',
    file: 'assets/drone.glb',
    scale: 0.62,
    flipY: Math.PI,
    spinNames: ['propeller'],
    spinAxis: new THREE.Vector3(0, 0, 1),
    gimbalNode: 'Sensor_Gimbal_Yaw',
    strobeMaterial: 'Mat_Strobe_White',
    // Nose tip 1.77 m ahead of centre — the eye sits 0.43 m ahead of it.
    fpvEye: { forward: 2.2, up: 0.45 },
  },
];

export function aircraftById(id) {
  return AIRCRAFT.find((a) => a.id === id) || AIRCRAFT[0];
}

const discMat = new THREE.MeshBasicMaterial({
  color: 0xaaaaaa, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false,
});

// Blur-disc radius for a spin node, measured from its own geometry: the
// widest blade extent perpendicular to the spin axis, so the disc always
// matches the rotor it belongs to (no hard-coded size per aircraft).
function spinDiscRadius(node, axis) {
  let r = 0.2;
  node.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      const x = Math.abs(pos.getX(i));
      const y = Math.abs(pos.getY(i));
      const z = Math.abs(pos.getZ(i));
      const d = axis.z === 1 ? Math.max(x, y) : axis.y === 1 ? Math.max(x, z) : Math.max(y, z);
      if (d > r) r = d;
    }
  });
  return r * 1.05;
}

// Wraps the loaded model with the per-frame animation: rotor spin,
// engine vibration, banking/pitching, gimbal tracking and the strobe.
// The second argument is the initially selected aircraft id.
export function createDrone(scene, initialAircraftId) {
  // Outer group: the stable identity main.js positions and rotates.
  const group = new THREE.Group();
  group.rotation.order = 'YXZ';
  scene.add(group);

  // Loading placeholder: a small wireframe octahedron that slowly spins
  // while a GLB loads (or after a load fails). It is a stand-in, never a
  // flyable aircraft.
  const placeholder = new THREE.Group();
  const phOuter = new THREE.Mesh(
    new THREE.OctahedronGeometry(2.2, 0),
    new THREE.MeshBasicMaterial({ color: 0x35e0c8, wireframe: true, transparent: true, opacity: 0.8 }),
  );
  placeholder.add(phOuter);
  const phCore = new THREE.Mesh(
    new THREE.OctahedronGeometry(1.1, 0),
    new THREE.MeshBasicMaterial({ color: 0x35e0c8, wireframe: true, transparent: true, opacity: 0.5 }),
  );
  placeholder.add(phCore);

  const glbCache = new Map();
  let loadToken = 0;

  const state = {
    model: null,
    rotors: [],
    gimbal: null,
    strobeMat: null,
    strobeBase: 1,
    selectedId: initialAircraftId || 'quad',
    displayedId: null,
    fpvMode: false,
    fpvAppliedTo: null,
    fpvAppliedFor: null,
  };
  window.__oshDroneModel = 'loading';

  function showPlaceholder(failed) {
    if (state.model) group.remove(state.model);
    group.add(placeholder);
    state.model = placeholder;
    state.rotors = [];
    state.gimbal = null;
    state.strobeMat = null;
    state.strobeBase = 1;
    state.displayedId = failed ? 'glb-failed' : 'loading';
    window.__oshDroneModel = state.displayedId;
  }

  function applyGLB(entry, parsed) {
    const { group: glbRoot, nodes, materials } = parsed;
    const inner = new THREE.Group();
    inner.scale.setScalar(entry.scale);
    inner.rotation.y = entry.flipY || 0;
    inner.add(glbRoot);
    // Spin nodes, matched by name (substring, case-insensitive) — every
    // match spins, so one propeller or four rotors work the same way.
    // A registry spinDir maps each spin-node name to its direction.
    const needles = (entry.spinNames || []).map((s) => s.toLowerCase());
    const spinNodes = [];
    nodes.forEach((node, name) => {
      if (needles.some((n) => name.toLowerCase().includes(n))) spinNodes.push({ node, name });
    });
    if (spinNodes.length === 0) throw new Error(`glb: no spin node matching ${entry.spinNames}`);
    const rotors = spinNodes.map(({ node, name }) => {
      // Remember the node's original orientation once: the update loop
      // rewrites its quaternion every frame, so re-applying the same
      // model must not stack a half-spun orientation underneath.
      if (!node.userData.baseQuat) node.userData.baseQuat = node.quaternion.clone();
      // FPV markers: in first-person view only the prop subtrees and
      // their blur discs stay visible (see setFpvMode).
      node.userData.isPropRoot = true;
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(spinDiscRadius(node, entry.spinAxis), 24), discMat,
      );
      disc.userData.isPropDisc = true;
      disc.position.copy(node.position);
      // A circle lies in the XY plane: flat for a Y-axis rotor, as-is
      // for a Z-axis propeller.
      if (entry.spinAxis.y === 1) disc.rotation.x = -Math.PI / 2;
      inner.add(disc);
      return {
        prop: node,
        disc,
        dir: entry.spinDir ? entry.spinDir(name) : 1,
        baseQuat: node.userData.baseQuat,
        axis: entry.spinAxis.clone(),
        angle: 0,
      };
    });
    if (state.model) group.remove(state.model);
    group.add(inner);
    state.model = inner;
    state.rotors = rotors;
    state.gimbal = entry.gimbalNode ? (nodes.get(entry.gimbalNode) || null) : null;
    state.strobeMat = entry.strobeMaterial ? (materials.get(entry.strobeMaterial) || null) : null;
    state.strobeBase = state.strobeMat && state.strobeMat.emissiveIntensity ? state.strobeMat.emissiveIntensity : 1;
    state.displayedId = entry.id;
    window.__oshDroneModel = entry.id;
  }

  async function loadAndApply(entry, token) {
    try {
      let parsed = glbCache.get(entry.id);
      if (!parsed) {
        parsed = await loadGLB(entry.file);
        glbCache.set(entry.id, parsed);
      }
      if (token !== loadToken) return; // the player switched again meanwhile
      applyGLB(entry, parsed);
    } catch (err) {
      if (token !== loadToken) return;
      console.warn(`[sky-hunter] aircraft ${entry.id} failed to load:`, err);
      showPlaceholder(true);
      window.dispatchEvent(new CustomEvent('osh-aircraft-error', {
        detail: { id: entry.id, name: entry.name },
      }));
    }
  }

  function setAircraft(id) {
    const entry = aircraftById(id);
    if (entry.id === state.selectedId && entry.id === state.displayedId) return;
    state.selectedId = entry.id;
    loadToken += 1;
    // Nothing on screen yet: show the placeholder while the GLB loads.
    // Otherwise the current model stays up until the new one is ready.
    if (!state.model) showPlaceholder(false);
    loadAndApply(entry, loadToken);
  }

  // First-person visibility: only the prop/rotor subtrees and their blur
  // discs stay on screen in FPV; the fuselage, gear, gimbal and lights
  // are hidden so the body can never block the view, while the spinning
  // props still read at the frame edges. The loading placeholder is
  // never hidden. Re-applied whenever the model or the mode changes
  // (an aircraft switch mid-FPV must not leak a fully visible model).
  function applyFpvVisibility() {
    const model = state.model;
    if (!model || model === placeholder) return;
    if (state.fpvAppliedTo === model && state.fpvAppliedFor === state.fpvMode) return;
    model.traverse((o) => {
      if (!o.isMesh) return;
      if (!state.fpvMode) { o.visible = true; return; }
      let keep = !!o.userData.isPropDisc;
      let p = o.parent;
      while (p && !keep) {
        if (p.userData && p.userData.isPropRoot) keep = true;
        p = p.parent;
      }
      o.visible = keep;
    });
    state.fpvAppliedTo = model;
    state.fpvAppliedFor = state.fpvMode;
  }

  function setFpvMode(on) {
    state.fpvMode = !!on;
    applyFpvVisibility();
  }

  let strobeTimer = 0;
  let strobeOn = false;
  const tmpQuat = new THREE.Quaternion();

  // Start on the loading placeholder; the selected GLB swaps in when ready.
  showPlaceholder(false);
  setAircraft(initialAircraftId || 'quad');

  return {
    group,
    aircraft: AIRCRAFT,
    get gimbal() { return state.gimbal; },
    getAircraftId() { return state.selectedId; },
    setAircraft,
    setFpvMode,
    update(dt, time, flight) {
      // Rotor/propeller spin follows throttle; blades blur into discs at
      // high RPM. The spin is a quaternion (base orientation times an
      // angle around the rotor's own axis), so it works for the
      // fixed-wing pusher prop (axis Z) and a quad's four rotors (axis Y)
      // alike.
      // The loading placeholder slowly turns while it is on screen.
      if (state.model === placeholder) placeholder.rotation.y += dt * 1.2;
      const spin = FLIGHT.rotorSpinBase + flight.throttle * (FLIGHT.rotorSpinFull - FLIGHT.rotorSpinBase);
      for (const r of state.rotors) {
        r.angle += r.dir * spin * dt;
        tmpQuat.setFromAxisAngle(r.axis, r.angle);
        r.prop.quaternion.copy(r.baseQuat).multiply(tmpQuat);
        // In FPV the blur discs carry the spinning read at the frame
        // edges, so they run more opaque there; in chase they stay
        // subtle. The disc material is shared, so every disc takes the
        // same value — one assignment per rotor is harmless.
        if (r.disc) r.disc.material.opacity = state.fpvMode
          ? 0.10 + flight.throttle * 0.16
          : 0.06 + flight.throttle * 0.12;
      }
      // Subtle engine vibration (an absolute per-frame offset, not drift).
      const vib = 0.006 + flight.throttle * 0.008;
      group.position.y += Math.sin(time * 61) * vib + Math.sin(time * 47) * vib * 0.6;
      // Nose is modelled facing -Z: yaw is -heading, pitch and roll flip
      // sign against the flight state for the same reason.
      group.rotation.y = -flight.heading;
      group.rotation.x = -flight.pitch;
      group.rotation.z = -flight.roll;
      // Gimbal tracks the next ring when there is one.
      if (flight.lookTarget && state.gimbal) {
        const dx = flight.lookTarget.x - group.position.x;
        const dz = flight.lookTarget.z - group.position.z;
        const bearing = Math.atan2(dx, -dz);
        const rel = Math.max(-1.2, Math.min(1.2, angleDiff(bearing, flight.heading)));
        state.gimbal.rotation.y += (-rel - state.gimbal.rotation.y) * Math.min(1, dt * 3);
      }
      // White strobe double-blinks about once a second. A standard
      // material blinks through its emissive intensity.
      strobeTimer += dt;
      const phase = strobeTimer % 1.1;
      const on = phase < 0.06 || (phase > 0.16 && phase < 0.22);
      if (on !== strobeOn) {
        strobeOn = on;
        if (state.strobeMat) {
          if (state.strobeMat.emissive) {
            state.strobeMat.emissiveIntensity = on ? state.strobeBase : 0.05;
          } else {
            state.strobeMat.color.setHex(on ? 0xffffff : 0x303030);
          }
        }
      }
    },
  };
}
