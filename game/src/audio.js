// audio.js — all sound, synthesised with WebAudio; no audio files.

let ctx = null;
let master = null;
let noiseBuf = null;
let lastShotAt = 0;

export function unlockAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  const AC = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = .45;
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
}

export function audioReady() {
  return !!ctx;
}

// A short noise burst through a filter: the building block of shots,
// impacts, footsteps and the explosion.
function burst({ at = 0, dur = .1, type = 'lowpass', freq = 1200, q = .8, gain = .5, sweepTo = null }) {
  if (!ctx) return;
  const t0 = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = .9 + Math.random() * .2;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(freq, t0);
  if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
  filter.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(.001, t0 + dur);
  src.connect(filter).connect(g).connect(master);
  src.start(t0, Math.random() * .4);
  src.stop(t0 + dur + .05);
}

function tone({ at = 0, dur = .12, type = 'sine', from = 440, to = null, gain = .25 }) {
  if (!ctx) return;
  const t0 = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(.001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + .05);
}

// Gunfire, per kind: [burst seconds, burst freq offset, burst gain,
// tone seconds, tone from, tone to, tone gain]. dist (metres from the
// listener) thins and darkens the shot; near shots are never dropped,
// far ones are thinned so a busy round stays intelligible.
const SHOT_VOICES = {
  scatter: [.22, 0, .85, .16, 130, 45, .5],
  farshot: [.3, 600, .9, .24, 110, 38, .55],
  needle: [.16, 300, .7, .12, 150, 55, .4],
  p9: [.09, 200, .5, .07, 190, 80, .28],
};
const SHOT_DEFAULT = [.11, 0, .62, .09, 165, 60, .35]; // raptor, meridian

export function sfxShot(kind, dist = 0) {
  if (!ctx) return;
  const now = performance.now();
  if (dist > 6 && now - lastShotAt < 45) return;
  lastShotAt = now;
  const att = 1 / (1 + dist * .09);
  const dark = Math.max(500, 3800 - dist * 55);
  const v = SHOT_VOICES[kind] ?? SHOT_DEFAULT;
  burst({ dur: v[0], freq: dark + v[1], gain: v[2] * att });
  tone({ dur: v[3], type: 'triangle', from: v[4], to: v[5], gain: v[6] * att });
}

export function sfxDryFire() {
  tone({ dur: .05, type: 'square', from: 900, to: 500, gain: .12 });
}

export function sfxReload() {
  burst({ dur: .05, freq: 2400, type: 'bandpass', gain: .22 });
  burst({ at: .32, dur: .05, freq: 1800, type: 'bandpass', gain: .26 });
  burst({ at: .55, dur: .06, freq: 2800, type: 'bandpass', gain: .3 });
}

export function sfxDraw() {
  burst({ dur: .07, freq: 1500, type: 'bandpass', gain: .16 });
}

export function sfxHitmark(kill) {
  tone({ dur: .06, type: 'square', from: kill ? 1560 : 1250, gain: kill ? .3 : .2 });
  if (kill) tone({ at: .07, dur: .09, type: 'square', from: 1900, gain: .26 });
}

export function sfxHurt() {
  burst({ dur: .12, freq: 500, gain: .4 });
  tone({ dur: .1, type: 'sine', from: 120, to: 70, gain: .3 });
}

export function sfxStep(run) {
  burst({ dur: .05, freq: 700 + Math.random() * 250, gain: run ? .1 : .05 });
}

export function sfxThrow() {
  burst({ dur: .14, freq: 900, type: 'bandpass', sweepTo: 2400, gain: .12 });
}

export function sfxFrag() {
  burst({ dur: .7, freq: 2600, sweepTo: 120, gain: 1.0 });
  tone({ dur: .55, type: 'sine', from: 120, to: 30, gain: .8 });
}

export function sfxFlash() {
  burst({ dur: .25, freq: 5000, type: 'highpass', gain: .5 });
  tone({ dur: 1.1, type: 'sine', from: 4200, to: 3900, gain: .1 });
}

export function sfxSmoke() {
  burst({ dur: .5, freq: 1000, type: 'bandpass', sweepTo: 500, gain: .2 });
}

export function sfxBeep(final) {
  tone({ dur: final ? .3 : .09, type: 'square', from: final ? 1320 : 880, gain: .22 });
}

export function sfxExplosion() {
  burst({ dur: 1.4, freq: 3000, sweepTo: 60, gain: 1.0 });
  tone({ dur: 1.1, type: 'sine', from: 100, to: 24, gain: .9 });
  burst({ at: .05, dur: .4, freq: 800, gain: .5 });
}

export function sfxBuy(ok) {
  if (ok) {
    tone({ dur: .06, type: 'square', from: 1180, gain: .16 });
    tone({ at: .06, dur: .08, type: 'square', from: 1560, gain: .16 });
  } else {
    tone({ dur: .12, type: 'square', from: 220, to: 180, gain: .16 });
  }
}

export function sfxRoundEnd(won) {
  if (won) {
    tone({ dur: .14, type: 'triangle', from: 523, gain: .25 });
    tone({ at: .13, dur: .14, type: 'triangle', from: 659, gain: .25 });
    tone({ at: .26, dur: .3, type: 'triangle', from: 784, gain: .28 });
  } else {
    tone({ dur: .16, type: 'triangle', from: 392, gain: .25 });
    tone({ at: .15, dur: .16, type: 'triangle', from: 330, gain: .25 });
    tone({ at: .3, dur: .34, type: 'triangle', from: 262, gain: .28 });
  }
}

export function sfxPlantStart() {
  tone({ dur: .08, type: 'square', from: 740, gain: .18 });
  tone({ at: .1, dur: .08, type: 'square', from: 740, gain: .18 });
}
