// Operation: Sky Hunter — game bootstrap and main loop.
// Owns the renderer, the state machine (menu / playing / paused /
// complete / failed), the chase + first-person cameras, the autopilot used
// by the menu backdrop and the screenshot mode, and all menu wiring.

import { WORLD, DIFFICULTY, FLIGHT } from './config.js';
import { clamp, lerp, angleDiff, degToRad } from './random.js';
import { createWorld } from './world.js';
import { createDrone, AIRCRAFT, aircraftById } from './drone.js';
import { TIME_ORDER } from './atmosphere.js';
import { createDroneShadow } from './droneShadow.js';
import { createFlightState, stepFlight, flightReadout } from './physics.js';
import { createRings } from './rings.js';
import { MISSIONS, createMissionRunner, gradeFor } from './missions.js';
import { createHUD } from './hud.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { getShotSetup } from './shots.js';

const THREE = window.THREE;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 9000);

// Progress + settings (local only — never leaves the browser). Parsed
// before the world so the saved aircraft and time-of-day apply at boot.
const settings = JSON.parse(localStorage.getItem('osh-settings-v1') || '{"volume":0.7,"quality":"high","muted":false,"aircraft":"quad","time":"clear"}');
let timePreset = settings.time || 'clear';

const world = createWorld(scene, renderer);
const drone = createDrone(scene, settings.aircraft || 'quad');
// A failed aircraft load shows a clear on-screen error instead of
// silently leaving the placeholder up.
window.addEventListener('osh-aircraft-error', (e) => {
  showToast(`AIRCRAFT FAILED TO LOAD: ${e.detail.name} — check the game files`, 5000);
});
const droneShadow = createDroneShadow(scene);
world.applyPreset(timePreset);
const hud = createHUD();
const audio = createAudio();
const input = createInput(canvas);
const shot = getShotSetup();

// Progress (local only).
const progress = JSON.parse(localStorage.getItem('osh-progress-v1') || '{"unlocked":1,"best":{}}');
audio.setVolume(settings.volume);
audio.setMuted(settings.muted);

let difficultyKey = 'normal';
let difficulty = DIFFICULTY[difficultyKey];
let screen = 'menu'; // menu | playing | paused | complete | failed
let flight = null;
let runner = null;
let rings = null;
let missionIndex = 0;
let cameraMode = 'chase'; // chase | fpv
let time = 0;
let trauma = 0;
let toastTimer = null;
let refuelCooldown = 0;
let crashTimer = 0;
let framesRendered = 0;

const $ = (id) => document.getElementById(id);
const toastEl = $('hud-toast');

function showToast(text, ms = 2200) {
  toastEl.textContent = text;
  toastEl.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.style.opacity = '0'; }, ms);
}

// ---------------------------------------------------------------------------
// Quality
// ---------------------------------------------------------------------------
function applyQuality() {
  const q = settings.quality;
  if (q === 'high') {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    world.sun.shadow.mapSize.set(2048, 2048);
  } else if (q === 'medium') {
    renderer.setPixelRatio(1.25);
    renderer.shadowMap.enabled = true;
    world.sun.shadow.mapSize.set(1024, 1024);
  } else {
    renderer.setPixelRatio(1);
    renderer.shadowMap.enabled = false;
  }
  if (world.sun.shadow.map) {
    world.sun.shadow.map.dispose();
    world.sun.shadow.map = null;
  }
}
applyQuality();

// ---------------------------------------------------------------------------
// Mission lifecycle
// ---------------------------------------------------------------------------
function buildRings(mission) {
  const defs = [];
  const spawnY = world.heightAt(mission.spawn.x, mission.spawn.z) + mission.spawnAlt;
  let prev = { x: mission.spawn.x, y: spawnY, z: mission.spawn.z };
  for (const r of mission.rings) {
    const y = world.heightAt(r.x, r.z) + r.clearance;
    defs.push({ x: r.x, y, z: r.z, from: { ...prev } });
    prev = { x: r.x, y, z: r.z };
  }
  return createRings(scene, defs, difficulty.ringRadius);
}

