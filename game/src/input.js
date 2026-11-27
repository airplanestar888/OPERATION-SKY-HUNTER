// Operation: Sky Hunter — keyboard + mouse input.
// W/S pitch, A/D roll, Q/E yaw, Shift boost, Ctrl slow, Space stabilize,
// C camera, O orbit camera, R reset, Esc pause. Mouse steers while
// pointer-locked on the canvas (click the canvas to lock). In ORBIT mode
// the pointer is never locked: a plain drag orbits the camera around the
// drone and the wheel zooms. One-shot keys are consumed per frame.

export function createInput(canvas) {
  const keys = new Set();
  const pressed = new Set();
  let mouseDX = 0;
  let mouseDY = 0;
  let locked = false;
  // Orbit-camera input (mouse drag + wheel, no pointer lock).
  let orbitMode = false;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let orbitDX = 0;
  let orbitDY = 0;
  let orbitWheel = 0;

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    keys.add(e.code);
    pressed.add(e.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ControlLeft'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  canvas.addEventListener('click', () => {
    // Orbit mode never takes the pointer: the drag needs a free cursor.
    if (orbitMode) return;
    if (canvas.requestPointerLock) canvas.requestPointerLock();
  });
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas;
  });
  document.addEventListener('mousemove', (e) => {
    if (!locked) return;
    mouseDX += e.movementX;
    mouseDY += e.movementY;
  });
  // Orbit drag: mousedown + move on the canvas, tracked on the window so
  // the drag survives leaving the canvas. Only active in orbit mode.
  canvas.addEventListener('mousedown', (e) => {
    if (!orbitMode || e.button !== 0) return;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    orbitDX += e.clientX - lastX;
    orbitDY += e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
  });
  window.addEventListener('mouseup', () => {
    dragging = false;
  });
  // Orbit zoom: wheel over the canvas. Non-passive so the page never
  // scrolls under the game.
  canvas.addEventListener('wheel', (e) => {
    if (!orbitMode) return;
    e.preventDefault();
    orbitWheel += e.deltaY;
  }, { passive: false });

  return {
    get mouseLocked() { return locked; },
    // Orbit mode is owned by main.js (the camera mode lives there); the
    // input layer just needs to know so it can skip pointer lock and
    // collect drag/wheel deltas instead of steering trim.
    setOrbitMode(on) {
      orbitMode = !!on;
      if (orbitMode) {
        // A locked pointer has no cursor to drag with: release it so the
        // orbit drag works straight away.
        if (document.pointerLockElement) document.exitPointerLock();
        dragging = false;
        orbitDX = 0;
        orbitDY = 0;
        orbitWheel = 0;
      }
    },
    // Continuous axes, -1..1. Mouse adds a gentle trim while locked.
    axes() {
      let pitch = 0;
      let roll = 0;
      let yaw = 0;
      if (keys.has('KeyW') || keys.has('ArrowUp')) pitch += 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) pitch -= 1;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) roll -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) roll += 1;
      if (keys.has('KeyQ')) yaw -= 1;
      if (keys.has('KeyE')) yaw += 1;
      if (locked) {
        pitch += Math.max(-0.6, Math.min(0.6, -mouseDY * 0.004));
        yaw += Math.max(-0.6, Math.min(0.6, mouseDX * 0.0035));
        mouseDX = 0;
        mouseDY = 0;
      }
      return {
        pitch: Math.max(-1, Math.min(1, pitch)),
        roll: Math.max(-1, Math.min(1, roll)),
        yaw: Math.max(-1, Math.min(1, yaw)),
        throttleUp: keys.has('ShiftLeft') || keys.has('ShiftRight'),
        throttleDown: keys.has('ControlLeft') || keys.has('ControlRight'),
        stabilize: keys.has('Space'),
      };
    },
    // One-shot keys: true once per physical press.
    wasPressed(code) {
      return pressed.has(code);
    },
    // Orbit deltas since the last call (pixels dragged, wheel units).
    // Consumed once per frame by the camera; returns zeros when idle.
    consumeOrbit() {
      const out = { dx: orbitDX, dy: orbitDY, wheel: orbitWheel };
      orbitDX = 0;
      orbitDY = 0;
      orbitWheel = 0;
      return out;
    },
    endFrame() {
      pressed.clear();
    },
  };
}
