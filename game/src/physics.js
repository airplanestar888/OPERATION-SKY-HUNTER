// Operation: Sky Hunter — flight physics.
// An arcade flight model with real feel: throttle-driven speed, banked
// turns, pitch-driven climb and sink, inertia, wind, fuel burn, and
// terrain / obstacle collisions. All HUD numbers come from this state.

import { FLIGHT } from './config.js';
import { clamp, lerp, angleDiff } from './random.js';

export function createFlightState(spawn) {
  const V3 = window.THREE.Vector3;
  return {
    pos: new V3(spawn.x, spawn.y, spawn.z),
    heading: spawn.heading, // radians, 0 = north (-Z)
    pitch: 0, // + = nose down
    roll: 0, // + = bank right
    speed: 0, // m/s along the flight path
    vy: 0, // m/s vertical
    throttle: 0.35,
    fuel: FLIGHT.fuelCapacity,
    hull: FLIGHT.hull,
    crashed: false,
    crashReason: '',
    airborne: false,
    maxSpeedReached: 0,
    distanceFlown: 0,
    lookTarget: null,
  };
}

// input: { pitch, roll, yaw, throttleUp, throttleDown, stabilize } in [-1, 1]
// for the axes and booleans for the rest. Returns an event object.
export function stepFlight(state, input, dt, difficulty, world, time) {
  const ev = { hitGround: false, hitObstacle: null, fuelEmpty: false };
  if (state.crashed) return ev;

  // --- throttle ------------------------------------------------------------
  if (input.throttleUp) state.throttle = clamp(state.throttle + 0.55 * dt, 0, 1);
  if (input.throttleDown) state.throttle = clamp(state.throttle - 0.8 * dt, 0, 1);

  // --- attitude targets ----------------------------------------------------
  const targetPitch = clamp(input.pitch, -1, 1) * FLIGHT.maxPitch;
  const targetRoll = clamp(input.roll, -1, 1) * FLIGHT.maxRoll;
  const settle = input.stabilize ? 3.2 : difficulty.stabilization;
  const pitchRate = input.pitch !== 0 ? 2.6 * difficulty.accel : settle;
  const rollRate = input.roll !== 0 ? 3.0 * difficulty.accel : settle;
  state.pitch = lerp(state.pitch, input.pitch !== 0 ? targetPitch : 0, Math.min(1, pitchRate * dt));
  state.roll = lerp(state.roll, input.roll !== 0 ? targetRoll : 0, Math.min(1, rollRate * dt));

  // --- heading: direct yaw plus banked turn --------------------------------
  // Heading 0 = north (-Z), increasing toward east (+X). Banking right
  // (roll > 0) turns the nose right, so it adds to the heading.
  const turnRate = input.yaw * FLIGHT.yawRate + state.roll * FLIGHT.bankTurnRate;
  state.heading += turnRate * dt * (0.55 + 0.45 * clamp(state.speed / difficulty.maxSpeed, 0, 1));

  // --- speed along the flight path -----------------------------------------
  const targetSpeed = state.throttle * difficulty.maxSpeed;
  const accel = difficulty.accel * (targetSpeed > state.speed ? 14 : 9);
  state.speed = lerp(state.speed, targetSpeed, Math.min(1, (accel / difficulty.maxSpeed) * dt * 3));
  state.speed = clamp(state.speed, 0, difficulty.maxSpeed * 1.05);
  if (state.speed > state.maxSpeedReached) state.maxSpeedReached = state.speed;

  // --- vertical speed: pitch + throttle lift --------------------------------
  const lift = (state.throttle - FLIGHT.hoverThrottle) * FLIGHT.climbRate * 2.2;
  const pitchVy = -Math.sin(state.pitch) * state.speed;
  const targetVy = clamp(pitchVy + lift, -28, 26);
  state.vy = lerp(state.vy, targetVy, Math.min(1, 2.2 * dt));

  // --- wind gusts on harder difficulties ------------------------------------
  let windX = 0;
  let windZ = 0;
  if (difficulty.wind > 0) {
    const g = Math.sin(time * 0.31) * 0.6 + Math.sin(time * 0.83 + 1.7) * 0.4;
    windX = g * 5.5 * difficulty.wind;
    windZ = Math.cos(time * 0.23 + 0.6) * 4.0 * difficulty.wind;
  }

  // --- integrate ------------------------------------------------------------
  // Forward vector: heading 0 faces north (-Z), 90 deg faces east (+X).
  const fx = Math.sin(state.heading) * Math.cos(state.pitch);
  const fz = -Math.cos(state.heading) * Math.cos(state.pitch);
  const dx = fx * state.speed + windX;
  const dz = fz * state.speed + windZ;
  state.pos.x += dx * dt;
  state.pos.z += dz * dt;
  state.pos.y += state.vy * dt;
  state.distanceFlown += Math.hypot(dx, state.vy, dz) * dt;

  // Soft world edge: steer back instead of a hard wall.
  const r = Math.hypot(state.pos.x, state.pos.z);
  if (r > 2050) {
    const push = (r - 2050) * 0.02;
    state.pos.x -= (state.pos.x / r) * push;
    state.pos.z -= (state.pos.z / r) * push;
  }

  // --- fuel ------------------------------------------------------------------
  const drain = (FLIGHT.fuelDrainBase + state.throttle * FLIGHT.fuelDrainThrottle) * difficulty.fuelDrain;
  state.fuel = Math.max(0, state.fuel - drain * dt);
  if (state.fuel <= 0 && !ev.fuelEmpty) {
    ev.fuelEmpty = true;
    state.throttle = Math.min(state.throttle, 0.18);
  }
  if (state.speed > 4) state.airborne = true;

  // --- terrain collision ------------------------------------------------------
  const ground = world.heightAt(state.pos.x, state.pos.z);
  const agl = state.pos.y - ground;
  if (agl < 2.2) {
    const hardHit = state.vy < -FLIGHT.crashDescent || state.speed > 55;
    if (difficulty.label === 'EASY' && !hardHit) {
      // Forgiving bounce: scrape, lose a little hull, climb back out.
      state.pos.y = ground + 2.2;
      state.vy = Math.abs(state.vy) * 0.45 + 2;
      state.hull -= 4;
      ev.hitGround = true;
    } else {
      state.crashed = true;
      state.crashReason = state.vy < -FLIGHT.crashDescent
        ? 'Controlled flight into terrain — descent too steep'
        : 'Terrain impact at speed';
      state.pos.y = ground + 1.2;
      ev.hitGround = true;
    }
  }

  // --- obstacle collision (towers, hangars, houses) --------------------------
  for (const o of world.obstacles) {
    const dxo = state.pos.x - o.x;
    const dzo = state.pos.z - o.z;
    const dist = Math.hypot(dxo, dzo);
    if (dist < o.r + 2.5 && state.pos.y < o.top + 1.5 && state.pos.y > world.heightAt(o.x, o.z) - 2) {
      state.hull -= difficulty.damage;
      ev.hitObstacle = o;
      // Shove the drone out of the obstacle so it does not stick.
      const push = (o.r + 2.5 - dist) || 1;
      state.pos.x += (dxo / (dist || 1)) * push;
      state.pos.z += (dzo / (dist || 1)) * push;
      state.speed *= 0.55;
      state.vy = Math.max(state.vy, 3);
      if (state.hull <= 0) {
        state.crashed = true;
        state.crashReason = `Airframe destroyed — struck a ${o.kind}`;
      }
      break;
    }
  }
  return ev;
}

// Derived readouts for the HUD — always computed from the live state.
export function flightReadout(state, world) {
  const ground = world.heightAt(state.pos.x, state.pos.z);
  const hSpeed = state.speed * Math.cos(state.pitch);
  return {
    altAgl: Math.max(0, state.pos.y - ground),
    altMsl: state.pos.y,
    speedKmh: hSpeed * 3.6,
    speedMs: state.speed,
    vs: state.vy,
    throttlePct: Math.round(state.throttle * 100),
    headingDeg: (((state.heading * 180) / Math.PI) % 360 + 360) % 360,
    fuel: state.fuel,
    hull: Math.max(0, state.hull),
  };
}