function startMission(index) {
  missionIndex = index;
  const mission = MISSIONS[index];
  if (rings) rings.dispose();
  rings = buildRings(mission);
  rings.setActive(0);
  const spawnY = world.heightAt(mission.spawn.x, mission.spawn.z) + mission.spawnAlt;
  flight = createFlightState({
    x: mission.spawn.x,
    y: spawnY,
    z: mission.spawn.z,
    heading: degToRad(mission.spawn.headingDeg),
  });
  runner = createMissionRunner(world, difficulty);
  runner.start(index, rings);
  flight.lookTarget = rings.next() ? rings.next().center : null;
  hud.setMission(mission, difficulty.label);
  trauma = 0;
  crashTimer = 0;
  refuelCooldown = 0;
  cameraMode = 'chase';
  showScreen('playing');
}

function endMission(win, reason) {
  if (win) {
    const bonus = runner.finishScore();
    const total = runner.score + bonus.timeBonus;
    const grade = gradeFor(total, runner.parScore());
    progress.unlocked = Math.max(progress.unlocked, Math.min(5, missionIndex + 2));
    progress.best[missionIndex + 1] = Math.max(progress.best[missionIndex + 1] || 0, total);
    localStorage.setItem('osh-progress-v1', JSON.stringify(progress));
    $('complete-title').textContent = `MISSION 0${missionIndex + 1} COMPLETE`;
    $('complete-time').textContent = `${Math.floor(runner.elapsed / 60)}:${String(Math.floor(runner.elapsed % 60)).padStart(2, '0')}`;
    $('complete-speed').textContent = `${Math.round(flight.maxSpeedReached * 3.6)} km/h`;
    $('complete-rings').textContent = `${rings.passedCount()} / ${rings.list.length}`;
    $('complete-landing').textContent = runner.landing
      ? `${Math.round(runner.landing.quality * 100)}% — SPD ${runner.landing.speedMs.toFixed(1)} m/s, ALIGN ${runner.landing.alignDeg.toFixed(0)}°`
      : '—';
    $('complete-score').textContent = `${total}  (time bonus +${bonus.timeBonus})`;
    $('complete-grade').textContent = grade;
    $('complete-grade').style.color = grade === 'S' ? '#ffd94d' : grade === 'A' ? '#5affc8' : grade === 'B' ? '#9fd8ff' : '#ffb020';
    $('btn-next').style.display = missionIndex < 4 ? '' : 'none';
    audio.complete();
    showScreen('complete');
  } else {
    $('failed-reason').textContent = reason || 'Mission failed';
    showScreen('failed');
  }
}

// ---------------------------------------------------------------------------
// Screens / menus
// ---------------------------------------------------------------------------
const screens = ['menu-main', 'menu-missions', 'menu-settings', 'menu-controls', 'menu-pause', 'menu-complete', 'menu-failed'];
function showOnly(id) {
  for (const s of screens) $(s).classList.toggle('hidden', s !== id);
  $('hud').classList.toggle('hidden', !(screen === 'playing' || screen === 'paused'));
}
function showScreen(next) {
  screen = next;
  if (next === 'playing') showOnly(null);
  else if (next === 'paused') showOnly('menu-pause');
  else if (next === 'complete') showOnly('menu-complete');
  else if (next === 'failed') showOnly('menu-failed');
  else showOnly('menu-main');
  if (next === 'paused') audio.setVolume(0);
  else if (next !== 'menu') audio.setVolume(settings.muted ? 0 : settings.volume);
}

function refreshMissionMenu() {
  document.querySelectorAll('.mission-btn').forEach((btn) => {
    const idx = Number(btn.dataset.mission);
    const locked = idx >= progress.unlocked;
    btn.classList.toggle('locked', locked);
    const best = progress.best[idx + 1];
    btn.querySelector('.mission-best').textContent = locked
      ? 'LOCKED — COMPLETE THE PREVIOUS MISSION'
      : best ? `BEST SCORE ${best}` : 'NOT FLOWN YET';
  });
  document.querySelectorAll('.diff-btn').forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.diff === difficultyKey);
  });
}

function refreshAircraftMenu() {
  document.querySelectorAll('.aircraft-btn').forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.aircraft === drone.getAircraftId());
  });
}

