// Operation: Sky Hunter — tuning, difficulty tables and world constants.
// Every number that shapes how the game feels lives here, so balancing
// never means hunting through the flight model or the level code.

export const WORLD = {
  SIZE: 4200, // terrain spans -2100 .. +2100 on X and Z (metres)
  SEA_LEVEL: 0,
  RUNWAY: { x: 0, z: 1200, length: 400, width: 40, height: 42, headingDeg: 90 },
  BASE: { x: -260, z: 980 },
  VALLEY_Z: -600,
};

// Difficulty actually changes the flight model, the rings, the timers and
// the landing tolerances — it is never just a label on the menu.
export const DIFFICULTY = {
  easy: {
    label: 'EASY',
    accel: 0.65, // how fast speed chases the throttle target
    maxSpeed: 55, // m/s
    ringRadius: 15, // metres (checkpoint rings get wider)
    timeMult: 1.6, // mission timers are longer
    damage: 10, // HP lost per hard hit
    wind: 0.0, // no wind gusts
    stabilization: 2.4, // auto-level strength (rad/s)
    landingSpeedMax: 16, // m/s allowed on touchdown
    landingDescentMax: 5, // m/s sink allowed on touchdown
    landingAlignDeg: 25, // runway alignment tolerance
    fuelDrain: 0.75, // multiplier on fuel burn
  },
  normal: {
    label: 'NORMAL',
    accel: 1.0,
    maxSpeed: 70,
    ringRadius: 11,
    timeMult: 1.0,
    damage: 25,
    wind: 0.35,
    stabilization: 1.1,
    landingSpeedMax: 13,
    landingDescentMax: 4,
    landingAlignDeg: 18,
    fuelDrain: 1.0,
  },
  hard: {
    label: 'HARD',
    accel: 1.35,
    maxSpeed: 92,
    ringRadius: 8,
    timeMult: 0.75,
    damage: 50,
    wind: 1.0,
    stabilization: 0.35,
    landingSpeedMax: 10,
    landingDescentMax: 3,
    landingAlignDeg: 12,
    fuelDrain: 1.25,
  },
};

// Scoring: rings pay for precision, speed pays for pace, time pays for pace.
export const SCORE = {
  ringBase: 500,
  ringAccuracyMax: 250, // bonus for passing dead-centre
  speedBonusPerKmh: 1.2, // per km/h of top speed, capped below
  speedBonusCap: 300,
  timeBonusPerSecond: 8, // seconds left on the clock at completion
  landingBase: 800,
  landingAccuracyMax: 400,
};

export const FLIGHT = {
  minThrottle: 0,
  maxThrottle: 1,
  hoverThrottle: 0.42, // throttle that roughly holds altitude in level flight
  climbRate: 9, // m/s of vertical speed at full throttle above hover
  sinkRate: 7, // m/s of sink at zero throttle
  maxPitch: 0.5, // rad nose down/up
  maxRoll: 0.95, // rad of bank
  yawRate: 0.55, // rad/s from Q/E
  bankTurnRate: 0.6, // rad/s of heading change per rad of bank
  fuelCapacity: 100,
  fuelDrainBase: 0.12, // %/s at idle
  fuelDrainThrottle: 0.3, // %/s extra at full throttle
  hull: 100,
  crashDescent: 9, // m/s sink into terrain that counts as a crash on NORMAL+
  rotorSpinBase: 18, // rad/s at idle
  rotorSpinFull: 55, // rad/s at full throttle
};
