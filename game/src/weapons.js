// weapons.js — weapon instances and everything a shot does: spread and
// recoil that punish firing on the move, range falloff, headshot damage,
// tracers, noise for the bots to hear, and the three grenade kinds. One
// WeaponInst per actor slot; player and bots share the firing maths.

import * as THREE from 'three';
import { WEAPONS } from './config.js';
import { G, makeNoise } from './state.js';
import { raycastWalls, losClear, clamp } from './physics.js';
import { spawnTracer, spawnMuzzle, spawnImpact, spawnSmokeVisual, spawnExplosion } from './effects.js';
import { sfxShot, sfxDryFire, sfxReload, sfxDraw, sfxThrow, sfxFrag, sfxFlash, sfxSmoke } from './audio.js';

const _hit = { t: 0, x: 0, y: 0, z: 0, hit: false };
const _dir = new THREE.Vector3();

export class WeaponInst {
  constructor(defId) {
    this.def = WEAPONS[defId];
    this.mag = this.def.mag;
    this.reserve = this.def.reserve;
    this.cooldown = 0;
    this.reloadLeft = 0;
    this.bloom = 0; // extra spread from sustained fire, decays when idle
  }

  get reloading() {
    return this.reloadLeft > 0;
  }

  startReload(actor) {
    if (this.reloading || this.mag >= this.def.mag || this.reserve <= 0) return false;
    this.reloadLeft = this.def.reload;
    if (actor.isPlayer) sfxReload();
    return true;
  }

  update(dt) {
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.bloom > 0) this.bloom = Math.max(0, this.bloom - dt * 0.055);
    if (this.reloadLeft > 0) {
      this.reloadLeft -= dt;
      if (this.reloadLeft <= 0) {
        const take = Math.min(this.def.mag - this.mag, this.reserve);
        this.mag += take;
        this.reserve -= take;
      }
    }
  }
}

// Total spread (radians) for an actor firing right now: the weapon's base,
// plus movement and air penalties, eased by crouching, plus bloom.
export function currentSpread(actor, inst) {
  const def = inst.def;
  const speed = actor.speedNow;
  let s = def.spread + inst.bloom;
  if (!actor.grounded) s += def.spreadAir;
  else if (speed > 0.6) s += def.spreadMove * clamp(speed / 5, 0, 1);
  if (actor.crouch) s *= def.crouchMult;
  return s;
}

// Fire one trigger pull if the weapon is ready. Returns true when a shot
// (or a dry click) happened, so callers can pace semi-automatics.
export function tryFire(actor) {
  const inst = actor.current;
  if (!inst || inst.reloading || inst.cooldown > 0) return false;
  const def = inst.def;
  // Semi-automatics fire once per fresh trigger press; automatics use held.
  if (!def.auto && !actor.triggerEdge) return false;
  actor.triggerEdge = false;
  if (inst.mag <= 0) {
    inst.cooldown = 0.32;
    if (actor.isPlayer) sfxDryFire();
    inst.startReload(actor);
    return true;
  }
  inst.mag--;
  inst.cooldown = 60 / def.rpm;
  inst.bloom = Math.min(0.05, inst.bloom + def.spread * 0.55);

  const eye = actor.eyePos();
  const distToPlayer = actor.isPlayer ? 0 : Math.hypot(eye.x - G.player.pos.x, eye.z - G.player.pos.z);
  sfxShot(def.id, distToPlayer);
  makeNoise(eye.x, eye.z, actor.team);

  // Muzzle point: ahead of the eye, low and to the right.
  const fx = -Math.sin(actor.yaw), fz = -Math.cos(actor.yaw);
  const mx = eye.x + fx * 0.55 + fz * 0.16;
  const mz = eye.z + fz * 0.55 - fx * 0.16;
  const my = eye.y - 0.14;
  spawnMuzzle(mx, my, mz);
  actor.recoilPitch += def.kick;
  if (actor.isPlayer && (def.id === 'scatter' || def.id === 'farshot')) {
    G.shake = Math.min(0.5, G.shake + 0.16); // the heavy guns thump the camera
  }
  actor.shotsFired = (actor.shotsFired || 0) + def.pellets;

  const spread = currentSpread(actor, inst);
  for (let p = 0; p < def.pellets; p++) {
    // Random point in the spread cone around the aim direction.
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * spread;
    const pitch = actor.pitch + actor.recoilPitch + Math.cos(a) * r;
    const yaw = actor.yaw + Math.sin(a) * r / Math.max(0.35, Math.cos(pitch));
    _dir.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    resolveShot(actor, inst, eye, _dir, mx, my, mz);
  }
  if (inst.mag === 0) inst.startReload(actor);
  return true;
}

