// Operation: Sky Hunter — keyboard + mouse input.
// W/S pitch, A/D roll, Q/E yaw, Shift boost, Ctrl slow, Space stabilize,
// C camera, R reset, Esc pause. Mouse steers while pointer-locked on the
// canvas (click the canvas to lock). One-shot keys are consumed per frame.

export function createInput(canvas) {
  const keys = new Set();
  const pressed = new Set();
  let mouseDX = 0;
  let mouseDY = 0;
  let locked = false;

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    keys.add(e.code);
    pressed.add(e.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ControlLeft'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  canvas.addEventListener('click', () => {
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

  return {
    get mouseLocked() { return locked; },
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
    endFrame() {
      pressed.clear();
    },
  };
}
