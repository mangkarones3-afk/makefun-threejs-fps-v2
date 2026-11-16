// feedback.js — the game's feel, in one place: trauma-based camera
// shake, tiered event feedback and overlap-safe hit-stop.
//
// The rules: shake comes from trauma, never from an event directly —
// events add trauma, the camera offset is trauma^2 times a summed-sine
// wobble (incommensurate rates 1.7, 2.3, 1.1; phase advancing 30/s),
// applied to the camera only, snapping to exactly zero at rest. Trauma
// decays at 1.2/s in REAL time, so it keeps draining while hit-stop
// freezes the sim. Hit-stop slows the world to 5%; every request
// carries a monotonically increasing id and only the newest request
// may set the restore point, so overlapping stops never restore early
// or stack; no stop exceeds .15 s. The red damage flash is capped at
// 3 full flashes per second (WCAG 2.3.1); hits past the cap show dimmer.

import { G } from './state.js';
import { spawnBurst } from './effects.js';

// Per-tier bundles: trauma added, hit-stop seconds, burst particles.
export const TIERS = {
  small: { trauma: .15, hitStop: 0, particles: 4 },
  medium: { trauma: .42, hitStop: .05, particles: 10 },
  large: { trauma: .85, hitStop: .12, particles: 28 },
};

const TRAUMA_DECAY = 1.2;   // per real second
const MAX_OFFSET = .085;   // metres of camera offset at trauma 1
const MAX_ROLL = .03;      // radians of camera roll at trauma 1
const FLASH_WINDOW = 1.0;   // seconds
const FLASH_MAX = 3;        // full flashes allowed inside the window

let trauma = 0;
let shakePhase = 0;
let stopId = 0;
let stopUntil = -1;   // real-clock seconds; the newest request owns this
let clock = 0;        // accumulated real time, seconds
let damageFlash = 0;
const flashStamps = []; // sim-time stamps of recent full flashes

// The current frame's camera offset, written by updateFeedback and
// read by player.js: metres on x/y and radians of roll, camera-only.
export const shakeOffset = { x: 0, y: 0, roll: 0 };

export function addTrauma(amount) {
  trauma = Math.min(1, trauma + amount);
}

export function requestHitStop(seconds) {
  stopId++;
  const until = clock + Math.min(seconds, .15);
  if (until > stopUntil) stopUntil = until; // newest and longest wins
}

// One entry point for every "something happened" beat in the game.
// tier picks the bundle; (x, y, z) is where it happened, for the burst.
export function feedback(tier, x, y, z) {
  const t = TIERS[tier] ?? TIERS.small;
  addTrauma(t.trauma);
  if (t.hitStop > 0) requestHitStop(t.hitStop);
  if (t.particles > 0) spawnBurst(x, y, z, t.particles, tier);
}

// The player took damage: shake a little and ask for a red flash,
// subject to the 3-per-second cap. amount is 0..1 of a full flash.
export function playerHurtFlash(amount) {
  addTrauma(.18 + amount * .2);
  while (flashStamps.length && G.time - flashStamps[0] > FLASH_WINDOW) flashStamps.shift();
  if (flashStamps.length < FLASH_MAX) {
    flashStamps.push(G.time);
    damageFlash = Math.min(1, damageFlash + amount);
  } else {
    // Past the cap the hit still shows, at a third of the strength.
    damageFlash = Math.min(.35, damageFlash + amount * .3);
  }
}

// Advance the feel systems by a REAL (unscaled) frame delta. Returns
// the simulation time scale: .05 while a hit-stop is live, else 1.
export function updateFeedback(rdt) {
  clock += rdt;
  trauma = Math.max(0, trauma - TRAUMA_DECAY * rdt);
  if (trauma <= 0) {
    shakeOffset.x = 0; shakeOffset.y = 0; shakeOffset.roll = 0;
  } else {
    shakePhase += rdt * 30;
    const mag = trauma * trauma;
    shakeOffset.x = mag * MAX_OFFSET * (Math.sin(shakePhase * 1.7) * .62 + Math.sin(shakePhase * 2.3) * .38);
    shakeOffset.y = mag * MAX_OFFSET * .8 * (Math.sin(shakePhase * 2.3 + 1.3) * .55 + Math.sin(shakePhase * 1.7 + 4.1) * .45);
    shakeOffset.roll = mag * MAX_ROLL * Math.sin(shakePhase * 1.1);
  }
  G.shake = trauma * trauma;
  G.hitStop = Math.max(0, stopUntil - clock);
  damageFlash = Math.max(0, damageFlash - rdt * 1.7);
  G.damageFlash = damageFlash;
  return clock < stopUntil ? .05 : 1;
}

export function resetFeedback() {
  trauma = 0;
  stopUntil = -1;
  damageFlash = 0;
  flashStamps.length = 0;
  shakeOffset.x = 0; shakeOffset.y = 0; shakeOffset.roll = 0;
  G.shake = 0; G.hitStop = 0; G.damageFlash = 0;
}