function resolveShot(actor, inst, eye, dir, mx, my, mz) {
  const def = inst.def;
  raycastWalls(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, 140, G.map.colliders, _hit);
  let bestT = _hit.t;
  let victim = null;
  let part = null;
  for (const other of G.actors) {
    if (other === actor || !other.alive || other.team === actor.team) continue;
    const res = other.hitTest(eye, dir, bestT);
    if (res && res.t < bestT) {
      bestT = res.t;
      victim = other;
      part = res.part;
    }
  }
  const ex = eye.x + dir.x * bestT;
  const ey = eye.y + dir.y * bestT;
  const ez = eye.z + dir.z * bestT;
  spawnTracer(mx, my, mz, ex, ey, ez);
  if (victim) {
    let dmg = def.damage * (part === 'head' ? def.headMult : 1);
    if (bestT > def.falloff) {
      dmg *= Math.max(0.45, 1 - 0.55 * (bestT - def.falloff) / (def.falloff * 2));
    }
    victim.takeDamage(dmg, part, actor);
    if (actor.isPlayer) {
      if (!victim.alive) {
        G.killMarkAt = G.time;
        G.lastKill = { name: victim.name, part, at: G.time };
        // The kill beat: a breath of frozen time and a nudge of shake,
        // longer for a headshot. Presentation only — main.js consumes it.
        G.hitStop = part === 'head' ? 0.075 : 0.05;
        G.shake = Math.min(0.5, G.shake + 0.12);
      } else {
        G.hitMarkAt = G.time;
      }
    }
    spawnImpact(ex, ey, ez, true);
  } else if (_hit.hit) {
    spawnImpact(ex, ey, ez, false);
  }
}

// ---- Grenades ------------------------------------------------------------

export function throwGrenade(actor) {
  if (!actor.grenades.length) return false;
  const type = actor.grenades.shift();
  const eye = actor.eyePos();
  const pitch = actor.pitch + 0.12;
  const dir = new THREE.Vector3(
    -Math.sin(actor.yaw) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(actor.yaw) * Math.cos(pitch),
  );
  const grenade = {
    type,
    x: eye.x + dir.x * 0.4, y: eye.y - 0.1, z: eye.z + dir.z * 0.4,
    vx: dir.x * 13.5, vy: dir.y * 13.5 + 2.2, vz: dir.z * 13.5,
    fuse: type === 'frag' ? 1.6 : type === 'flash' ? 1.35 : 1.0,
    team: actor.team,
    thrower: actor,
    rested: false,
    mesh: new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 8, 8),
      new THREE.MeshLambertMaterial({ color: type === 'smoke' ? 0x777777 : 0x2c2f26 }),
    ),
  };
  grenade.mesh.position.set(grenade.x, grenade.y, grenade.z);
  G.scene.add(grenade.mesh);
  G.grenades.push(grenade);
  if (actor.isPlayer) sfxThrow();
  return true;
}

