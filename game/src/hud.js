// hud.js — everything drawn in the DOM: HUD, crosshair, killfeed,
// radio, minimap, banners, buy menu and menus. DOM writes are cached.

import { TIMING, WEAPONS, GEAR, BUY_ORDER } from './config.js';
import { G, aliveCount } from './state.js';
import { buy } from './rounds.js';
import { currentSpread } from './weapons.js';
import { sfxBuy, sfxHitmark } from './audio.js';

const $ = (id) => document.getElementById(id);
const cache = new Map();
function setText(el, value) {
  if (cache.get(el) !== value) {
    cache.set(el, value);
    el.textContent = value;
  }
}
function setWidth(el, pct) {
  const v = `${Math.max(0, Math.min(100, pct)).toFixed(1)}%`;
  if (cache.get(el) !== v) {
    cache.set(el, v);
    el.style.width = v;
  }
}

let els = null;
let lastPhase = '';
let bannerUntil = 0;
let buyBuilt = false;
let killBannerAt = -9;
let lastHitMarkAt = -9;
let lastKillMarkAt = -9;

// Element handles, keyed by camelCased id, with four renames.
const EL_IDS = 'hud crosshair hitmarker health-fill health-num armor-fill weapon-name ammo-mag ammo-res timer phase-name sc-atk sc-def round-num alive-line feed minimap radio banner banner-title banner-sub kill-banner kill-title kill-sub interact interact-fill interact-label objective vignette flash hurt-dir buy-menu buy-grid buy-money menu-start menu-end end-title end-stats pause-menu click-aim';

export function initHud({ onPlay, onResume, onAgain }) {
  els = {};
  for (const id of EL_IDS.split(' ')) {
    els[id.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())] = $(id);
  }
  els.money = $('money-num');
  els.grenades = $('grenade-icons');
  els.scAtk = $('sc-atk');
  els.scDef = $('sc-def');
  $('btn-play').addEventListener('click', onPlay);
  $('btn-again').addEventListener('click', onAgain);
  $('btn-resume').addEventListener('click', onResume);
  els.clickAim.addEventListener('click', onResume);

  // Buying: number keys while the buy phase runs, or clicks when the
  // pointer is free. Keys mirror the menu's printed hints.
  const buyKeys = {
    Digit1: BUY_ORDER[0], Digit2: BUY_ORDER[1], Digit3: BUY_ORDER[2],
    Digit4: BUY_ORDER[3], Digit5: BUY_ORDER[4],
    Digit6: 'vest', Digit7: 'vestHelmet', Digit8: 'frag', Digit9: 'flash', Digit0: 'smoke',
  };
  document.addEventListener('keydown', (e) => {
    if (G.phase !== 'buy') return;
    const item = buyKeys[e.code];
    if (item) {
      sfxBuy(buy(G.player, item));
      refreshBuyMenu();
    }
    if (e.code === 'Tab') e.preventDefault();
  });
}

function buildBuyMenu() {
  buyBuilt = true;
  const frag = document.createDocumentFragment();
  const addItem = (id, keyHint) => {
    const def = WEAPONS[id] ?? GEAR[id];
    const btn = document.createElement('button');
    btn.className = 'buy-item';
    btn.dataset.item = id;
    btn.innerHTML = `<span class="buy-key">${keyHint}</span><span class="buy-name">${def.name}</span><span class="buy-price">$${def.price}</span>`;
    btn.addEventListener('click', () => {
      if (G.phase === 'buy') {
        sfxBuy(buy(G.player, id));
        refreshBuyMenu();
      }
    });
    frag.appendChild(btn);
  };
  BUY_ORDER.forEach((id, i) => addItem(id, String(i + 1)));
  addItem('vest', '6');
  addItem('vestHelmet', '7');
  addItem('frag', '8');
  addItem('flash', '9');
  addItem('smoke', '0');
  els.buyGrid.replaceChildren(frag);
}

function refreshBuyMenu() {
  if (!buyBuilt) buildBuyMenu();
  const p = G.player;
  setText(els.buyMoney, `$${p.money}`);
  for (const btn of els.buyGrid.children) {
    const id = btn.dataset.item;
    const def = WEAPONS[id] ?? GEAR[id];
    let owned = false;
    if (WEAPONS[id]) owned = (p.primary?.def.id === id) || (p.pistol.def.id === id);
    else if (id === 'vest') owned = p.armor >= 100;
    else if (id === 'vestHelmet') owned = p.helmet && p.armor >= 100;
    else owned = p.grenades.filter((g) => g === id).length >= 2 || p.grenades.length >= 3;
    btn.classList.toggle('owned', owned);
    btn.classList.toggle('poor', !owned && p.money < def.price);
  }
}