function wireMenus() {
  $('btn-start').addEventListener('click', () => {
    audio.init();
    audio.click();
    startMission(Math.min(missionIndex, progress.unlocked - 1));
  });
  $('btn-missions').addEventListener('click', () => { audio.click(); refreshMissionMenu(); showOnly('menu-missions'); });
  $('btn-settings').addEventListener('click', () => { audio.click(); showOnly('menu-settings'); });
  $('btn-controls').addEventListener('click', () => { audio.click(); showOnly('menu-controls'); });
  $('btn-back-missions').addEventListener('click', () => { audio.click(); showOnly('menu-main'); });
  $('btn-back-settings').addEventListener('click', () => { audio.click(); showOnly(screen === 'paused' ? 'menu-pause' : 'menu-main'); });
  $('btn-back-controls').addEventListener('click', () => { audio.click(); showOnly('menu-main'); });
  document.querySelectorAll('.diff-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      difficultyKey = btn.dataset.diff;
      difficulty = DIFFICULTY[difficultyKey];
      audio.click();
      refreshMissionMenu();
    });
  });
  // Aircraft buttons, built from the registry so a new model adds itself
  // to every menu that carries an .aircraft-row.
  document.querySelectorAll('.aircraft-row').forEach((row) => {
    AIRCRAFT.forEach((a) => {
      const btn = document.createElement('button');
      btn.className = 'btn diff-btn aircraft-btn';
      btn.dataset.aircraft = a.id;
      btn.textContent = a.name;
      btn.addEventListener('click', () => {
        drone.setAircraft(a.id);
        settings.aircraft = a.id;
        localStorage.setItem('osh-settings-v1', JSON.stringify(settings));
        audio.click();
        refreshAircraftMenu();
      });
      row.appendChild(btn);
    });
  });
  refreshAircraftMenu();
  document.querySelectorAll('.mission-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.mission);
      if (idx >= progress.unlocked) return;
      audio.init();
      audio.click();
      missionIndex = idx;
      startMission(idx);
    });
  });
  $('btn-resume').addEventListener('click', () => { audio.click(); showScreen('playing'); });
  $('btn-restart').addEventListener('click', () => { audio.click(); startMission(missionIndex); });
  $('btn-pause-settings').addEventListener('click', () => { audio.click(); showOnly('menu-settings'); });
  $('btn-pause-menu').addEventListener('click', () => { audio.click(); startAttract(); showScreen('menu'); });
  $('btn-next').addEventListener('click', () => { audio.click(); startMission(Math.min(4, missionIndex + 1)); });
  $('btn-retry-complete').addEventListener('click', () => { audio.click(); startMission(missionIndex); });
  $('btn-complete-menu').addEventListener('click', () => { audio.click(); startAttract(); showScreen('menu'); });
  $('btn-retry-failed').addEventListener('click', () => { audio.click(); startMission(missionIndex); });
  $('btn-failed-menu').addEventListener('click', () => { audio.click(); startAttract(); showScreen('menu'); });

  // Settings controls.
  const vol = $('set-volume');
  vol.value = String(Math.round(settings.volume * 100));
  vol.addEventListener('input', () => {
    settings.volume = Number(vol.value) / 100;
    audio.setVolume(settings.volume);
    localStorage.setItem('osh-settings-v1', JSON.stringify(settings));
  });
  const qual = $('set-quality');
  qual.value = settings.quality;
  qual.addEventListener('change', () => {
    settings.quality = qual.value;
    applyQuality();
    localStorage.setItem('osh-settings-v1', JSON.stringify(settings));
  });
  const mute = $('set-mute');
  mute.checked = settings.muted;
  mute.addEventListener('change', () => {
    settings.muted = mute.checked;
    audio.setMuted(settings.muted);
    localStorage.setItem('osh-settings-v1', JSON.stringify(settings));
  });
  const timeSel = $('set-time');
  timeSel.value = timePreset;
  timeSel.addEventListener('change', () => {
    timePreset = timeSel.value;
    const label = world.applyPreset(timePreset);
    settings.time = timePreset;
    localStorage.setItem('osh-settings-v1', JSON.stringify(settings));
    showToast(`LIGHTING: ${label}`);
  });
}

