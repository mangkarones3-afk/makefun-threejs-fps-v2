// rounds.js — the match itself: the phase machine (buy, live, end), the
// charge plant/defuse channels, scoring, the economy and bot round plans.

import { TIMING, ECONOMY, WEAPONS, GEAR, MAX_GRENADES } from './config.js';
import { G, resetCharge, aliveCount } from './state.js';
import { Actor, buildActorMesh } from './actors.js';
import { Brain } from './bots.js';
import { siteAt } from './map.js';
import { chargeMeshRef, spawnExplosion } from './effects.js';
import { sfxBeep, sfxExplosion, sfxPlantStart, sfxRoundEnd } from './audio.js';

let beepAt = 0;

// ---- Setup ------------------------------------------------------------------

export function createActors(scene) {
  const player = new Actor('atk', 0, true); player.money = ECONOMY.startMoney;
  G.player = player; G.actors.push(player);
  for (let i = 0; i < 4; i++) {
    const bot = new Actor('atk', i + 1); bot.money = ECONOMY.startMoney;
    bot.brain = new Brain(bot); scene.add(buildActorMesh(bot));
    G.actors.push(bot);
  }
  for (let i = 0; i < 5; i++) {
    const bot = new Actor('def', i); bot.money = ECONOMY.startMoney;
    bot.brain = new Brain(bot); scene.add(buildActorMesh(bot));
    G.actors.push(bot);
  }
}

export function startMatch() {
  G.scores.atk = 0; G.scores.def = 0;
  G.lossStreak.atk = 0; G.lossStreak.def = 0;
  G.round = 0; G.matchWinner = null;
  for (const a of G.actors) {
    a.money = ECONOMY.startMoney; a.kills = 0;
    a.deaths = 0; a.primary = null;
    a.armor = 0; a.helmet = false;
    a.grenades = []; a.current = a.pistol;
  }
  startRound();
}

function startRound() {
  G.round++; G.winner = null;
  G.winHow = ''; G.targetSite = Math.random() < 0.55 ? 'A' : 'B';
  resetCharge(); G.charge.carrier = G.player;
  beepAt = 0;

  for (const a of G.actors) {
    const spawns = G.map.spawns[a.team];
    const slot = a.team === 'atk'
      ? G.actors.filter((o) => o.team === 'atk').indexOf(a)
      : G.actors.filter((o) => o.team === 'def').indexOf(a); const survived = a.alive;
    a.respawn(spawns[slot % spawns.length], survived);
    if (!survived) {
      a.armor = 0; a.helmet = false;
      a.grenades = [];
    }
  }
  G.phase = 'buy'; G.phaseTime = TIMING.buyPhase;
  planBots(); for (const a of G.actors) if (a.brain) botBuy(a);
}

// Defenders split across the sites with one roaming mid; the attacking bots
// push the round's target site behind the player, who carries the charge.
function planBots() {
  const defs = G.actors.filter((a) => a.team === 'def');
  const holds = { A: G.map.holdPoints.A, B: G.map.holdPoints.B };
  defs.forEach((bot, i) => {
    const b = bot.brain;
    if (i < 2) { b.mode = 'hold'; b.goalSite = 'A'; b.holdPoint = holds.A[i]; }
    else if (i < 4) { b.mode = 'hold'; b.goalSite = 'B'; b.holdPoint = holds.B[i - 2]; }
    else { b.mode = 'roam'; b.goalSite = 'A'; b.holdPoint = null; }
    b.reset();
  });
  for (const a of G.actors) {
    if (a.team !== 'atk' || !a.brain) continue; a.brain.mode = 'push';
    a.brain.goalSite = G.targetSite; a.brain.reset();
  }
}

// ---- Buying -------------------------------------------------------------------

