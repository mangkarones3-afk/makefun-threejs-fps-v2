// shot.js — screenshot staging. The kit's shots.json opens the game
// with ?shot=<mode>&seed=<n>; each mode poses a deterministic scene so
// the maker's screenshots are real renders of the game's own code:
// start (menu over the yard), play (a live mid-round firefight), buy
// (the buy menu at round start), end (the match-end panel).

import { G } from './state.js';
import { startMatch } from './rounds.js';
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
  // play: freeze a firefight in mid. The player stands in the open lane
  // north of the orange container, rifle up; two Wardens are caught in
  // the open ahead, the rest of both teams spread through the yard.
  G.phase = 'live';
  G.phaseTime = 47;
  const p = G.player;
  p.giveWeapon('meridian');
  p.armor = 100;
  p.helmet = true;
  p.pos.x = .5;
  p.pos.z = -3.0;
  p.yaw = .0;
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
  pose(defs[0], 3.1, -9.8, 2.85);
  pose(defs[1], .8, -12.8, 3.05, true);
  pose(defs[2], -13.5, -4.5, 3.1);
  pose(defs[3], 24, -12, 3.4);
  pose(defs[4], -26, -14, .6);
  pose(atks[0], -4.4, -8.2, .15);
  pose(atks[1], 5.5, 12.5, .25);
  pose(atks[2], -16, 2, .1, true);
  pose(atks[3], 12, 16, -.4);
  for (const a of [...defs, ...atks]) {
    if (rng() < .7 && !a.primary) a.giveWeapon(rng() < .5 ? 'meridian' : 'raptor');
  }
  // A smoke pot burns at the east end of the lane, backlit by the
  // lamps; main.js keeps the crossfire dressed with tracers and sparks.
  if (G.scene) spawnSmokeVisual(G.scene, 7.5, -8.5);
  G.hitMarkAt = G.time;
}
