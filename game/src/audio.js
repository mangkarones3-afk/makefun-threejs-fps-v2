// audio.js — every sound is synthesised with WebAudio: noise bursts and
// shaped oscillators, no audio files. The context is created lazily on the
// first user gesture (the Play click), as browsers require. Distant gunfire
// is low-passed and quietened by distance so a firefight reads by ear.

let ctx = null; let master = null;
let noiseBuf = null; let lastShotAt = 0;

export function unlockAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume(); return;
  }
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  ctx = new AC(); master = ctx.createGain();
  master.gain.value = 0.45; master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
}

export function audioReady() {
  return !!ctx;
}

// A short noise burst through a filter: the building block of shots,
// impacts, footsteps and the explosion.
function burst({ at = 0, dur = 0.1, type = 'lowpass', freq = 1200, q = 0.8, gain = 0.5, sweepTo = null }) {
  if (!ctx) return; const t0 = ctx.currentTime + at;
  const src = ctx.createBufferSource(); src.buffer = noiseBuf;
  src.playbackRate.value = 0.9 + Math.random() * 0.2; const filter = ctx.createBiquadFilter();
  filter.type = type; filter.frequency.setValueAtTime(freq, t0);
  if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur); filter.Q.value = q;
  const g = ctx.createGain(); g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur); src.connect(filter).connect(g).connect(master);
  src.start(t0, Math.random() * 0.4); src.stop(t0 + dur + 0.05);
}

function tone({ at = 0, dur = 0.12, type = 'sine', from = 440, to = null, gain = 0.25 }) {
  if (!ctx) return; const t0 = ctx.currentTime + at;
  const osc = ctx.createOscillator(); osc.type = type;
  osc.frequency.setValueAtTime(from, t0); if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur); osc.connect(g).connect(master);
  osc.start(t0); osc.stop(t0 + dur + 0.05);
}

// Gunfire. kind picks the body of the shot; dist (metres from the listener)
// thins and darkens it. Near shots are never dropped; far ones are thinned
export function sfxShot(kind, dist = 0) {
  if (!ctx) return; const now = performance.now();
  if (dist > 6 && now - lastShotAt < 45) return; lastShotAt = now;
  const att = 1 / (1 + dist * 0.09); const dark = Math.max(500, 3800 - dist * 55);
  switch (kind) {
    case 'scatter':
      burst({ dur: 0.22, freq: dark, gain: 0.85 * att });
      tone({ dur: 0.16, type: 'triangle', from: 130, to: 45, gain: 0.5 * att });
      break;
    case 'farshot':
      burst({ dur: 0.3, freq: dark + 600, gain: 0.9 * att });
      tone({ dur: 0.24, type: 'triangle', from: 110, to: 38, gain: 0.55 * att });
      break;
    case 'needle':
      burst({ dur: 0.16, freq: dark + 300, gain: 0.7 * att });
      tone({ dur: 0.12, type: 'triangle', from: 150, to: 55, gain: 0.4 * att });
      break;
    case 'p9':
      burst({ dur: 0.09, freq: dark + 200, gain: 0.5 * att });
      tone({ dur: 0.07, type: 'triangle', from: 190, to: 80, gain: 0.28 * att });
      break;
    default: // raptor, meridian
      burst({ dur: 0.11, freq: dark, gain: 0.62 * att });
      tone({ dur: 0.09, type: 'triangle', from: 165, to: 60, gain: 0.35 * att });
  }
}

export function sfxDryFire() {
  tone({ dur: 0.05, type: 'square', from: 900, to: 500, gain: 0.12 });
}

export function sfxReload() {
  burst({ dur: 0.05, freq: 2400, type: 'bandpass', gain: 0.22 });
  burst({ at: 0.32, dur: 0.05, freq: 1800, type: 'bandpass', gain: 0.26 });
  burst({ at: 0.55, dur: 0.06, freq: 2800, type: 'bandpass', gain: 0.3 });
}

export function sfxDraw() {
  burst({ dur: 0.07, freq: 1500, type: 'bandpass', gain: 0.16 });
}

export function sfxHitmark(kill) {
  tone({ dur: 0.06, type: 'square', from: kill ? 1560 : 1250, gain: kill ? 0.3 : 0.2 });
  if (kill) tone({ at: 0.07, dur: 0.09, type: 'square', from: 1900, gain: 0.26 });
}

export function sfxHurt() {
  burst({ dur: 0.12, freq: 500, gain: 0.4 });
  tone({ dur: 0.1, type: 'sine', from: 120, to: 70, gain: 0.3 });
}

export function sfxStep(run) {
  burst({ dur: 0.05, freq: 700 + Math.random() * 250, gain: run ? 0.1 : 0.05 });
}

export function sfxThrow() {
  burst({ dur: 0.14, freq: 900, type: 'bandpass', sweepTo: 2400, gain: 0.12 });
}

export function sfxFrag() {
  burst({ dur: 0.7, freq: 2600, sweepTo: 120, gain: 1.0 });
  tone({ dur: 0.55, type: 'sine', from: 120, to: 30, gain: 0.8 });
}

export function sfxFlash() {
  burst({ dur: 0.25, freq: 5000, type: 'highpass', gain: 0.5 });
  tone({ dur: 1.1, type: 'sine', from: 4200, to: 3900, gain: 0.1 });
}

export function sfxSmoke() {
  burst({ dur: 0.5, freq: 1000, type: 'bandpass', sweepTo: 500, gain: 0.2 });
}

export function sfxBeep(final) {
  tone({ dur: final ? 0.3 : 0.09, type: 'square', from: final ? 1320 : 880, gain: 0.22 });
}

export function sfxExplosion() {
  burst({ dur: 1.4, freq: 3000, sweepTo: 60, gain: 1.0 });
  tone({ dur: 1.1, type: 'sine', from: 100, to: 24, gain: 0.9 });
  burst({ at: 0.05, dur: 0.4, freq: 800, gain: 0.5 });
}

export function sfxBuy(ok) {
  if (ok) {
    tone({ dur: 0.06, type: 'square', from: 1180, gain: 0.16 });
    tone({ at: 0.06, dur: 0.08, type: 'square', from: 1560, gain: 0.16 });
  } else {
    tone({ dur: 0.12, type: 'square', from: 220, to: 180, gain: 0.16 });
  }
}

export function sfxRoundEnd(won) {
  if (won) {
    tone({ dur: 0.14, type: 'triangle', from: 523, gain: 0.25 });
    tone({ at: 0.13, dur: 0.14, type: 'triangle', from: 659, gain: 0.25 });
    tone({ at: 0.26, dur: 0.3, type: 'triangle', from: 784, gain: 0.28 });
  } else {
    tone({ dur: 0.16, type: 'triangle', from: 392, gain: 0.25 });
    tone({ at: 0.15, dur: 0.16, type: 'triangle', from: 330, gain: 0.25 });
    tone({ at: 0.3, dur: 0.34, type: 'triangle', from: 262, gain: 0.28 });
  }
}

export function sfxPlantStart() {
  tone({ dur: 0.08, type: 'square', from: 740, gain: 0.18 });
  tone({ at: 0.1, dur: 0.08, type: 'square', from: 740, gain: 0.18 });
}
