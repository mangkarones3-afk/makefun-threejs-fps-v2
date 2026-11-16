// weapons.js — weapon instances and everything a shot does: spread
// and recoil that punish firing on the move, range falloff, headshot
// damage, tracers, an ejected casing for every round, noise for the
// bots to hear, and the three grenade kinds. One WeaponInst per actor
// slot; player and bots share the firing maths exactly.

import * as THREE from 'three';
import { WEAPONS } from './config.js';
import { G, makeNoise } from './state.js';
import { raycastWalls, losClear, clamp } from './physics.js';
import {
  spawnTracer, spawnMuzzle, spawnImpact, spawnCasing,
  spawnSmokeVisual, spawnExplosion,
} from './effects.js';
import { feedback } from './feedback.js';
import {
  sfxShot, sfxDryFire, sfxReload, sfxThrow, sfxFrag, sfxFlash, sfxSmoke,
} from './audio.js';

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
    if (this.bloom > 0) this.bloom = Math.max(0, this.bloom - dt * .055);
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

// The spread cone (radians) for an actor firing right now: base, plus
// movement and air penalties, eased by crouching, plus bloom. Still
// and crouched is the tightest cone; airborne the widest.
export function currentSpread(actor, inst) {
  const def = inst.def;
  const speed = actor.speedNow;
  let s = def.spread + inst.bloom;
  if (!actor.grounded) s += def.spreadAir;
  else if (speed > .6) s += def.spreadMove * clamp(speed / 5, 0, 1);
  if (actor.crouch) s *= def.crouchMult;
  return s;
}

// Fire one trigger pull if the weapon is ready. Returns true when a
// shot (or a dry click) happened, so callers can pace semi-automatics.
export function tryFire(actor) {
  const inst = actor.current;
  if (!inst || inst.reloading || inst.cooldown > 0) return false;
  const def = inst.def;
  if (!def.auto && !actor.triggerEdge) return false; // semi: fresh press only
  actor.triggerEdge = false;
  if (inst.mag <= 0) {
    inst.cooldown = .32;
    if (actor.isPlayer) sfxDryFire();
    inst.startReload(actor);
    return true;
  }
  inst.mag--;
  inst.cooldown = 60 / def.rpm;
  inst.bloom = Math.min(.05, inst.bloom + def.spread * .55);

  const eye = actor.eyePos();
  const distToPlayer = actor.isPlayer
    ? 0
    : Math.hypot(eye.x - G.player.pos.x, eye.z - G.player.pos.z);
  sfxShot(def.id, distToPlayer);
  makeNoise(eye.x, eye.z, actor.team);

  // Muzzle point: ahead of the eye, low and to the right.
  const fx = -Math.sin(actor.yaw);
  const fz = -Math.cos(actor.yaw);
  const mx = eye.x + fx * .55 + fz * .16;
  const mz = eye.z + fz * .55 - fx * .16;
  const my = eye.y - .14;
  spawnMuzzle(mx, my, mz);
  // The spent casing leaves the port, when anyone is near to see it.
  if (distToPlayer < 26) {
    spawnCasing(eye.x + fx * .3 - fz * .22, eye.y - .12, eye.z + fz * .3 + fx * .22, -fz, fx);
  }
  actor.recoilPitch += def.kick;
  if (actor.isPlayer && (def.id === 'scatter' || def.id === 'farshot')) {
    feedback('small', mx, my, mz); // the heavy guns thump the camera
  }
  actor.shotsFired += def.pellets;

  const spread = currentSpread(actor, inst);
  for (let p = 0; p < def.pellets; p++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * spread;
    const pitch = actor.pitch + actor.recoilPitch + Math.cos(a) * r;
    const yaw = actor.yaw + Math.sin(a) * r / Math.max(.35, Math.cos(pitch));
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
      dmg *= Math.max(.45, 1 - .55 * (bestT - def.falloff) / (def.falloff * 2));
    }
    victim.takeDamage(dmg, part, actor);
    if (actor.isPlayer) {
      if (!victim.alive) {
        G.killMarkAt = G.time;
        G.lastKill = { name: victim.name, part, at: G.time };
        // The kill beat: a burst at the body and a swing of trauma —
        // the large tier for a headshot, medium for a body kill.
        const chest = victim.chestPos();
        feedback(part === 'head' ? 'large' : 'medium', chest.x, chest.y, chest.z);
      } else {
        G.hitMarkAt = G.time;
      }
    }
    spawnImpact(ex, ey, ez, true);
  } else if (_hit.hit) {
    spawnImpact(ex, ey, ez, false);
  }
}

