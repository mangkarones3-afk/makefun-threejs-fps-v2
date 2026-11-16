// rounds.js — the match: phase machine, charge, scoring, economy.

import { TIMING, ECONOMY, WEAPONS, GEAR, MAX_GRENADES } from './config.js';
import { G, resetCharge, aliveCount } from './state.js';
import { Actor, buildActorMesh } from './actors.js';
import { Brain } from './bots.js';
import { siteAt, placeName } from './map.js';
import { chargeMeshRef, spawnExplosion } from './effects.js';
import { feedback, resetFeedback } from './feedback.js';
import { sfxBeep, sfxExplosion, sfxPlantStart, sfxRoundEnd } from './audio.js';

let beepAt = 0;

// Radio traffic: one short line per event that matters, named by the
// yard's own places. The HUD shows the last few under the objective.
export function radio(text) {
  G.radio.push({ text, at: G.time });
  if (G.radio.length > 3) G.radio.shift();
}

export function createActors(scene) {
  const player = new Actor('atk', 0, true);
  player.money = ECONOMY.startMoney;
  G.player = player;
  G.actors.push(player);
  for (const [team, count, slot0] of [['atk', 4, 1], ['def', 5, 0]]) {
    for (let i = 0; i < count; i++) {
      const bot = new Actor(team, slot0 + i);
      bot.money = ECONOMY.startMoney;
      bot.brain = new Brain(bot);
      scene.add(buildActorMesh(bot));
      G.actors.push(bot);
    }
  }
}

export function startMatch() {
  G.scores.atk = 0;
  G.scores.def = 0;
  G.lossStreak.atk = 0;
  G.lossStreak.def = 0;
  G.round = 0;
  G.matchWinner = null;
  resetFeedback();
  for (const a of G.actors) {
    a.money = ECONOMY.startMoney;
    a.kills = 0;
    a.deaths = 0;
    a.primary = null;
    a.armor = 0;
    a.helmet = false;
    a.grenades = [];
    a.current = a.pistol;
  }
  startRound();
}

function startRound() {
  G.round++;
  G.winner = null;
  G.winHow = '';
  G.targetSite = Math.random() < .55 ? 'A' : 'B';
  resetCharge();
  G.charge.carrier = G.player;
  beepAt = 0;

  for (const a of G.actors) {
    const spawns = G.map.spawns[a.team];
    const slot = G.actors.filter((o) => o.team === a.team).indexOf(a);
    const survived = a.alive;
    a.respawn(spawns[slot % spawns.length], survived);
    if (!survived) {
      a.armor = 0;
      a.helmet = false;
      a.grenades = [];
    }
  }
  G.phase = 'buy';
  G.phaseTime = TIMING.buyPhase;
  planBots();
  for (const a of G.actors) if (a.brain) botBuy(a);
}

// Defenders split across the sites with one roaming mid; the attacking
// bots push the round's target site behind the player, who carries the
// charge.
function planBots() {
  const defs = G.actors.filter((a) => a.team === 'def');
  defs.forEach((bot, i) => {
    const b = bot.brain;
    if (i < 2) { b.mode = 'hold'; b.goalSite = 'A'; b.holdPoint = G.map.holdPoints.A[i]; }
    else if (i < 4) { b.mode = 'hold'; b.goalSite = 'B'; b.holdPoint = G.map.holdPoints.B[i - 2]; }
    else { b.mode = 'roam'; b.goalSite = 'A'; b.holdPoint = null; }
    b.reset();
  });
  for (const a of G.actors) {
    if (a.team !== 'atk' || !a.brain) continue;
    a.brain.mode = 'push';
    a.brain.goalSite = G.targetSite;
    a.brain.reset();
  }
}