export function buy(actor, itemId) {
  if (G.phase !== 'buy' || !actor.alive) return false;
  if (WEAPONS[itemId]) {
    const def = WEAPONS[itemId]; if (actor.money < def.price) return false;
    if (def.slot === 'primary' && actor.primary?.def.id === itemId) return false;
    if (def.slot === 'pistol' && actor.pistol.def.id === itemId) return false; actor.money -= def.price;
    actor.giveWeapon(itemId); return true;
  }
  if (itemId === 'vest') {
    if (actor.money < GEAR.vest.price || actor.armor >= 100) return false; actor.money -= GEAR.vest.price;
    actor.armor = 100; return true;
  }
  if (itemId === 'vestHelmet') {
    if (actor.money < GEAR.vestHelmet.price || (actor.armor >= 100 && actor.helmet)) return false;
    actor.money -= GEAR.vestHelmet.price; actor.armor = 100;
    actor.helmet = true; return true;
  }
  if (GEAR[itemId]) { // a grenade
    if (actor.money < GEAR[itemId].price) return false; if (actor.grenades.length >= MAX_GRENADES) return false;
    if (actor.grenades.filter((g) => g === itemId).length >= 2) return false; actor.money -= GEAR[itemId].price;
    actor.grenades.push(itemId); return true;
  }
  return false;
}

// A bot's shopping list, in priority order: a long gun, then armour, then a
// grenade with what is left. Bots keep a small reserve so a lost round does
function botBuy(bot) {
  const tryBuy = (id) => buy(bot, id);
  if (!bot.primary) {
    if (bot.money >= 2700) tryBuy(Math.random() < 0.7 ? 'meridian' : 'needle');
    else if (bot.money >= 1400) tryBuy('raptor'); else if (bot.money >= 1100) tryBuy('scatter');
  }
  if (bot.armor < 60) {
    if (bot.money >= 1000) tryBuy('vestHelmet'); else if (bot.money >= 650) tryBuy('vest');
  }
  if (bot.money >= 500 && bot.grenades.length < 2) tryBuy('frag');
  if (bot.money >= 400 && bot.grenades.length < 2) tryBuy('flash');
}

// ---- The charge -----------------------------------------------------------------

function syncChargeMesh() {
  const mesh = chargeMeshRef(); if (!mesh) return;
  const c = G.charge;
  if (c.state === 'carried' && c.carrier) {
    mesh.visible = true; mesh.position.set(c.carrier.pos.x, 0.55, c.carrier.pos.z + 0.1);
    mesh.rotation.set(0, c.carrier.yaw, 0.5);
  } else if (c.state === 'dropped' || c.state === 'planted') {
    mesh.visible = true; mesh.position.set(c.x, 0, c.z);
    mesh.rotation.set(0, 0, 0);
  } else {
    mesh.visible = false;
  }
}

// Run one actor's plant/defuse channel. Returns true while channelling.
function channel(actor, kind, seconds, dt) {
  if (G.interactor && G.interactor !== actor) return false;
  if (G.interactor !== actor) {
    G.interactor = actor; G.interactKind = kind;
    G.interactT = 0; if (kind === 'plant') sfxPlantStart();
  }
  G.interactT += dt; return G.interactT >= seconds;
}

function stopChannel() {
  G.interactor = null; G.interactKind = '';
  G.interactT = 0;
}

