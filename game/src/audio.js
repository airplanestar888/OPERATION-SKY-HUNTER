// Operation: Sky Hunter — procedural audio.
// Everything is synthesized with WebAudio: no sound files, no network.
// Motor pitch follows the throttle, wind follows airspeed, and the UI
// events (ring chime, warning, mission complete) are short synth phrases.

export function createAudio() {
  let ctx = null;
  let master = null;
  let motorOsc1 = null;
  let motorOsc2 = null;
  let motorGain = null;
  let motorFilter = null;
  let windSrc = null;
  let windGain = null;
  let windFilter = null;
  let propOsc = null;
  let propGain = null;
  let muted = false;
  let volume = 0.7;

  function makeNoiseBuffer() {
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function init() {
    if (ctx) {
      if (ctx.state === 'suspended') void ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);

    // Motor: two detuned saws through a lowpass — the drone's growl.
    motorOsc1 = ctx.createOscillator();
    motorOsc1.type = 'sawtooth';
    motorOsc1.frequency.value = 52;
    motorOsc2 = ctx.createOscillator();
    motorOsc2.type = 'sawtooth';
    motorOsc2.frequency.value = 78;
    motorFilter = ctx.createBiquadFilter();
    motorFilter.type = 'lowpass';
    motorFilter.frequency.value = 420;
    motorGain = ctx.createGain();
    motorGain.gain.value = 0;
    motorOsc1.connect(motorFilter);
    motorOsc2.connect(motorFilter);
    motorFilter.connect(motorGain);
    motorGain.connect(master);
    motorOsc1.start();
    motorOsc2.start();

    // Propeller whine: a quiet sine that climbs with throttle.
    propOsc = ctx.createOscillator();
    propOsc.type = 'sine';
    propOsc.frequency.value = 220;
    propGain = ctx.createGain();
    propGain.gain.value = 0;
    propOsc.connect(propGain);
    propGain.connect(master);
    propOsc.start();

    // Wind: looped noise through a bandpass, gain follows airspeed.
    windSrc = ctx.createBufferSource();
    windSrc.buffer = makeNoiseBuffer();
    windSrc.loop = true;
    windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 620;
    windFilter.Q.value = 0.6;
    windGain = ctx.createGain();
    windGain.gain.value = 0;
    windSrc.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(master);
    windSrc.start();
  }

  function blip(freq, dur, type, gainVal, when = 0) {
    if (!ctx || muted) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gainVal, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  return {
    init,
    get ready() { return !!ctx; },
    setVolume(v) {
      volume = Math.max(0, Math.min(1, v));
      if (master) master.gain.value = muted ? 0 : volume;
    },
    setMuted(m) {
      muted = m;
      if (master) master.gain.value = muted ? 0 : volume;
    },
    // Called every frame while flying: motor + wind follow the flight.
    update(throttle, speedKmh, dt) {
      if (!ctx || muted) return;
      const t = ctx.currentTime;
      const f = 46 + throttle * 64;
      motorOsc1.frequency.setTargetAtTime(f, t, 0.08);
      motorOsc2.frequency.setTargetAtTime(f * 1.5 + 2, t, 0.08);
      motorFilter.frequency.setTargetAtTime(380 + throttle * 900, t, 0.1);
      motorGain.gain.setTargetAtTime(0.05 + throttle * 0.085, t, 0.1);
      propOsc.frequency.setTargetAtTime(190 + throttle * 320, t, 0.08);
      propGain.gain.setTargetAtTime(0.012 + throttle * 0.02, t, 0.1);
      windGain.gain.setTargetAtTime(Math.min(0.16, (speedKmh / 320) * 0.16), t, 0.15);
      windFilter.frequency.setTargetAtTime(420 + speedKmh * 4, t, 0.15);
      void dt;
    },
    ring() {
      // Two-note confirmation chime.
      blip(880, 0.16, 'sine', 0.22);
      blip(1318, 0.28, 'sine', 0.2, 0.09);
    },
    warning() {
      blip(440, 0.14, 'square', 0.08);
      blip(440, 0.14, 'square', 0.08, 0.18);
    },
    complete() {
      // Short mission-complete phrase.
      [523, 659, 784, 1046].forEach((f, i) => blip(f, 0.32, 'triangle', 0.2, i * 0.12));
    },
    crash() {
      if (!ctx || muted) return;
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(160, t);
      o.frequency.exponentialRampToValueAtTime(28, t + 0.7);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.3, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
      o.connect(g);
      g.connect(master);
      o.start(t);
      o.stop(t + 0.85);
    },
    click() {
      blip(1200, 0.05, 'sine', 0.12);
    },
  };
}
