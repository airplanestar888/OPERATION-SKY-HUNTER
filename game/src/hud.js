// Operation: Sky Hunter — military flight HUD.
// A DOM + canvas overlay. Every number is read from the live flight state
// each frame: altitude, speed, vertical speed, throttle, fuel, hull,
// heading, the compass, the mini radar and the next-ring guidance.

export function createHUD() {
  const $ = (id) => document.getElementById(id);
  const els = {
    missionName: $('hud-mission'),
    objective: $('hud-objective'),
    status: $('hud-status'),
    compass: $('hud-compass'),
    alt: $('hud-alt'),
    spd: $('hud-spd'),
    vs: $('hud-vs'),
    thr: $('hud-thr'),
    fuel: $('hud-fuel'),
    fuelBar: $('hud-fuel-bar'),
    hull: $('hud-hull'),
    hullBar: $('hud-hull-bar'),
    radar: $('hud-radar'),
    targetDist: $('hud-target-dist'),
    targetName: $('hud-target-name'),
    warn: $('hud-warn'),
    reticle: $('hud-reticle'),
    ringArrow: $('hud-ring-arrow'),
    ringDist: $('hud-ring-dist'),
    timer: $('hud-timer'),
    score: $('hud-score'),
  };
  const compassCtx = els.compass.getContext('2d');
  const radarCtx = els.radar.getContext('2d');

  function drawCompass(headingDeg) {
    const c = compassCtx;
    const W = els.compass.width;
    const H = els.compass.height;
    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(3, 16, 12, 0.55)';
    c.fillRect(0, 0, W, H);
    c.strokeStyle = 'rgba(90, 255, 200, 0.5)';
    c.lineWidth = 1;
    c.strokeRect(0.5, 0.5, W - 1, H - 1);
    const center = W / 2;
    const pxPerDeg = 3.2;
    c.font = 'bold 13px "Courier New", monospace';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    // Ticks from -60 to +60 degrees around the current heading.
    for (let d = -60; d <= 60; d += 5) {
      const h = (Math.round(headingDeg) + d + 360) % 360;
      const x = center + d * pxPerDeg;
      const major = h % 30 === 0;
      const cardinal = h % 90 === 0;
      c.strokeStyle = cardinal ? '#5affc8' : 'rgba(120, 255, 210, 0.65)';
      c.beginPath();
      c.moveTo(x, major ? 6 : 12);
      c.lineTo(x, major ? 20 : 16);
      c.stroke();
      if (major) {
        const label = h === 0 ? 'N' : h === 90 ? 'E' : h === 180 ? 'S' : h === 270 ? 'W' : String(h).padStart(3, '0');
        c.fillStyle = cardinal ? '#5affc8' : '#b8ffe4';
        c.fillText(label, x, 30);
      }
    }
    // Centre caret + digital readout.
    c.fillStyle = '#5affc8';
    c.beginPath();
    c.moveTo(center - 7, 2);
    c.lineTo(center + 7, 2);
    c.lineTo(center, 10);
    c.fill();
    c.font = 'bold 15px "Courier New", monospace';
    c.fillText(String(Math.round(headingDeg)).padStart(3, '0') + '°', center, H - 8);
  }

  function drawRadar(flight, nextRing, runway) {
    const c = radarCtx;
    const S = els.radar.width;
    const C = S / 2;
    c.clearRect(0, 0, S, S);
    c.fillStyle = 'rgba(3, 18, 12, 0.6)';
    c.beginPath();
    c.arc(C, C, C - 2, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = 'rgba(90, 255, 200, 0.6)';
    c.lineWidth = 1;
    c.beginPath();
    c.arc(C, C, C - 2, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.arc(C, C, (C - 2) * 0.5, 0, Math.PI * 2);
    c.stroke();
    // Range rings + sweep line.
    const sweep = (performance.now() / 1400) % (Math.PI * 2);
    c.strokeStyle = 'rgba(90, 255, 200, 0.25)';
    c.beginPath();
    c.moveTo(C, C);
    c.lineTo(C + Math.cos(sweep) * (C - 2), C + Math.sin(sweep) * (C - 2));
    c.stroke();
    // North-up: world -Z is up on the radar.
    const scale = (C - 8) / 900; // 900 m to the edge
    const plot = (x, z, color, r) => {
      const rx = C + (x - flight.pos.x) * scale;
      const ry = C + (z - flight.pos.z) * scale;
      if (Math.hypot(rx - C, ry - C) > C - 4) return;
      c.fillStyle = color;
      c.beginPath();
      c.arc(rx, ry, r, 0, Math.PI * 2);
      c.fill();
    };
    if (runway) {
      // Runway as a short line, east-west.
      c.strokeStyle = '#e8e8e8';
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(C + (runway.x - 200 - flight.pos.x) * scale, C + (runway.z - flight.pos.z) * scale);
      c.lineTo(C + (runway.x + 200 - flight.pos.x) * scale, C + (runway.z - flight.pos.z) * scale);
      c.stroke();
    }
    if (nextRing) plot(nextRing.center.x, nextRing.center.z, '#2affc8', 5);
    // Ownship triangle, rotated by heading (0 = north = up).
    const h = (flight.heading * 180) / Math.PI;
    const a = (h * Math.PI) / 180;
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.moveTo(C + Math.sin(a) * 8, C - Math.cos(a) * 8);
    c.lineTo(C + Math.sin(a + 2.5) * 6, C - Math.cos(a + 2.5) * 6);
    c.lineTo(C + Math.sin(a - 2.5) * 6, C - Math.cos(a - 2.5) * 6);
    c.closePath();
    c.fill();
  }

  let lastWarn = '';
  return {
    setMission(mission, difficultyLabel) {
      els.missionName.textContent = `MISSION 0${mission.id} — ${mission.name}`;
      els.objective.textContent = mission.briefing;
      els.status.textContent = `DIFFICULTY ${difficultyLabel}  •  FUEL 100%  •  HULL 100%`;
    },
    update(readout, flight, mission, nextRing, timeLeft, score, camera, world) {
      drawCompass(readout.headingDeg);
      els.alt.textContent = `ALT ${String(Math.round(readout.altAgl)).padStart(4, '0')} m`;
      els.spd.textContent = `SPD ${String(Math.round(readout.speedKmh)).padStart(3, '0')} km/h`;
      const vsSign = readout.vs >= 0 ? '+' : '−';
      els.vs.textContent = `V/S ${vsSign}${Math.abs(readout.vs).toFixed(1)} m/s`;
      els.thr.textContent = `THR ${String(readout.throttlePct).padStart(3, '0')}%`;
      els.fuel.textContent = `FUEL ${Math.round(readout.fuel)}%`;
      els.fuelBar.style.width = `${readout.fuel}%`;
      els.fuelBar.style.background = readout.fuel < 25 ? '#ff5040' : '#37e08a';
      els.hull.textContent = `HULL ${Math.round(readout.hull)}%`;
      els.hullBar.style.width = `${readout.hull}%`;
      els.hullBar.style.background = readout.hull < 35 ? '#ff5040' : '#37c8e0';
      const mm = Math.floor(Math.max(0, timeLeft) / 60);
      const ss = Math.floor(Math.max(0, timeLeft) % 60);
      els.timer.textContent = `T-${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
      els.timer.style.color = timeLeft < 30 ? '#ff5040' : '#5affc8';
      els.score.textContent = `SCORE ${String(score).padStart(6, '0')}`;

      // Warnings, by priority.
      let warn = '';
      if (flight.crashed) warn = '◆ DRONE DOWN ◆';
      else if (readout.fuel <= 0) warn = '◆ FUEL EMPTY ◆';
      else if (readout.fuel < 25) warn = '◆ LOW FUEL — RTB ◆';
      else if (readout.hull < 35) warn = '◆ HULL CRITICAL ◆';
      else if (readout.altAgl < 15 && readout.vs < -4) warn = '◆ PULL UP ◆';
      else if (readout.altAgl < 8) warn = '◆ TERRAIN ◆';
      if (warn !== lastWarn) {
        els.warn.textContent = warn;
        els.warn.style.visibility = warn ? 'visible' : 'hidden';
        lastWarn = warn;
      }

      // Next-ring guidance: name, distance, and a screen-space arrow.
      if (nextRing) {
        const d = Math.round(flight.pos.distanceTo(nextRing.center));
        els.targetName.textContent = `NEXT: RING ${nextRing.index + 1}`;
        els.targetDist.textContent = `${d} m`;
        // Project the ring centre to screen space for the centre marker.
        const v = nextRing.center.clone().project(camera);
        const onScreen = v.z < 1 && Math.abs(v.x) < 1.15 && Math.abs(v.y) < 1.15;
        if (onScreen) {
          const x = (v.x * 0.5 + 0.5) * window.innerWidth;
          const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
          els.ringArrow.style.left = `${x}px`;
          els.ringArrow.style.top = `${y}px`;
          els.ringArrow.textContent = '◎';
          els.ringArrow.style.color = '#4df0c8';
          els.ringArrow.style.transform = 'translate(-50%, -50%)';
          els.ringDist.textContent = `${d} m`;
          els.ringDist.style.left = `${x}px`;
          els.ringDist.style.top = `${y + 26}px`;
          els.ringDist.style.transform = 'translate(-50%, -50%)';
        } else {
          // Off-screen: point at the screen edge in the ring's direction.
          const ang = Math.atan2(v.y, v.x);
          const ex = window.innerWidth / 2 + Math.cos(ang) * (window.innerWidth * 0.42);
          const ey = window.innerHeight / 2 - Math.sin(ang) * (window.innerHeight * 0.38);
          els.ringArrow.style.left = `${ex}px`;
          els.ringArrow.style.top = `${ey}px`;
          els.ringArrow.textContent = '➤';
          els.ringArrow.style.color = '#ffb020';
          els.ringArrow.style.transform = `translate(-50%, -50%) rotate(${-ang}rad)`;
          els.ringDist.textContent = `${d} m`;
          els.ringDist.style.left = `${ex}px`;
          els.ringDist.style.top = `${ey + 24}px`;
          els.ringDist.style.transform = 'translate(-50%, -50%)';
        }
        els.ringArrow.style.visibility = 'visible';
        els.ringDist.style.visibility = 'visible';
      } else {
        els.targetName.textContent = mission && mission.runway ? 'NEXT: LAND ON RUNWAY 09/27' : 'ALL RINGS CLEAR';
        els.targetDist.textContent = '';
        els.ringArrow.style.visibility = 'hidden';
        els.ringDist.style.visibility = 'hidden';
      }

      drawRadar(flight, nextRing, mission && mission.runway ? { x: 0, z: 1200 } : null);
    },
  };
}