function updateCharge(dt) {
  const c = G.charge;
  // Pick-up: an attacker walking over a dropped charge takes it.
  if (c.state === 'dropped') {
    for (const a of G.actors) {
      if (a.team === 'atk' && a.alive && Math.hypot(a.pos.x - c.x, a.pos.z - c.z) < 1.25) {
        c.state = 'carried'; c.carrier = a;
        G.feed.push({ text: `${a.name} picked up the charge`, at: G.time });
        break;
      }
    }
  }
  // Planting.
  if (c.state === 'carried' && c.carrier) {
    const carrier = c.carrier; const site = siteAt(G.map, carrier.pos.x, carrier.pos.z);
    if (carrier.alive && carrier.wantPlant && site) {
      if (channel(carrier, 'plant', TIMING.plantTime, dt)) {
        c.state = 'planted'; c.carrier = null;
        c.x = carrier.pos.x; c.z = carrier.pos.z;
        c.site = site.id; c.timer = TIMING.chargeTimer;
        carrier.money = Math.min(ECONOMY.maxMoney, carrier.money + ECONOMY.plantReward);
        G.feed.push({ text: `Charge planted at Site ${site.id}`, at: G.time });
        sfxBeep(false); stopChannel();
      }
    } else if (G.interactKind === 'plant') {
      stopChannel();
    }
  }
  // The planted timer, its quickening beeps, and the defuse channel.
  if (c.state === 'planted') {
    c.timer -= dt; const interval = c.timer < 10 ? 0.5 : c.timer < 25 ? 1 : 2;
    if (G.time >= beepAt) {
      beepAt = G.time + interval; sfxBeep(c.timer < 5);
    }
    let defused = false; let channeling = false;
    for (const a of G.actors) {
      if (a.team !== 'def' || !a.alive || !a.wantDefuse) continue;
      if (Math.hypot(a.pos.x - c.x, a.pos.z - c.z) > 1.7) continue; channeling = true;
      if (channel(a, 'defuse', TIMING.defuseTime, dt)) defused = true; break;
    }
    if (!channeling && G.interactKind === 'defuse') stopChannel();
    if (defused) {
      c.state = 'done'; stopChannel();
      endRound('def', 'defuse'); return;
    }
    if (c.timer <= 0) {
      c.state = 'done'; sfxExplosion();
      G.shake = 1.6;
      G.hitStop = 0.09; // the blast lands in frozen time, then the slow beat
      spawnExplosion(c.x, 1, c.z, 1.6); endRound('atk', 'detonation');
      return;
    }
  }
  syncChargeMesh();
}

// ---- Round flow -------------------------------------------------------------------

function endRound(winner, how) {
  if (G.phase !== 'live') return; G.phase = 'end';
  G.phaseTime = TIMING.roundEnd; G.winner = winner;
  G.winHow = how; G.scores[winner]++;
  const loser = winner === 'atk' ? 'def' : 'atk'; G.lossStreak[loser]++;
  G.lossStreak[winner] = 0;
  const winPay = how === 'detonation' || how === 'defuse'
    ? ECONOMY.winObjective
    : how === 'timeout' ? ECONOMY.winTimeout : ECONOMY.winElimination;
  const lossPay = Math.min(ECONOMY.lossCap, ECONOMY.lossBase + ECONOMY.lossStep * (G.lossStreak[loser] - 1));
  for (const a of G.actors) {
    a.money = Math.min(ECONOMY.maxMoney, a.money + (a.team === winner ? winPay : lossPay)); a.triggerHeld = false;
    a.triggerEdge = false;
  }
  stopChannel(); if (G.scores[winner] >= TIMING.firstTo) G.matchWinner = winner;
  sfxRoundEnd(winner === 'atk');
}

function drainEvents() {
  for (const ev of G.events) {
    if (ev.type === 'kill') {
      const who = ev.attacker ? ev.attacker.name : 'The yard';
      G.feed.push({ text: `${who}  ▸  ${ev.victim.name}${ev.part === 'head' ? '  (headshot)' : ''}`, at: G.time });
      if (G.feed.length > 6) G.feed.shift();
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
        G.phase = 'live'; G.phaseTime = TIMING.roundLive;
      }
      syncChargeMesh(); break;
    case 'live': {
      updateCharge(dt);
      if (G.phase !== 'live') break; // the charge ended the round
      const defAlive = aliveCount('def'); const atkAlive = aliveCount('atk');
      if (defAlive === 0) {
        endRound('atk', 'elimination');
      } else if (atkAlive === 0 && G.charge.state !== 'planted') {
        endRound('def', 'elimination');
      } else if (G.charge.state !== 'planted') {
        G.phaseTime -= dt; if (G.phaseTime <= 0) endRound('def', 'timeout');
      }
      break;
    }
    case 'end':
      G.phaseTime -= dt;
      if (G.phaseTime <= 0) {
        if (G.matchWinner) G.phase = 'matchend'; else startRound();
      }
      break;
  }
}