export function updateGrenades(dt) {
  const list = G.grenades;
  for (let i = list.length - 1; i >= 0; i--) {
    const n = list[i];
    n.fuse -= dt;
    if (!n.rested) {
      n.vy -= 13 * dt;
      n.x += n.vx * dt;
      n.y += n.vy * dt;
      n.z += n.vz * dt;
      // Bounce off walls: test the new point against colliders.
      for (const c of G.map.colliders) {
        if (n.y > c.h) continue;
        if (n.x > c.x0 - 0.09 && n.x < c.x1 + 0.09 && n.z > c.z0 - 0.09 && n.z < c.z1 + 0.09) {
          const pushL = n.x - (c.x0 - 0.09), pushR = (c.x1 + 0.09) - n.x;
          const pushN = n.z - (c.z0 - 0.09), pushS = (c.z1 + 0.09) - n.z;
          const min = Math.min(pushL, pushR, pushN, pushS);
          if (min === pushL) { n.x = c.x0 - 0.09; n.vx = -Math.abs(n.vx) * 0.42; }
          else if (min === pushR) { n.x = c.x1 + 0.09; n.vx = Math.abs(n.vx) * 0.42; }
          else if (min === pushN) { n.z = c.z0 - 0.09; n.vz = -Math.abs(n.vz) * 0.42; }
          else { n.z = c.z1 + 0.09; n.vz = Math.abs(n.vz) * 0.42; }
          n.vx *= 0.8; n.vz *= 0.8;
        }
      }
      if (n.y < 0.09) {
        n.y = 0.09;
        n.vy = -n.vy * 0.38;
        n.vx *= 0.7; n.vz *= 0.7;
        if (Math.abs(n.vy) < 0.8) { n.vy = 0; n.rested = true; }
      }
      if (n.mesh) n.mesh.position.set(n.x, n.y, n.z);
    }
    if (n.fuse <= 0) {
      list.splice(i, 1);
      if (n.mesh) { G.scene.remove(n.mesh); }
      detonate(n);
    }
  }
}

function detonate(n) {
  const distToPlayer = Math.hypot(n.x - G.player.pos.x, n.z - G.player.pos.z);
  if (n.type === 'frag') {
    sfxFrag();
    G.shake = Math.min(0.5, G.shake + 6 / (6 + distToPlayer));
    spawnExplosion(n.x, 0.5, n.z, 0.55);
    for (const a of G.actors) {
      if (!a.alive) continue;
      const chest = a.chestPos();
      const d = Math.hypot(chest.x - n.x, chest.z - n.z);
      if (d > 6.5) continue;
      if (!losClear(n.x, 0.6, n.z, chest.x, chest.y, chest.z, G.map.colliders, [], 0)) continue;
      a.takeDamage(Math.max(9, 92 * (1 - d / 6.5)), 'body', n.thrower);
    }
  } else if (n.type === 'flash') {
    sfxFlash();
    for (const a of G.actors) {
      if (!a.alive) continue;
      const eye = a.eyePos();
      const d = Math.hypot(eye.x - n.x, eye.z - n.z);
      if (d > 17) continue;
      if (!losClear(n.x, n.y, n.z, eye.x, eye.y, eye.z, G.map.colliders, [], 0)) continue;
      // Looking toward the flash blinds longest; back turned, barely.
      const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
      const dot = (fx * (n.x - eye.x) + fz * (n.z - eye.z)) / (d || 1);
      const strength = dot > 0.25 ? 1 : dot > -0.3 ? 0.45 : 0.12;
      const dur = strength * Math.max(0.4, 3.4 - d * 0.16);
      a.blindUntil = Math.max(a.blindUntil, G.time + dur);
      if (a.isPlayer) G.flashTime = Math.max(G.flashTime, dur);
    }
  } else { // smoke
    sfxSmoke();
    const visual = spawnSmokeVisual(G.scene, n.x, n.z);
    G.smokes.push({ x: n.x, z: n.z, r: 2.7, until: G.time + 13, visual });
  }
}

// ---- Gun models ------------------------------------------------------------