function showBanner(title, sub, seconds) {
  setText(els.bannerTitle, title);
  setText(els.bannerSub, sub);
  els.banner.hidden = false;
  // Restart the pop animation even when the same banner follows itself.
  els.banner.classList.remove('pop');
  void els.banner.offsetWidth;
  els.banner.classList.add('pop');
  bannerUntil = G.time + seconds;
}

function phaseChanged() {
  const p = G.player;
  if (G.phase === 'buy') {
    showBanner(`Round ${G.round}`, `First to ${TIMING.firstTo} — buy your kit`, 2.2);
    refreshBuyMenu();
    els.buyMenu.hidden = false;
  } else {
    els.buyMenu.hidden = true;
  }
  if (G.phase === 'live') {
    showBanner('Round live', 'Plant the charge or eliminate the Wardens', 1.4);
  }
  if (G.phase === 'end') {
    const won = G.winner === 'atk';
    const how = {
      elimination: 'by elimination', detonation: 'the charge detonated',
      defuse: 'the charge was defused', timeout: 'time expired',
    }[G.winHow] ?? '';
    showBanner(won ? 'Breachers take the round' : 'Wardens take the round', how, TIMING.roundEnd - .4);
  }
  if (G.phase === 'matchend') {
    const won = G.matchWinner === 'atk';
    setText(els.endTitle, won ? 'Breachers win the yard' : 'Wardens hold the yard');
    const mine = [...G.actors].filter((a) => a.team === 'atk');
    els.endStats.innerHTML =
      `<p>Final score — Breachers ${G.scores.atk} : ${G.scores.def} Wardens</p>` +
      `<p>Your line: ${p.kills} kills, ${p.deaths} deaths.</p>` +
      '<table>' + mine.map((a) => `<tr><td>${a.name}</td><td>${a.kills} K</td><td>${a.deaths} D</td></tr>`).join('') + '</table>';
  }
  els.menuEnd.hidden = G.phase !== 'matchend';
  els.menuStart.hidden = G.phase !== 'menu';
}

