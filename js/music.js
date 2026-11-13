// Soft background music for the guided tour, made in the browser (Web Audio): no sound files. A slow pad moves through
// four chords while single notes of the same scale fall like a quiet piano, with an echo. start() / stop() fade in and out.

const CHORDS = [[220.0, 261.63, 329.63, 392.0], [174.61, 220.0, 261.63, 349.23], [130.81, 196.0, 261.63, 329.63], [196.0, 246.94, 293.66, 392.0]];   // Am7, Fmaj7, Cmaj7, G
const SCALE = [440, 493.88, 523.25, 587.33, 659.25, 783.99, 880];                                  // A minor pentatonic-ish, an octave above the pad
const BAR = 6.5;

export function createMusic() {
  let ctx = null, master = null, timer = null, bar = 0, on = false, muted = false, voices = [];
  const level = () => (muted ? 0 : 0.16);
  function build() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
    const delay = ctx.createDelay(1.5), fb = ctx.createGain(), wet = ctx.createGain();
    delay.delayTime.value = 0.42; fb.gain.value = 0.38; wet.gain.value = 0.3;
    master.connect(lp); lp.connect(ctx.destination);
    master.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(ctx.destination);
  }
  function tone(freq, t0, dur, peak, type, attack, detune = 0) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq; o.detune.value = detune;
    g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(peak, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.05);
    voices.push(o); o.onended = () => { voices = voices.filter((v) => v !== o); };
  }
  function schedule() {
    const t0 = ctx.currentTime + 0.05, ch = CHORDS[bar % CHORDS.length];
    for (const f of ch) { tone(f, t0, BAR * 1.25, 0.11, 'sine', 2.2); tone(f, t0, BAR * 1.25, 0.035, 'triangle', 2.6, 7); }
    tone(ch[0] / 2, t0, BAR * 1.2, 0.12, 'sine', 1.5);
    const n = 3 + (bar % 2);                                        // a few single notes over the chord, never on a fixed beat
    for (let i = 0; i < n; i++) { const f = SCALE[(bar * 3 + i * 2 + (i * i) % 3) % SCALE.length]; tone(f, t0 + 0.6 + i * (BAR - 1.4) / n + ((bar + i) % 3) * 0.17, 2.6, 0.075, 'sine', 0.012); }
    bar++;
  }
  return {
    /** Start (or carry on) playing. Must be called from a click: browsers only let sound begin on a gesture. */
    start() {
      try {
        if (!ctx) build();
        ctx.resume();
        if (on) return;
        on = true; bar = 0;
        master.gain.cancelScheduledValues(ctx.currentTime); master.gain.linearRampToValueAtTime(level(), ctx.currentTime + 2.5);
        schedule(); timer = setInterval(schedule, BAR * 1000);
      } catch { /* no sound on this device: the tour runs without it */ }
    },
    stop() {
      if (!ctx || !on) return;
      on = false; clearInterval(timer);
      master.gain.cancelScheduledValues(ctx.currentTime); master.gain.setValueAtTime(master.gain.value, ctx.currentTime); master.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.2);
      const old = voices.slice(); setTimeout(() => old.forEach((o) => { try { o.stop(); } catch { /* already ended */ } }), 1400);
    },
    setMuted(m) { muted = m; if (ctx && on) { master.gain.cancelScheduledValues(ctx.currentTime); master.gain.linearRampToValueAtTime(level(), ctx.currentTime + 0.4); } },
    get muted() { return muted; }, get playing() { return on; },
    dispose() { clearInterval(timer); if (ctx) ctx.close().catch(() => {}); ctx = null; on = false; },
  };
}