// ---- Grenades --------------------------------------------------------------

export function throwGrenade(actor) {
  if (!actor.grenades.length) return false;
  const type = actor.grenades.shift();
  const eye = actor.eyePos();
  const pitch = actor.pitch + .12;
  const dir = new THREE.Vector3(
    -Math.sin(actor.yaw) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(actor.yaw) * Math.cos(pitch),
  );
  const grenade = {
    type,
    x: eye.x + dir.x * .4, y: eye.y - .1, z: eye.z + dir.z * .4,
    vx: dir.x * 13.5, vy: dir.y * 13.5 + 2.2, vz: dir.z * 13.5,
    fuse: type === 'frag' ? 1.6 : type === 'flash' ? 1.35 : 1.0,
    team: actor.team,
    thrower: actor,
    rested: false,
    mesh: new THREE.Mesh(
      new THREE.SphereGeometry(.09, 12, 8),
      new THREE.MeshLambertMaterial({ color: type === 'smoke' ? 0x5f666e : 0x2c2f26 }),
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
      // Bounce: push out of any collider the point entered, along
      // whichever face it is closest to leaving by.
      for (const c of G.map.colliders) {
        if (n.y > c.h) continue;
        if (n.x > c.x0 - .09 && n.x < c.x1 + .09 && n.z > c.z0 - .09 && n.z < c.z1 + .09) {
          const pushes = [n.x - (c.x0 - .09), (c.x1 + .09) - n.x, n.z - (c.z0 - .09), (c.z1 + .09) - n.z];
          const min = Math.min(pushes[0], pushes[1], pushes[2], pushes[3]);
          if (min === pushes[0]) { n.x = c.x0 - .09; n.vx = -Math.abs(n.vx) * .42; }
          else if (min === pushes[1]) { n.x = c.x1 + .09; n.vx = Math.abs(n.vx) * .42; }
          else if (min === pushes[2]) { n.z = c.z0 - .09; n.vz = -Math.abs(n.vz) * .42; }
          else { n.z = c.z1 + .09; n.vz = Math.abs(n.vz) * .42; }
          n.vx *= .8; n.vz *= .8;
        }
      }
      if (n.y < .09) {
        n.y = .09;
        n.vy = -n.vy * .38;
        n.vx *= .7; n.vz *= .7;
        if (Math.abs(n.vy) < .8) { n.vy = 0; n.rested = true; }
      }
      if (n.mesh) n.mesh.position.set(n.x, n.y, n.z);
    }
    if (n.fuse <= 0) {
      list.splice(i, 1);
      if (n.mesh) G.scene.remove(n.mesh);
      detonate(n);
    }
  }
}

function detonate(n) {
  const distToPlayer = Math.hypot(n.x - G.player.pos.x, n.z - G.player.pos.z);
  if (n.type === 'frag') {
    sfxFrag();
    spawnExplosion(n.x, .5, n.z, .55);
    // The blast's feel reaches as far as its light does.
    if (distToPlayer < 7) feedback('large', n.x, .6, n.z);
    else if (distToPlayer < 15) feedback('medium', n.x, .6, n.z);
    for (const a of G.actors) {
      if (!a.alive) continue;
      const chest = a.chestPos();
      const d = Math.hypot(chest.x - n.x, chest.z - n.z);
      if (d > 6.5) continue;
      if (!losClear(n.x, .6, n.z, chest.x, chest.y, chest.z, G.map.colliders, [], 0)) continue;
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
      const strength = dot > .25 ? 1 : dot > -.3 ? .45 : .12;
      const dur = strength * Math.max(.4, 3.4 - d * .16);
      a.blindUntil = Math.max(a.blindUntil, G.time + dur);
      if (a.isPlayer) G.flashTime = Math.max(G.flashTime, dur);
    }
  } else { // smoke
    sfxSmoke();
    const visual = spawnSmokeVisual(G.scene, n.x, n.z);
    G.smokes.push({ x: n.x, z: n.z, r: 2.7, until: G.time + 13, visual });
  }
}