function fmtTime(s) {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function updateHud() {
  if (!els) return;
  const p = G.player;
  if (G.phase !== lastPhase) {
    lastPhase = G.phase;
    phaseChanged();
  }
  if (bannerUntil && G.time > bannerUntil) {
    els.banner.hidden = true;
    bannerUntil = 0;
  }
  const inGame = G.phase === 'buy' || G.phase === 'live' || G.phase === 'end';
  els.hud.style.visibility = inGame ? 'visible' : 'hidden';
  els.pauseMenu.hidden = !(G.paused && G.phase === 'live');
  els.clickAim.hidden = !(G.phase === 'live' && !G.paused && !isLocked() && !G.shot);
  if (!inGame) return;

  const planted = G.charge?.state === 'planted';
  setText(els.timer, planted ? fmtTime(G.charge.timer) : fmtTime(G.phaseTime));
  els.timer.classList.toggle('urgent', planted || (G.phase === 'live' && G.phaseTime < 11));
  setText(els.phaseName, planted ? 'CHARGE PLANTED' : G.phase.toUpperCase());
  setText(els.scAtk, String(G.scores.atk));
  setText(els.scDef, String(G.scores.def));
  setText(els.roundNum, `Round ${G.round}`);
  setText(els.aliveLine, `${aliveCount('atk')} Breachers — ${aliveCount('def')} Wardens`);

  setWidth(els.healthFill, p.hp);
  els.healthFill.style.background = p.hp < 30 ? '#e5484d' : '';
  setText(els.healthNum, String(Math.ceil(p.hp)));
  setWidth(els.armorFill, p.armor);
  setText(els.money, `$${p.money}`);
  setText(els.weaponName, p.current.def.name + (p.current.reloading ? ' — reloading' : ''));
  setText(els.ammoMag, String(p.current.mag));
  setText(els.ammoRes, `/ ${p.current.reserve}`);
  els.ammoMag.classList.toggle('low', p.current.mag <= p.current.def.mag * .25);
  setText(els.grenades, p.grenades.map((g) => ({ frag: '◆ Shard', flash: '◆ Flash', smoke: '◆ Smoke' }[g])).join('  '));

  if (p.alive && G.phase === 'live') {
    const px = 7 + currentSpread(p, p.current) * 620;
    els.crosshair.style.setProperty('--sp', `${px.toFixed(1)}px`);
    els.crosshair.style.opacity = '1';
  } else {
    els.crosshair.style.opacity = '0';
  }
  // The hitmarker ticks audibly as well as visually, once per event.
  if (G.hitMarkAt !== lastHitMarkAt) {
    lastHitMarkAt = G.hitMarkAt;
    if (G.time - G.hitMarkAt < .05) sfxHitmark(false);
  }
  if (G.killMarkAt !== lastKillMarkAt) {
    lastKillMarkAt = G.killMarkAt;
    if (G.time - G.killMarkAt < .05) sfxHitmark(true);
  }
  const hitAge = G.time - (G.hitMarkAt ?? -9);
  const killAge = G.time - (G.killMarkAt ?? -9);
  els.hitmarker.classList.toggle('on', hitAge < .14 || killAge < .3);
  els.hitmarker.classList.toggle('kill', killAge < .3);
  // The marker pops big on contact — an overshoot ease — and settles
  // back to its exact rest scale as it fades.
  const popAge = Math.min(hitAge, killAge);
  const popT = Math.min(1, Math.max(0, popAge / .18));
  const popScale = popAge < .3 ? 1 + .55 * (1 - popT) * (1 + 1.6 * popT * (1 - popT)) : 1;
  els.hitmarker.style.transform = `translate(-50%, -50%) rotate(45deg) scale(${popScale.toFixed(2)})`;

  const lk = G.lastKill;
  if (lk && lk.at !== killBannerAt) {
    killBannerAt = lk.at;
    setText(els.killTitle, lk.part === 'head' ? 'HEADSHOT' : 'ELIMINATED');
    setText(els.killSub, lk.name);
    els.killBanner.hidden = false;
    els.killBanner.classList.remove('show');
    void els.killBanner.offsetWidth;
    els.killBanner.classList.add('show');
  }
  if (lk && G.time - lk.at > 1.15) els.killBanner.hidden = true;

  // Hurt feedback: the rate-limited damage flash (feedback.js owns the
  // cap), plus a direction tick. At death's door the vignette stops
  // fading and pulses instead, driven by CSS.
  const hurtAge = G.time - p.lastHurtAt;
  const lowHp = p.alive && p.hp <= 30 && G.phase === 'live';
  els.vignette.classList.toggle('lowhp', lowHp);
  els.vignette.style.opacity = lowHp
    ? ''
    : String(Math.min(.85, (G.damageFlash ?? 0)) * (p.alive ? 1 : .4));
  if (hurtAge < 1.1 && p.alive) {
    const diff = ((p.hurtFromYaw - p.yaw) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
    els.hurtDir.style.opacity = String(1 - hurtAge / 1.1);
    els.hurtDir.style.transform = `translate(-50%, -50%) rotate(${(-diff).toFixed(2)}rad)`;
  } else {
    els.hurtDir.style.opacity = '0';
  }
  els.flash.style.opacity = String(Math.min(1, (G.flashTime ?? 0) / 1.6));

  let obj = '';
  if (G.phase === 'buy') obj = 'Buy phase — number keys buy, the round starts soon';
  else if (planted) obj = p.team === 'atk' ? 'Charge planted — hold the site' : 'Defuse the charge';
  else if (G.charge?.state === 'carried') {
    obj = G.charge.carrier === p
      ? 'You carry the charge — plant it at Site A or B (hold E)'
      : 'Cover the charge carrier';
  } else if (G.charge?.state === 'dropped') obj = 'The charge is down — recover it';
  if (!p.alive && G.phase === 'live') obj = 'You are down — your team fights on';
  setText(els.objective, obj);

  if (G.interactor === p && G.phase === 'live') {
    els.interact.hidden = false;
    setText(els.interactLabel, G.interactKind === 'plant' ? 'Planting the charge…' : 'Defusing…');
    setWidth(els.interactFill, (G.interactT / (G.interactKind === 'plant' ? TIMING.plantTime : TIMING.defuseTime)) * 100);
  } else {
    els.interact.hidden = true;
  }

  // Killfeed: rebuilt when its entries change, then each line fades
  // with age. A kill names its attacker, weapon and victim, coloured
  // by team; the plain lines are the charge's own news.
  const live = G.feed.filter((f) => G.time - f.at < 5.5);
  const feedSig = live.map((f) => f.at).join(',');
  if (cache.get('feed') !== feedSig) {
    cache.set('feed', feedSig);
    els.feed.innerHTML = live.map((f) => f.kill
      ? `<div class="feed-in"><span class="${f.aTeam}">${f.aName}</span> <span class="fw">${f.weapon}</span> ▸ <span class="${f.vTeam}">${f.vName}</span>${f.head ? ' (headshot)' : ''}</div>`
      : `<div class="feed-in">${f.text}</div>`).join('');
  }
  [...els.feed.children].forEach((el, i) => {
    el.style.opacity = String(Math.max(0, 1.1 - (G.time - live[i].at) / 5.5));
  });

  // Radio: the last two callouts, fading over six seconds.
  const rl = G.radio.filter((r) => G.time - r.at < 6).slice(-2);
  const rSig = rl.map((r) => r.at).join(',');
  if (cache.get('radio') !== rSig) {
    cache.set('radio', rSig);
    els.radio.innerHTML = rl.map((r) => `<div>${r.text}</div>`).join('');
  }
  [...els.radio.children].forEach((el, i) => {
    el.style.opacity = String(Math.max(.15, 1 - (G.time - rl[i].at) / 6));
  });

  drawMinimap();
}

// The minimap: the yard schematic, redrawn a few times a second. The
// static layer (colliders, sites) is painted once offscreen; each pass
// blits it and adds the player arrow, living Breacher dots, fading
// Warden-gunfire pings and the dropped charge as a diamond.
let mapBase = null;
let mapAt = -9;
function drawMinimap() {
  const cv = els?.minimap;
  if (!cv || !G.map || G.time - mapAt < .12) return;
  mapAt = G.time;
  const W = cv.width, H = cv.height;
  const px = (x) => (x + 40) / 80 * W, pz = (z) => (z + 30) / 60 * H;
  if (!mapBase) {
    mapBase = document.createElement('canvas');
    mapBase.width = W;
    mapBase.height = H;
    const b = mapBase.getContext('2d');
    b.fillStyle = 'rgba(10,13,19,.88)';
    b.fillRect(0, 0, W, H);
    for (const key of ['A', 'B']) {
      const s = G.map.sites[key];
      b.fillStyle = key === 'A' ? 'rgba(240,154,62,.22)' : 'rgba(125,177,232,.22)';
      b.fillRect(px(s.x0), pz(s.z0), (s.x1 - s.x0) / 80 * W, (s.z1 - s.z0) / 60 * H);
      b.fillStyle = '#f0ead8';
      b.font = 'bold 11px ui-monospace, Menlo, monospace';
      b.fillText(key, px(s.cx) - 3, pz(s.cz) + 4);
    }
    b.fillStyle = 'rgba(240,234,216,.32)';
    for (const c of G.map.colliders) {
      if (c.h < .6) continue;
      b.fillRect(px(c.x0), pz(c.z0), Math.max(1.5, (c.x1 - c.x0) / 80 * W), Math.max(1.5, (c.z1 - c.z0) / 60 * H));
    }
  }
  const g = cv.getContext('2d');
  g.drawImage(mapBase, 0, 0);
  for (const n of G.noises) {
    if (n.team !== 'def') continue;
    const age = G.time - n.at;
    if (age > 3.5) continue;
    g.globalAlpha = 1 - age / 3.5;
    g.fillStyle = '#7db1e8';
    g.beginPath();
    g.arc(px(n.x), pz(n.z), 3, 0, 7);
    g.fill();
  }
  g.globalAlpha = 1;
  g.fillStyle = '#f09a3e';
  for (const a of G.actors) {
    if (!a.alive || a.isPlayer || a.team !== 'atk') continue;
    g.beginPath();
    g.arc(px(a.pos.x), pz(a.pos.z), 2.6, 0, 7);
    g.fill();
  }
  const c = G.charge;
  if (c && c.state !== 'carried') {
    g.save();
    g.translate(px(c.x), pz(c.z));
    g.rotate(Math.PI / 4);
    g.fillStyle = '#ffc37a';
    g.fillRect(-2.6, -2.6, 5.2, 5.2);
    g.restore();
  }
  const p = G.player;
  if (p?.alive) {
    g.save();
    g.translate(px(p.pos.x), pz(p.pos.z));
    g.rotate(-p.yaw);
    g.fillStyle = '#ffc37a';
    g.beginPath();
    g.moveTo(0, -5.5);
    g.lineTo(3.6, 4.2);
    g.lineTo(-3.6, 4.2);
    g.closePath();
    g.fill();
    g.restore();
  }
}

function isLocked() {
  return !!document.pointerLockElement;
}
