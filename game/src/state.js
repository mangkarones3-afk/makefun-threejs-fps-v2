// state.js — the one place match state lives. Every other module reads and
// writes through G; nothing keeps a second copy of scores, money or timers.
// Rendering handles (scene, camera) are attached by main.js after boot.

import { TIMING } from './config.js';

export const G = {
  phase: 'menu', // menu | buy | live | end | matchend
  paused: false,
  time: 0, // total simulated seconds
  phaseTime: 0, // seconds left in the timed phase
  round: 0,
  scores: { atk: 0, def: 0 },
  lossStreak: { atk: 0, def: 0 },
  targetSite: 'A', // site the attackers push this round
  actors: [],
  player: null,
  charge: null, // filled by resetCharge()
  grenades: [], // live grenade entities
  smokes: [], // smoke clouds { x, z, r, until }
  noises: [], // recent gunfire { x, z, team, at, radius }
  feed: [], // killfeed entries { text, at }
  winner: null, // team id that won the current round
  winHow: '', // elimination | detonation | defuse | timeout
  matchWinner: null,
  interactor: null, // actor planting or defusing now
  interactKind: '', // 'plant' | 'defuse'
  interactT: 0, // channel progress in seconds
  shot: null, // staging request { mode, seed } or null
  shake: 0, // camera shake, decays in player.js
  hitStop: 0, // frozen-sim seconds left (kill feedback)
  lastKill: null, // latest player kill { name, part, at }
  flashTime: 0, // flashbang blindness seconds left
  events: [], // gameplay events for rounds.js { type, ... }
  scene: null,
  camera: null,
  map: null,
};

export function resetCharge() {
  G.charge = {
    state: 'carried', // carried | dropped | planted | done
    carrier: null,
    x: 0, z: 0, // ground position when dropped/planted
    site: null,
    timer: TIMING.chargeTimer,
  };
  G.interactor = null; G.interactKind = '';
  G.interactT = 0;
}

export function aliveCount(team) {
  let n = 0; for (const a of G.actors) if (a.team === team && a.alive) n++;
  return n;
}

// A gunshot others can hear: bots investigate noises from the other team.
export function makeNoise(x, z, team, radius = 26) {
  G.noises.push({ x, z, team, at: G.time, radius });
  if (G.noises.length > 24) G.noises.shift();
}
