// Operation: Sky Hunter — deterministic screenshot mode.
// ?shot=cover|flight|gauntlet|runway drops the drone into a staged,
// good-looking moment with the autopilot flying, the HUD live and the
// menus hidden, so a headless browser can capture a real render.
//   cover    — mission 1, chase view, drone mid-flight, ring ahead
//   flight   — mission 2, low in the river valley between cliffs
//   gauntlet — mission 3, ring chain ahead over open terrain
//   runway   — mission 5, final approach to runway 09/27
//
// Framing: the drone is the hero of every shot, so the chase camera
// runs much closer than in normal play (camDist ~8.5 m instead of 14 m)
// and looks further ahead (camLead ~30 m) so the ring / runway stays in
// frame above the aircraft. These parameters are read ONLY while a shot
// is active — normal gameplay always uses the standard chase camera.

export function getShotSetup() {
  const params = new URLSearchParams(window.location.search);
  const shot = params.get('shot');
  if (!shot) return null;
  const setups = {
    cover: { missionIndex: 0, throttle: 0.55, headStart: 200, camDist: 8.5, camHeight: 3.2, camLead: 30 },
    flight: { missionIndex: 1, throttle: 0.6, headStart: 220, camDist: 8.5, camHeight: 3.0, camLead: 30 },
    gauntlet: { missionIndex: 2, throttle: 0.62, headStart: 130, camDist: 8.5, camHeight: 3.2, camLead: 36 },
    runway: { missionIndex: 4, throttle: 0.5, headStart: 300, camDist: 9.0, camHeight: 3.0, camLead: 34 },
  };
  const setup = setups[shot] || setups.cover;
  return { ...setup, shot, autoFly: true, hideMenu: true };
}