// ---------------------------------------------------------------------------
// Autopilot (menu backdrop + screenshot mode)
// ---------------------------------------------------------------------------
function autopilotInput(target, cruiseThrottle) {
  if (!target) return { pitch: 0, roll: 0, yaw: 0, throttleUp: false, throttleDown: false, stabilize: false };
  const dx = target.x - flight.pos.x;
  const dz = target.z - flight.pos.z;
  const desired = Math.atan2(dx, -dz);
  const err = angleDiff(desired, flight.heading);
  const dy = target.y - flight.pos.y;
  return {
    pitch: clamp(-dy * 0.02, -0.55, 0.55),
    roll: clamp(err * 1.4, -1, 1),
    yaw: clamp(err * 0.5, -0.5, 0.5),
    throttleUp: flight.throttle < cruiseThrottle,
    throttleDown: flight.throttle > cruiseThrottle + 0.08,
    stabilize: false,
  };
}

function autopilotTarget() {
  const next = rings ? rings.next() : null;
  if (next) return next.center;
  if (runner && runner.mission && runner.mission.runway) {
    return { x: WORLD.RUNWAY.x, y: WORLD.RUNWAY.height + 8, z: WORLD.RUNWAY.z };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Attract mode: the live 3D world flies itself behind the main menu.
// ---------------------------------------------------------------------------
function startAttract() {
  const mission = MISSIONS[0];
  if (rings) rings.dispose();
  rings = buildRings(mission);
  rings.setActive(0);
  const spawnY = world.heightAt(mission.spawn.x, mission.spawn.z) + mission.spawnAlt;
  flight = createFlightState({
    x: mission.spawn.x, y: spawnY, z: mission.spawn.z, heading: degToRad(mission.spawn.headingDeg),
  });
  runner = createMissionRunner(world, difficulty);
  runner.start(0, rings);
  flight.lookTarget = rings.next() ? rings.next().center : null;
  cameraMode = 'chase';
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------
const camPos = new THREE.Vector3(0, 120, 200);
const camLook = new THREE.Vector3(0, 100, 0);
const CHASE_FOV = 62;
const FPV_FOV = 75;
function setFov(f) {
  if (camera.fov !== f) {
    camera.fov = f;
    camera.updateProjectionMatrix();
  }
}

function updateCamera(dt) {
  const fwd = new THREE.Vector3(
    Math.sin(flight.heading) * Math.cos(flight.pitch),
    -Math.sin(flight.pitch),
    -Math.cos(flight.heading) * Math.cos(flight.pitch),
  );
  // First-person view: the body is hidden but the spinning props stay
  // visible (drone.setFpvMode), and the camera uses a wider FOV so the
  // front rotors fall inside the frame at both edges. Chase keeps the
  // standard 62° FOV and the full model on screen.
  drone.setFpvMode(cameraMode === 'fpv');
  if (cameraMode === 'fpv') {
    setFov(FPV_FOV);
    // Fallback is a safe generic, not the old fixed 1.6 m: 1.6 m put the
    // camera inside the fuselage of any ~6 m-class aircraft. 3.0 m clears
    // every nose in the current size class.
    const fpvEye = aircraftById(drone.getAircraftId()).fpvEye || { forward: 3.0, up: 0.5 };
    const eye = flight.pos.clone().addScaledVector(fwd, fpvEye.forward);
    eye.y += fpvEye.up;
    camera.position.copy(eye);
    camera.lookAt(flight.pos.clone().addScaledVector(fwd, 40));
    return;
  }
  setFov(CHASE_FOV);
  // Shot mode only: the screenshot setups carry a closer, hero framing
  // (camDist / camHeight / camLead). Normal play always uses the standard
  // chase camera below — gameplay framing is untouched.
  const camDist = shot && shot.camDist ? shot.camDist : 14;
  const camHeight = shot && shot.camHeight ? shot.camHeight : 4.6;
  const camLead = shot && shot.camLead ? shot.camLead : 22;
  const desired = flight.pos.clone().addScaledVector(fwd, -camDist).add(new THREE.Vector3(0, camHeight, 0));
  // Keep the chase camera out of the terrain.
  const ground = world.heightAt(desired.x, desired.z);
  if (desired.y < ground + 2.5) desired.y = ground + 2.5;
  const k = 1 - Math.exp(-4.2 * dt);
  camPos.lerp(desired, k);
  const lookTarget = flight.pos.clone().addScaledVector(fwd, camLead);
  lookTarget.y += 1.2;
  camLook.lerp(lookTarget, 1 - Math.exp(-7 * dt));
  // Speed shake: trauma grows with speed and throttle.
  const speedFactor = clamp(flight.speed / difficulty.maxSpeed, 0, 1);
  trauma = Math.max(trauma - dt * 1.4, speedFactor > 0.85 ? 0.22 : 0);
  const sh = trauma * trauma;
  camera.position.set(
    camPos.x + (Math.random() - 0.5) * sh * 1.4,
    camPos.y + (Math.random() - 0.5) * sh * 1.0,
    camPos.z + (Math.random() - 0.5) * sh * 1.4,
  );
  camera.lookAt(camLook);
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
let warningCooldown = 0;

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  time += dt;
  framesRendered += 1;

  // One-shot keys.
  if (!shot && input.wasPressed('KeyT')) {
    timePreset = TIME_ORDER[(TIME_ORDER.indexOf(timePreset) + 1) % TIME_ORDER.length];
    const label = world.applyPreset(timePreset);
    settings.time = timePreset;
    localStorage.setItem('osh-settings-v1', JSON.stringify(settings));
    const timeSel = $('set-time');
    if (timeSel) timeSel.value = timePreset;
    showToast(`LIGHTING: ${label}`);
  }
  if (!shot && input.wasPressed('KeyV') && screen === 'playing') {
    const ids = AIRCRAFT.map((a) => a.id);
    const next = ids[(ids.indexOf(drone.getAircraftId()) + 1) % ids.length];
    drone.setAircraft(next);
    settings.aircraft = next;
    localStorage.setItem('osh-settings-v1', JSON.stringify(settings));
    refreshAircraftMenu();
    showToast(`AIRCRAFT: ${aircraftById(next).name}`);
  }
  if (!shot && input.wasPressed('KeyC') && screen === 'playing') {
    cameraMode = cameraMode === 'chase' ? 'fpv' : 'chase';
    showToast(cameraMode === 'fpv' ? 'CAMERA: FIRST PERSON' : 'CAMERA: CHASE');
  }
  if (!shot && input.wasPressed('KeyR') && screen === 'playing') {
    startMission(missionIndex);
    showToast('POSITION RESET');
  }
  if (!shot && input.wasPressed('Escape')) {
    if (screen === 'playing') showScreen('paused');
    else if (screen === 'paused') showScreen('playing');
  }
  if (input.wasPressed('Enter') && screen === 'menu') {
    audio.init();
    startMission(Math.min(missionIndex, progress.unlocked - 1));
  }

  // --- simulate -------------------------------------------------------------
  if (screen === 'menu') {
    // Attract mode: the drone flies itself behind the menu.
    if (!flight) startAttract();
    const target = autopilotTarget();
    const ev = stepFlight(flight, autopilotInput(target, 0.5), dt, DIFFICULTY.normal, world, time);
    if (flight.crashed) startAttract();
    void ev;
    drone.group.position.set(flight.pos.x, flight.pos.y, flight.pos.z);
    drone.update(dt, time, flight);
    droneShadow.update(flight.pos, world.heightAt(flight.pos.x, flight.pos.z));
    updateCamera(dt);
  } else if (screen === 'playing') {
    const axes = shot ? autopilotInput(autopilotTarget(), shot.throttle) : input.axes();
    const ev = stepFlight(flight, axes, dt, difficulty, world, time);
    const readout = flightReadout(flight, world);

    // Ring passing.
    const passed = rings.checkPass(flight.pos);
    if (passed) {
      const pts = runner.onRingPassed(passed, readout);
      rings.setActive(rings.passedCount());
      flight.lookTarget = rings.next() ? rings.next().center : null;
      audio.ring();
      showToast(`RING ${passed.index + 1} CLEAR  +${pts}`);
    }

    // Refuel when parked on the runway (any mission).
    refuelCooldown = Math.max(0, refuelCooldown - dt);
    const rw = WORLD.RUNWAY;
    const onStrip = Math.abs(flight.pos.x - rw.x) < rw.length / 2
      && Math.abs(flight.pos.z - rw.z) < rw.width / 2
      && flight.pos.y - rw.height < 3.5;
    if (onStrip && readout.speedMs < 8 && flight.fuel < 99 && refuelCooldown <= 0) {
      flight.fuel = 100;
      refuelCooldown = 5;
      showToast('REFUELLED — FUEL 100%');
      audio.ring();
    }

    // Mission state.
    const event = runner.update(dt, flight, readout);
    if (event === 'complete' || event === 'landed') {
      endMission(true);
    } else if (event === 'timeout' || event === 'fuel') {
      audio.crash();
      endMission(false, runner.failReason);
    } else if (event === 'crashed') {
      audio.crash();
      trauma = 1;
      crashTimer = 0.9;
    }
    if (flight.crashed && screen === 'playing') {
      crashTimer -= dt;
      if (crashTimer <= 0) endMission(false, runner.failReason);
    }

    // Low-fuel / terrain warnings (throttled beeps).
    warningCooldown -= dt;
    if (warningCooldown <= 0 && (readout.fuel < 25 || (readout.altAgl < 15 && readout.vs < -4))) {
      audio.warning();
      warningCooldown = 1.4;
    }

    rings.update(dt, time, flight.pos);
    drone.group.position.set(flight.pos.x, flight.pos.y, flight.pos.z);
    drone.update(dt, time, flight);
    droneShadow.update(flight.pos, world.heightAt(flight.pos.x, flight.pos.z));
    updateCamera(dt);
    hud.update(readout, flight, runner.mission, rings.next(), runner.timeLeft, runner.score, camera, world);
    audio.update(flight.throttle, readout.speedKmh, dt);

    // Sun shadow volume follows the drone (offset set by the time preset).
    world.sun.position.set(flight.pos.x + world.sunOffset.x, flight.pos.y + world.sunOffset.y, flight.pos.z + world.sunOffset.z);
    world.sun.target.position.set(flight.pos.x, flight.pos.y, flight.pos.z);
  } else if (screen === 'paused' || screen === 'complete' || screen === 'failed') {
    // Frozen frame behind the overlay; keep the drone rotors idling visually.
    if (flight) {
      drone.group.position.set(flight.pos.x, flight.pos.y, flight.pos.z);
      drone.update(0.0001, time, flight);
    }
  }

  // Clouds drift; tower lights blink; sky, water and foliage animate.
  for (const c of world.clouds) {
    c.position.x += c.userData.speed * dt;
    if (c.position.x > 2200) c.position.x = -2200;
  }
  world.updateVisuals(dt, time);
  const blink = Math.sin(time * 2.4) > 0;
  for (const m of world.towerLights) m.color.setHex(blink ? 0xff2222 : 0x551111);

  renderer.render(scene, camera);
  if (framesRendered === 2) {
    window.__oshReady = true;
    const loading = document.getElementById('loading');
    if (loading) loading.remove();
  }
  input.endFrame();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
wireMenus();
refreshMissionMenu();
if (shot) {
  // Screenshot mode: straight into the staged moment, no menus.
  audio.init();
  startMission(shot.missionIndex);
  // Fast-forward the drone toward the first ring so the frame is alive.
  flight.pos.add(new THREE.Vector3(
    Math.sin(flight.heading) * shot.headStart,
    0,
    -Math.cos(flight.heading) * shot.headStart,
  ));
  flight.throttle = shot.throttle;
  flight.speed = shot.throttle * difficulty.maxSpeed * 0.7;
  // Snap the chase camera onto the drone now: at low headless frame
  // rates the camera lerp would otherwise still be swinging when the
  // first frame is captured, leaving the aircraft at the edge.
  updateCamera(10);
  $('menu-main').classList.add('hidden');
} else {
  startAttract();
  showScreen('menu');
}
frame();