// ---- Gun models --------------------------------------------------------------

// Modelled guns, declared as part lists: ['b',w,h,d,x,y,z,mat,rx?] is
// a box, ['c',r,len,x,y,z,mat] a cylinder along the barrel. Materials:
// 0 gunmetal, 1 dark furniture, 2 wood accent, 3 the lit sight dot.
const GUN_PARTS = {
  p9: [
    ['b',.05,.09,.24,0,0,0,0],['b',.045,.12,.07,0,-.09,.07,1],
    ['b',.012,.012,.012,0,.052,-.1,3],
  ],
  scatter: [
    ['b',.06,.09,.62,0,0,-.08,0],['c',.028,.34,0,-.045,-.2,1],
    ['b',.05,.05,.3,0,-.055,-.18,2],['b',.045,.13,.07,0,-.1,.16,1],
    ['b',.014,.014,.014,0,.055,-.36,3],
  ],
  raptor: [
    ['b',.055,.11,.46,0,0,-.04,0],['c',.055,.07,0,-.12,.02,1],
    ['b',.045,.05,.18,0,.01,.3,1],['b',.03,.05,.05,0,.085,-.06,1],
    ['b',.012,.012,.012,0,.09,-.06,3],
  ],
  needle: [
    ['b',.05,.09,.78,0,0,-.14,0],['c',.02,.52,0,.01,-.32,1],
    ['c',.032,.2,0,.01,-.62,0],['b',.04,.14,.06,0,-.12,.05,1,.18],
    ['b',.05,.06,.1,0,.09,-.05,1],['b',.012,.012,.012,0,.095,-.05,3],
  ],
  farshot: [
    ['b',.055,.1,.95,0,0,-.22,0],['c',.016,.62,0,.015,-.44,1],
    ['c',.03,.24,0,.015,-.78,0],['b',.045,.15,.06,0,-.13,.08,1,.15],
    ['b',.045,.07,.16,0,.1,-.08,1],['c',.026,.05,0,.1,-.17,1],
    ['b',.012,.012,.012,0,.1,-.02,3],
  ],
  meridian: [
    ['b',.055,.11,.56,0,0,-.08,0],['b',.04,.05,.26,0,.005,-.42,1],
    ['c',.018,.2,0,.01,-.5,1],['b',.042,.17,.06,0,-.14,.03,1,.16],
    ['b',.045,.13,.07,0,-.1,.2,1],['b',.05,.045,.09,0,.085,-.04,1],
    ['b',.014,.014,.014,0,.09,-.04,3],
  ],
};

export function buildGunMesh(defId, viewmodel) {
  const group = new THREE.Group();
  const mats = [
    new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: .45, metalness: .6 }),
    new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: .7, metalness: .3 }),
    new THREE.MeshStandardMaterial({ color: 0x8a5a20, roughness: .55, metalness: .4 }),
    new THREE.MeshBasicMaterial({ color: 0xff4a3c }),
  ];
  for (const p of GUN_PARTS[defId] ?? GUN_PARTS.meridian) {
    let m;
    if (p[0] === 'b') {
      m = new THREE.Mesh(new THREE.BoxGeometry(p[1], p[2], p[3]), mats[p[7]]);
      m.position.set(p[4], p[5], p[6]);
      if (p[8]) m.rotation.x = p[8];
    } else {
      m = new THREE.Mesh(new THREE.CylinderGeometry(p[1], p[1], p[2], 10), mats[p[6]]);
      m.rotation.x = Math.PI / 2;
      m.position.set(p[3], p[4], p[5]);
    }
    group.add(m);
  }
  group.scale.setScalar(viewmodel ? 1 : .62);
  return group;
}