// A modelled gun built from boxes and cylinders — receiver, barrel,
// magazine, furniture, and an optic with a lit dot — in gunmetal with a
export function buildGunMesh(defId, viewmodel) {
  const def = WEAPONS[defId];
  const group = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.45, metalness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.7, metalness: 0.3 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x8a5a20, roughness: 0.55, metalness: 0.4 });
  const dot = new THREE.MeshBasicMaterial({ color: 0xff4a3c });
  const s = viewmodel ? 1 : 0.62;
  const add = (w, h, d, x, y, z, mat = metal, rx = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    if (rx) m.rotation.x = rx;
    group.add(m);
    return m;
  };
  const cyl = (r, len, x, y, z, mat = dark) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), mat);
    m.rotation.x = Math.PI / 2;
    m.position.set(x, y, z);
    group.add(m);
    return m;
  };
  switch (def.id) {
    case 'p9':
      add(0.05, 0.09, 0.24, 0, 0, 0); add(0.045, 0.12, 0.07, 0, -0.09, 0.07, dark);
      add(0.012, 0.012, 0.012, 0, 0.052, -0.1, dot); // tritium front dot
      break;
    case 'scatter':
      add(0.06, 0.09, 0.62, 0, 0, -0.08);
      cyl(0.028, 0.34, 0, -0.045, -0.2, dark); // magazine tube
      add(0.05, 0.05, 0.3, 0, -0.055, -0.18, accent); // pump
      add(0.045, 0.13, 0.07, 0, -0.1, 0.16, dark);
      add(0.014, 0.014, 0.014, 0, 0.055, -0.36, dot); // bead sight
      break;
    case 'raptor':
      add(0.055, 0.11, 0.46, 0, 0, -0.04);
      cyl(0.055, 0.07, 0, -0.12, 0.02, dark); // drum magazine
      add(0.045, 0.05, 0.18, 0, 0.01, 0.3, dark);
      add(0.03, 0.05, 0.05, 0, 0.085, -0.06, dark); // rear sight
      add(0.012, 0.012, 0.012, 0, 0.09, -0.06, dot);
      break;
    case 'needle':
      add(0.05, 0.09, 0.78, 0, 0, -0.14);
      cyl(0.02, 0.52, 0, 0.01, -0.32, dark); // barrel
      cyl(0.032, 0.2, 0, 0.01, -0.62, metal); // suppressor
      add(0.04, 0.14, 0.06, 0, -0.12, 0.05, dark, 0.18); // magazine
      add(0.05, 0.06, 0.1, 0, 0.09, -0.05, dark); // sight block
      add(0.012, 0.012, 0.012, 0, 0.095, -0.05, dot);
      break;
    case 'farshot':
      add(0.055, 0.1, 0.95, 0, 0, -0.22);
      cyl(0.016, 0.62, 0, 0.015, -0.44, dark); // long barrel
      cyl(0.03, 0.24, 0, 0.015, -0.78, metal); // suppressor
      add(0.045, 0.15, 0.06, 0, -0.13, 0.08, dark, 0.15); // magazine
      add(0.045, 0.07, 0.16, 0, 0.1, -0.08, dark); // scope
      cyl(0.026, 0.05, 0, 0.1, -0.17, dark); // scope bell
      add(0.012, 0.012, 0.012, 0, 0.1, -0.02, dot);
      break;
    default: // meridian rifle
      add(0.055, 0.11, 0.56, 0, 0, -0.08);
      add(0.04, 0.05, 0.26, 0, 0.005, -0.42, dark); // handguard
      cyl(0.018, 0.2, 0, 0.01, -0.5, dark); // barrel tip
      add(0.042, 0.17, 0.06, 0, -0.14, 0.03, dark, 0.16); // magazine, raked
      add(0.045, 0.13, 0.07, 0, -0.1, 0.2, dark); // grip
      add(0.05, 0.045, 0.09, 0, 0.085, -0.04, dark); // reflex optic
      add(0.014, 0.014, 0.014, 0, 0.09, -0.04, dot); // its lit dot
  }
  group.scale.setScalar(s);
  return group;
}

export function drawSound() {
  sfxDraw();
}