export function buy(actor, itemId) {
  if (G.phase !== 'buy' || !actor.alive) return false;
  if (WEAPONS[itemId]) {
    const def = WEAPONS[itemId];
    if (actor.money < def.price) return false;
    if (def.slot === 'primary' && actor.primary?.def.id === itemId) return false;
    if (def.slot === 'pistol' && actor.pistol.def.id === itemId) return false;
    actor.money -= def.price;
    actor.giveWeapon(itemId);
    return true;
  }
  if (itemId === 'vest') {
    if (actor.money < GEAR.vest.price || actor.armor >= 100) return false;
    actor.money -= GEAR.vest.price;
    actor.armor = 100;
    return true;
  }
  if (itemId === 'vestHelmet') {
    if (actor.money < GEAR.vestHelmet.price || (actor.armor >= 100 && actor.helmet)) return false;
    actor.money -= GEAR.vestHelmet.price;
    actor.armor = 100;
    actor.helmet = true;
    return true;
  }
  if (GEAR[itemId]) { // a grenade
    if (actor.money < GEAR[itemId].price) return false;
    if (actor.grenades.length >= MAX_GRENADES) return false;
    if (actor.grenades.filter((g) => g === itemId).length >= 2) return false;
    actor.money -= GEAR[itemId].price;
    actor.grenades.push(itemId);
    return true;
  }
  return false;
}

// A bot's shopping list, in priority order: a long gun, then armour,
// then a grenade with what is left. Bots keep a small reserve so a
// lost round does not leave them naked two rounds running.
function botBuy(bot) {
  if (!bot.primary) {
    if (bot.money >= 2700) buy(bot, Math.random() < .7 ? 'meridian' : 'needle');
    else if (bot.money >= 1400) buy(bot, 'raptor');
    else if (bot.money >= 1100) buy(bot, 'scatter');
  }
  if (bot.armor < 60) {
    if (bot.money >= 1000) buy(bot, 'vestHelmet');
    else if (bot.money >= 650) buy(bot, 'vest');
  }
  if (bot.money >= 500 && bot.grenades.length < 2) buy(bot, 'frag');
  if (bot.money >= 400 && bot.grenades.length < 2) buy(bot, 'flash');
}

function syncChargeMesh() {
  const mesh = chargeMeshRef();
  if (!mesh) return;
  const c = G.charge;
  if (c.state === 'carried' && c.carrier) {
    mesh.visible = true;
    mesh.position.set(c.carrier.pos.x, .55, c.carrier.pos.z + .1);
    mesh.rotation.set(0, c.carrier.yaw, .5);
  } else if (c.state === 'dropped' || c.state === 'planted') {
    mesh.visible = true;
    mesh.position.set(c.x, 0, c.z);
    mesh.rotation.set(0, 0, 0);
  } else {
    mesh.visible = false;
  }
}

// Run one actor's plant/defuse channel: true while channelling, and
// true at the moment the channel completes.
function channel(actor, kind, seconds, dt) {
  if (G.interactor && G.interactor !== actor) return false;
  if (G.interactor !== actor) {
    G.interactor = actor;
    G.interactKind = kind;
    G.interactT = 0;
    if (kind === 'plant') sfxPlantStart();
  }
  G.interactT += dt;
  return G.interactT >= seconds;
}

function stopChannel() {
  G.interactor = null;
  G.interactKind = '';
  G.interactT = 0;
}

function updateCharge(dt) {
  const c = G.charge;
  // Pick-up: an attacker walking over a dropped charge takes it.
  if (c.state === 'dropped') {
    for (const a of G.actors) {
      if (a.team === 'atk' && a.alive && Math.hypot(a.pos.x - c.x, a.pos.z - c.z) < 1.25) {
        c.state = 'carried';
        c.carrier = a;
        G.feed.push({ text: `${a.name} picked up the charge`, at: G.time });
        radio(`${a.name} has the charge — moving`);
        break;
      }
    }
  }
  if (c.state === 'carried' && c.carrier) {
    const carrier = c.carrier;
    const site = siteAt(G.map, carrier.pos.x, carrier.pos.z);
    if (carrier.alive && carrier.wantPlant && site) {
      if (channel(carrier, 'plant', TIMING.plantTime, dt)) {
        c.state = 'planted';
        c.carrier = null;
        c.x = carrier.pos.x;
        c.z = carrier.pos.z;
        c.site = site.id;
        c.timer = TIMING.chargeTimer;
        carrier.money = Math.min(ECONOMY.maxMoney, carrier.money + ECONOMY.plantReward);
        G.feed.push({ text: `Charge planted at Site ${site.id}`, at: G.time });
        radio(`Charge planted — Site ${site.id}, ${site.name}`);
        sfxBeep(false);
        stopChannel();
      }
    } else if (G.interactKind === 'plant') {
      stopChannel();
    }
  }
  // The planted timer, its quickening beeps, and the defuse channel.
  if (c.state === 'planted') {
    c.timer -= dt;
    const interval = c.timer < 10 ? .5 : c.timer < 25 ? 1 : 2;
    if (G.time >= beepAt) {
      beepAt = G.time + interval;
      sfxBeep(c.timer < 5);
    }
    let defused = false;
    let channeling = false;
    for (const a of G.actors) {
      if (a.team !== 'def' || !a.alive || !a.wantDefuse) continue;
      if (Math.hypot(a.pos.x - c.x, a.pos.z - c.z) > 1.7) continue;
      channeling = true;
      if (channel(a, 'defuse', TIMING.defuseTime, dt)) defused = true;
      break;
    }
    if (!channeling && G.interactKind === 'defuse') stopChannel();
    if (defused) {
      c.state = 'done';
      stopChannel();
      endRound('def', 'defuse');
      return;
    }
    if (c.timer <= 0) {
      c.state = 'done';
      sfxExplosion();
      spawnExplosion(c.x, 1, c.z, 1.6);
      feedback('large', c.x, 1, c.z); // the blast lands in frozen time
      endRound('atk', 'detonation');
      return;
    }
  }
  syncChargeMesh();
}

