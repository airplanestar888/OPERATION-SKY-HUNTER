// Operation: Sky Hunter — missions.
// Five progressively harder sorties. Each mission defines a spawn, a set of
// rings, a time limit and (for the finale) a runway landing. The runner
// owns the timer, the score and the landing evaluation, and reports events
// the main loop turns into screens and sounds.

import { WORLD, SCORE } from './config.js';
import { clamp, degToRad } from './random.js';

function ring(x, z, clearance) {
  return { x, z, clearance };
}

export const MISSIONS = [
  {
    id: 1,
    name: 'FIRST FLIGHT',
    briefing: 'Learn the controls. Fly through all 3 rings, then return to the pattern.',
    spawn: { x: 0, z: 60, headingDeg: 0 },
    spawnAlt: 90,
    timeLimit: 180,
    rings: [ring(0, -260, 60), ring(-120, -560, 55), ring(80, -860, 60)],
    runway: false,
  },
  {
    id: 2,
    name: 'LOW ALTITUDE',
    briefing: 'Stay low in the river valley. Thread the rings under the cliffs — watch the terrain.',
    spawn: { x: -1500, z: -600, headingDeg: 90 },
    spawnAlt: 45,
    timeLimit: 240,
    rings: [
      ring(-1100, -600, 26), ring(-650, -620, 24), ring(-180, -590, 24),
      ring(320, -610, 26), ring(820, -600, 26),
    ],
    runway: false,
  },
  {
    id: 3,
    name: 'THE GAUNTLET',
    briefing: 'Six rings, each narrower than the last. Speed and precision both count.',
    spawn: { x: -900, z: 300, headingDeg: 45 },
    spawnAlt: 150,
    timeLimit: 300,
    rings: [
      ring(-620, 60, 130), ring(-300, -180, 150), ring(60, -420, 120),
      ring(420, -260, 170), ring(760, 60, 140), ring(980, 420, 160),
    ],
    runway: false,
  },
  {
    id: 4,
    name: 'HIGH ALTITUDE',
    briefing: 'Climb into the mountain wall and tag the high checkpoints. Thin margins, hard wind.',
    spawn: { x: 0, z: 300, headingDeg: 315 },
    spawnAlt: 170,
    timeLimit: 300,
    rings: [ring(-900, -1350, 210), ring(-1450, -700, 260), ring(-1150, 200, 230)],
    runway: false,
  },
  {
    id: 5,
    name: 'FINAL APPROACH',
    briefing: 'Fly the approach corridor, then put her down on runway 09/27. Speed, alignment and descent rate are graded.',
    spawn: { x: -900, z: 1200, headingDeg: 90 },
    spawnAlt: 110,
    timeLimit: 360,
    rings: [ring(-520, 1200, 70), ring(-260, 1200, 55)],
    runway: true,
  },
];

export function gradeFor(score, par) {
  const ratio = par > 0 ? score / par : 0;
  if (ratio >= 0.9) return 'S';
  if (ratio >= 0.75) return 'A';
  if (ratio >= 0.55) return 'B';
  return 'C';
}

export function createMissionRunner(world, difficulty) {
  let mission = null;
  let missionIndex = 0;
  let rings = null;
  let timeLeft = 0;
  let elapsed = 0;
  let score = 0;
  let finished = false;
  let failed = false;
  let failReason = '';
  let landing = null;

  return {
    get mission() { return mission; },
    get missionIndex() { return missionIndex; },
    get rings() { return rings; },
    get timeLeft() { return timeLeft; },
    get elapsed() { return elapsed; },
    get score() { return score; },
    get finished() { return finished; },
    get failed() { return failed; },
    get failReason() { return failReason; },
    get landing() { return landing; },

    start(index, ringSet) {
      missionIndex = index;
      mission = MISSIONS[index];
      rings = ringSet;
      timeLeft = mission.timeLimit * difficulty.timeMult;
      elapsed = 0;
      score = 0;
      finished = false;
      failed = false;
      failReason = '';
      landing = null;
    },

    // Called when a ring is passed. Returns the points earned.
    onRingPassed(r, readout) {
      const pts = SCORE.ringBase + Math.round(SCORE.ringAccuracyMax * r.accuracy);
      score += pts;
      return pts;
    },

    // Called once per frame. Returns an event string or ''.
    update(dt, flight, readout) {
      if (!mission || finished || failed) return '';
      elapsed += dt;
      timeLeft -= dt;
      if (timeLeft <= 0) {
        failed = true;
        failReason = 'Time expired — the mission window closed';
        return 'timeout';
      }
      if (flight.crashed) {
        failed = true;
        failReason = flight.crashReason || 'Drone lost';
        return 'crashed';
      }
      if (flight.fuel <= 0 && flight.pos.y - world.heightAt(flight.pos.x, flight.pos.z) < 3) {
        failed = true;
        failReason = 'Fuel exhausted — forced landing away from base';
        return 'fuel';
      }
      // Mission 5 ends with a landing on the runway, not a final ring.
      if (mission.runway) {
        const rw = WORLD.RUNWAY;
        const onStrip = Math.abs(flight.pos.x - rw.x) < rw.length / 2
          && Math.abs(flight.pos.z - rw.z) < rw.width / 2;
        const agl = flight.pos.y - rw.height;
        if (onStrip && agl < 3.5 && readout.speedMs < difficulty.landingSpeedMax + 6 && flight.airborne) {
          const descent = Math.abs(Math.min(0, readout.vs));
          const angDiffDeg = (a, b) => Math.abs((((a - b + 540) % 360) - 180));
          const align = Math.min(angDiffDeg(readout.headingDeg, 90), angDiffDeg(readout.headingDeg, 270));
          const alignScore = clamp(1 - align / difficulty.landingAlignDeg, 0, 1);
          const speedScore = clamp(1 - readout.speedMs / (difficulty.landingSpeedMax + 6), 0, 1);
          const descentScore = clamp(1 - descent / difficulty.landingDescentMax, 0, 1);
          const quality = (alignScore + speedScore + descentScore) / 3;
          landing = {
            quality,
            speedMs: readout.speedMs,
            descent,
            alignDeg: align,
          };
          score += SCORE.landingBase + Math.round(SCORE.landingAccuracyMax * quality);
          finished = true;
          return 'landed';
        }
      }
      // Other missions end when the last ring is passed.
      if (!mission.runway && rings && rings.passedCount() === rings.list.length) {
        finished = true;
        return 'complete';
      }
      return '';
    },

    finishScore() {
      // Time bonus + speed bonus, added once at mission end.
      const timeBonus = Math.round(Math.max(0, timeLeft) * SCORE.timeBonusPerSecond);
      return { timeBonus };
    },

    parScore() {
      // Rough par for grading: rings at full marks + landing + time.
      const ringPar = mission.rings.length * (SCORE.ringBase + SCORE.ringAccuracyMax);
      const landPar = mission.runway ? SCORE.landingBase + SCORE.landingAccuracyMax : 0;
      return ringPar + landPar + 600;
    },
  };
}
