// state.js — the one place the match's shared state lives. Every
// module reads and writes through G, so a round can be reasoned about
// (and a headless test can drive it) without chasing module variables.

export const G = {
  scene: null, camera: null, map: null, actors: [], player: null,
  phase: 'menu', // menu | buy | live | end | matchend
  phaseTime: 0, time: 0, round: 0,
  // Round-timing mirrors of config's TIMING, read all over the sim.
  buyPhase: 12, roundLive: 100, chargeTimer: 40, plantTime: 3.5,
  defuseTime: 5, roundEnd: 5, firstTo: 8,
  scores: { atk: 0, def: 0 }, lossStreak: { atk: 0, def: 0 },
  winner: null, winHow: '', matchWinner: null, targetSite: 'A',
  charge: null, // { state, carrier, x, z, site, timer }
  interactor: null, interactKind: '', interactT: 0,
  grenades: [], smokes: [], noises: [], events: [], feed: [],
  // Presentation beats, written by weapons/feedback, read by player/hud.
  shake: 0, hitStop: 0, hitMarkAt: -9, killMarkAt: -9, lastKill: null,
  flashTime: 0, damageFlash: 0,
  paused: false, shot: null,
};

export function resetCharge() {
  G.charge = { state: 'carried', carrier: null, x: 0, z: 0, site: null, timer: 0 };
}

export function aliveCount(team) {
  let n = 0;
  for (const a of G.actors) if (a.team === team && a.alive) n++;
  return n;
}

// A gunshot the bots can hear. Entries age out after a few seconds.
export function makeNoise(x, z, team, radius = 26) {
  G.noises.push({ x, z, team, radius, at: G.time });
  if (G.noises.length > 24) G.noises.shift();
}