function endRound(winner, how) {
  if (G.phase !== 'live') return;
  G.phase = 'end';
  G.phaseTime = TIMING.roundEnd;
  G.winner = winner;
  G.winHow = how;
  G.scores[winner]++;
  const loser = winner === 'atk' ? 'def' : 'atk';
  G.lossStreak[loser]++;
  G.lossStreak[winner] = 0;
  const winPay = how === 'detonation' || how === 'defuse'
    ? ECONOMY.winObjective
    : how === 'timeout' ? ECONOMY.winTimeout : ECONOMY.winElimination;
  const lossPay = Math.min(ECONOMY.lossCap, ECONOMY.lossBase + ECONOMY.lossStep * (G.lossStreak[loser] - 1));
  for (const a of G.actors) {
    a.money = Math.min(ECONOMY.maxMoney, a.money + (a.team === winner ? winPay : lossPay));
    a.triggerHeld = false;
    a.triggerEdge = false;
  }
  stopChannel();
  if (G.scores[winner] >= TIMING.firstTo) G.matchWinner = winner;
  sfxRoundEnd(winner === 'atk');
}

function drainEvents() {
  for (const ev of G.events) {
    if (ev.type === 'kill') {
      const a = ev.attacker, v = ev.victim;
      G.feed.push({
        kill: true, aName: a ? a.name : 'The yard', aTeam: a ? a.team : v.team,
        weapon: a ? a.current.def.name : '', vName: v.name, vTeam: v.team,
        head: ev.part === 'head', at: G.time,
      });
      if (G.feed.length > 6) G.feed.shift();
      const place = placeName(G.map, v.pos.x, v.pos.z);
      radio(v.team === 'def'
        ? `Contact at ${place} — Warden down`
        : `Breacher down at ${place}`);
    }
  }
  G.events.length = 0;
}

export function updateRounds(dt) {
  drainEvents();
  switch (G.phase) {
    case 'buy':
      G.phaseTime -= dt;
      if (G.phaseTime <= 0) {
        G.phase = 'live';
        G.phaseTime = TIMING.roundLive;
        radio(`Round live — target Site ${G.targetSite}`);
      }
      syncChargeMesh();
      break;
    case 'live': {
      updateCharge(dt);
      if (G.phase !== 'live') break; // the charge ended the round
      const defAlive = aliveCount('def');
      const atkAlive = aliveCount('atk');
      if (defAlive === 0) {
        endRound('atk', 'elimination');
      } else if (atkAlive === 0 && G.charge.state !== 'planted') {
        endRound('def', 'elimination');
      } else if (G.charge.state !== 'planted') {
        G.phaseTime -= dt;
        if (G.phaseTime <= 0) endRound('def', 'timeout');
      }
      break;
    }
    case 'end':
      G.phaseTime -= dt;
      if (G.phaseTime <= 0) {
        if (G.matchWinner) G.phase = 'matchend';
        else startRound();
      }
      break;
  }
}
