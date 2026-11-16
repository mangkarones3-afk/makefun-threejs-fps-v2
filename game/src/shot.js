// shot.js — screenshot staging: ?shot=<mode>&seed=<n> poses a
// deterministic scene per mode (start, play, buy, end).

import { G, makeNoise } from './state.js';
import { startMatch, radio } from './rounds.js';
import { TIMING } from './config.js';
import { spawnSmokeVisual } from './effects.js';
import { mulberry32 } from './textures.js';

export function parseShot() {
  const q = new URLSearchParams(location.search);
  const mode = q.get('shot');
  if (!mode) return null;
  return { mode, seed: Number(q.get('seed') ?? 1) || 1 };
}

export function stageShot(shot, player, camera) {
  const rng = mulberry32(shot.seed * 7919);
  G.shot = shot;
  if (shot.mode === 'start') {
    // Menu over the yard: a low camera in the south-east corner looking
    // across mid toward the tank farm, lit at the far side.
    startMatch();
    G.phase = 'menu';
    camera.position.set(15.5, 3.1, 25);
    camera.lookAt(-9, 2.2, -16);
    return;
  }
  startMatch();
  if (shot.mode === 'buy') {
    player.yaw = .5; // stay in the buy phase at spawn, menu open
    return;
  }
  if (shot.mode === 'end') {
    G.scores.atk = TIMING.firstTo;
    G.scores.def = 5;
    G.matchWinner = 'atk';
    G.round = 13;
    G.player.kills = 14;
    G.player.deaths = 6;
    G.phase = 'matchend';
    camera.position.set(-8, 2.6, 12);
    camera.lookAt(6, 1.4, -12);
    return;
  }
  // play: a firefight at the Loading Dock, six rounds in, the score
  // 3–2 and 1:10 on the clock. The feed and radio tell the frame's own
  // story: Corin fell in the lane to the player's rifle, Flint fell in
  // the north lane to Vigil's DMR, and Hale fires from the dock door.
  G.phase = 'live';
  G.phaseTime = 70;
  G.round = 6;
  G.scores.atk = 3;
  G.scores.def = 2;
  G.targetSite = 'A';
  const p = G.player;
  p.giveWeapon('meridian');
  p.armor = 100;
  p.helmet = true;
  p.kills = 2;
  p.deaths = 2;
  p.pos.x = -10.5;
  p.pos.z = -6.0;
  p.yaw = .81;
  p.pitch = .01;
  const byTeam = (team) => G.actors.filter((a) => a.team === team && !a.isPlayer);
  const defs = byTeam('def');
  const atks = byTeam('atk');
  const pose = (a, x, z, yaw, crouch = false) => {
    a.pos.x = x;
    a.pos.z = z;
    a.yaw = yaw;
    a.crouch = crouch;
    a.syncMesh();
  };
  pose(defs[0], -18.2, -13.4, -2.47);
  pose(defs[1], -19.5, -14.8, -2.56, true);
  pose(defs[2], -15.8, -13.8, -2.2);
  pose(defs[3], 24, -12, 3.4);
  pose(defs[4], -13.2, -13.9, 2.4);
  pose(atks[0], -15.5, -10.2, -.1);
  pose(atks[1], 5.5, 12.5, .25);
  pose(atks[2], -16, 2, .1, true);
  pose(atks[3], 8, -20, -.4);
  for (const a of [...defs, ...atks]) {
    if (rng() < .7 && !a.primary) a.giveWeapon(rng() < .5 ? 'meridian' : 'raptor');
  }
  defs[3].giveWeapon('needle');
  // The two kills are real kills: their events seed the killfeed and
  // the radio on the first step, with the weapons that actually fired.
  radio('Pushing Site A — the Loading Dock');
  defs[4].die(p, 'head');
  atks[3].die(defs[3], 'body');
  p.money = 1450;
  // The kill pop is timed for the capture's late frame: by then the
  // "Round live" banner has faded and the headshot banner is fresh.
  G.lastKill = { name: defs[4].name, part: 'head', at: G.time + 2.3 };
  G.hitMarkAt = G.time + 2.38;
  G.killMarkAt = G.time + 2.38;
  makeNoise(defs[0].pos.x, defs[0].pos.z, 'def');
  // A smoke pot burns in the lane by the dock's east wall, backlit by
  // the lamps; main.js keeps the crossfire dressed with tracers.
  if (G.scene) spawnSmokeVisual(G.scene, -16.2, -9.5);
}
