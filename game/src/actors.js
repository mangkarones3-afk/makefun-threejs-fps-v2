// actors.js — the Actor: one body shared by the player and every bot.
// Position, health, armour, weapons, movement with acceleration and wall
// collision, hit tests (a head sphere over a body box) and damage with
// armour soak. The brain (bots.js) and the hands (player.js) only steer an
// Actor; the rules of being shot live here.

import * as THREE from 'three';
import { MOVE, TEAMS, ECONOMY } from './config.js';
import { G } from './state.js';
import { moveCircle, raySphere, rayAABB, clamp } from './physics.js';
import { WeaponInst, buildGunMesh } from './weapons.js';
import { sfxHurt } from './audio.js';
import { spawnDust } from './effects.js';

const BOT_NAMES = {
  atk: ['Vex', 'Onyx', 'Rook', 'Sable', 'Flint'],
  def: ['Hale', 'Moss', 'Tarn', 'Vigil', 'Corin'],
};

let nextId = 1;

export class Actor {
  constructor(team, slot, isPlayer = false) {
    this.id = nextId++; this.team = team;
    this.name = isPlayer ? 'You' : BOT_NAMES[team][slot % BOT_NAMES[team].length]; this.isPlayer = isPlayer;
    this.pos = { x: 0, y: 0, z: 0 }; // feet
    this.vel = { x: 0, z: 0 };
    this.vy = 0; this.yaw = 0;
    this.pitch = 0; this.recoilPitch = 0;
    this.crouch = false; this.grounded = true;
    this.speedNow = 0; this.alive = true;
    this.hp = 100; this.armor = 0;
    this.helmet = false; this.money = 0;
    this.kills = 0; this.deaths = 0;
    this.pistol = new WeaponInst('p9'); this.primary = null;
    this.current = this.pistol; this.grenades = [];
    this.triggerHeld = false;
    this.triggerEdge = false; // pressed this step (semi-automatics)
    this.blindUntil = 0;
    this.flashT = 0; // hit-flash amount on the mesh, decayed in syncMesh
    this.lastAttacker = null; this.lastHurtAt = -9;
    this.hurtFromYaw = 0; this.stepAcc = 0;
    this.mesh = null; this.gunMesh = null;
    this.brain = null; this.deathAt = 0;
  }

  eyePos() {
    const h = this.crouch ? MOVE.eyeCrouch : MOVE.eyeStand;
    return { x: this.pos.x, y: this.pos.y + h, z: this.pos.z };
  }

  chestPos() {
    return { x: this.pos.x, y: this.pos.y + (this.crouch ? 0.75 : 1.05), z: this.pos.z };
  }

  get blind() {
    return G.time < this.blindUntil;
  }

  // Ray test against head sphere and body box. Returns { t, part } for the
  // nearer hit within maxT, or null.
  hitTest(origin, dir, maxT) {
    const crouch = this.crouch; const headY = this.pos.y + (crouch ? 1.16 : 1.58);
    const th = raySphere(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, this.pos.x, headY, this.pos.z, 0.21);
    const bodyH = crouch ? 1.0 : 1.42;
    const tb = rayAABB(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z,
      this.pos.x, this.pos.y + bodyH / 2, this.pos.z, 0.34, bodyH / 2, 0.34);
    if (th < tb && th < maxT) return { t: th, part: 'head' };
    if (tb < maxT) return { t: tb, part: 'body' };
    return null;
  }

  takeDamage(amount, part, attacker) {
    if (!this.alive || G.phase !== 'live') return; let dmg = amount;
    if (this.armor > 0) {
      const covered = part === 'body' || (part === 'head' && this.helmet);
      if (covered) {
        const soaked = dmg * 0.5; this.armor = Math.max(0, this.armor - soaked);
        dmg -= soaked;
      }
    }
    this.hp -= dmg; this.lastAttacker = attacker;
    this.lastHurtAt = G.time;
    this.flashT = 1; // the mesh flashes hot for a beat (syncMesh decays it)
    if (attacker) {
      this.hurtFromYaw = Math.atan2(-(attacker.pos.x - this.pos.x), -(attacker.pos.z - this.pos.z));
    }
    if (this.isPlayer) {
      sfxHurt(); G.shake = Math.min(0.55, G.shake + 0.2);
    }
    if (this.hp <= 0) {
      this.hp = 0; this.die(attacker, part);
    }
  }

  die(attacker, part) {
    this.alive = false; this.deaths++;
    this.deathAt = G.time; this.triggerHeld = false;
    if (attacker && attacker !== this) {
      attacker.kills++; attacker.money = Math.min(ECONOMY.maxMoney, attacker.money + ECONOMY.killReward);
    }
    G.events.push({ type: 'kill', victim: this, attacker, part });
    // The charge drops where its carrier falls.
    if (G.charge && G.charge.carrier === this) {
      G.charge.state = 'dropped'; G.charge.carrier = null;
      G.charge.x = this.pos.x; G.charge.z = this.pos.z;
      G.events.push({ type: 'chargeDropped', x: this.pos.x, z: this.pos.z });
    }
    if (this.mesh) {
      this.mesh.rotation.z = Math.PI / 2; this.mesh.position.y = 0.25;
    }
    spawnDust(this.pos.x, 0.35, this.pos.z, 2, 0xb2a08a, 1.1); // the fall kicks up dust
  }

  // Full reset for a new round: back to spawn, full health, pistol kept,
  // primary kept only by survivors (rounds.js decides before calling).
  respawn(spawn, keepPrimary) {
    this.pos.x = spawn.x; this.pos.z = spawn.z;
    this.pos.y = 0; this.vel.x = 0; this.vel.z = 0;
    this.vy = 0; this.yaw = spawn.yaw;
    this.pitch = 0; this.recoilPitch = 0;
    this.crouch = false; this.alive = true;
    this.hp = 100; this.triggerHeld = false;
    this.blindUntil = 0; if (!keepPrimary) this.primary = null;
    if (this.primary) {
      this.primary.mag = this.primary.def.mag; this.primary.reserve = this.primary.def.reserve;
    }
    this.pistol.mag = this.pistol.def.mag; this.pistol.reserve = this.pistol.def.reserve;
    this.current = this.primary ?? this.pistol; this.refreshGunMesh();
    if (this.mesh) {
      this.mesh.rotation.z = 0; this.mesh.position.set(this.pos.x, 0, this.pos.z);
      this.mesh.visible = true;
    }
    if (this.brain) this.brain.reset();
  }

  giveWeapon(defId) {
    const inst = new WeaponInst(defId); if (inst.def.slot === 'primary') this.primary = inst;
    else this.pistol = inst; this.current = inst;
    this.refreshGunMesh(); return inst;
  }

  refreshGunMesh() {
    if (!this.mesh) return;
    if (this.gunMesh) {
      this.mesh.remove(this.gunMesh);
    }
    this.gunMesh = buildGunMesh(this.current.def.id, false); this.gunMesh.position.set(0.25, 1.27, -0.33);
    this.gunMesh.rotation.y = Math.PI; this.mesh.add(this.gunMesh);
  }

  // Steer: wishX/wishZ is the wanted direction (world, unnormalised ok),
  // speedCap the wanted top speed. Acceleration and friction do the rest,
  move(wishX, wishZ, speedCap, dt) {
    const wishLen = Math.hypot(wishX, wishZ); let tx = 0, tz = 0;
    if (wishLen > 0.01) {
      tx = (wishX / wishLen) * speedCap; tz = (wishZ / wishLen) * speedCap;
    }
    const accel = this.grounded ? MOVE.accel : MOVE.airAccel; const step = accel * dt;
    const dx = tx - this.vel.x, dz = tz - this.vel.z; const dl = Math.hypot(dx, dz);
    if (dl > step) {
      this.vel.x += (dx / dl) * step; this.vel.z += (dz / dl) * step;
    } else {
      this.vel.x = tx; this.vel.z = tz;
    }
    const beforeX = this.pos.x, beforeZ = this.pos.z;
    moveCircle(this.pos, this.vel.x * dt, this.vel.z * dt, MOVE.radius, G.map.colliders);
    // Vertical: only the player jumps, but gravity applies to everyone.
    if (!this.grounded || this.vy !== 0) {
      this.vy -= MOVE.gravity * dt; this.pos.y += this.vy * dt;
      if (this.pos.y <= 0) {
        this.pos.y = 0; this.vy = 0;
        this.grounded = true;
      }
    }
    const movedX = this.pos.x - beforeX, movedZ = this.pos.z - beforeZ;
    this.speedNow = dt > 0 ? Math.hypot(movedX, movedZ) / dt : 0;
  }

  syncMesh() {
    if (!this.mesh) return; this.mesh.position.set(this.pos.x, this.pos.y, this.pos.z);
    if (this.alive) this.mesh.rotation.y = this.yaw;
    // Crouch compresses the body.
    const target = this.crouch ? 0.74 : 1; this.mesh.scale.y += (target - this.mesh.scale.y) * 0.35;
    // Hit flash: the uniform's emissive decays back to black.
    if (this.flashT > 0 && this.uniformMat) {
      this.flashT = Math.max(0, this.flashT - 0.09); const f = this.flashT;
      this.uniformMat.emissive.setRGB(f * 0.85, f * 0.22, f * 0.16);
    }
    // Bought armour shows on the body.
    if (this.vestMesh) this.vestMesh.visible = this.armor > 0;
    if (this.helmetMesh) this.helmetMesh.visible = this.helmet;
  }
}

// Build a modelled soldier from primitives: boots, shins, thighs, knee
// pads, a chest rig with pouches and radio, arms rolled onto the gun, a
// helmeted head and a backpack — gear and glow read at night range.
export function buildActorMesh(actor) {
  const team = TEAMS[actor.team]; const group = new THREE.Group();
  const uniform = new THREE.MeshStandardMaterial({ color: team.color, roughness: 0.85, metalness: 0.05 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.9, metalness: 0.1 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc9a186, roughness: 0.6 });
  const shell = new THREE.MeshStandardMaterial({ color: 0x33373d, roughness: 0.5, metalness: 0.35 });
  actor.uniformMat = uniform;
  const add = (geo, mat, x, y, z, rx = 0) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z);
    if (rx) m.rotation.x = rx; m.castShadow = true;
    group.add(m); return m;
  };
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  for (const sx of [-1, 1]) { // legs: boot, shin, thigh, knee pad
    add(box(0.16, 0.14, 0.28), dark, sx * 0.13, 0.07, -0.03); add(box(0.15, 0.41, 0.17), dark, sx * 0.13, 0.345, 0);
    add(box(0.17, 0.37, 0.19), uniform, sx * 0.13, 0.735, 0);
    add(box(0.16, 0.15, 0.05), dark, sx * 0.13, 0.52, -0.11);
  }
  add(box(0.46, 0.17, 0.28), dark, 0, 1.0, 0); // pelvis
  add(box(0.52, 0.45, 0.30), uniform, 0, 1.3, 0); // torso
  add(box(0.56, 0.36, 0.35), dark, 0, 1.31, 0); // chest rig base
  for (const px of [-0.15, 0, 0.15]) add(box(0.12, 0.17, 0.06), dark, px, 1.24, -0.2); // mag pouches
  add(box(0.11, 0.15, 0.06), shell, -0.19, 1.42, -0.19); // radio
  add(box(0.4, 0.44, 0.16), dark, 0, 1.32, 0.24); // backpack
  for (const sx of [-1, 1]) { // shoulder pad + upper arm
    add(box(0.21, 0.12, 0.23), uniform, sx * 0.36, 1.49, 0); add(box(0.13, 0.34, 0.15), uniform, sx * 0.37, 1.29, 0);
  }
  add(box(0.12, 0.34, 0.13), dark, 0.36, 1.16, -0.14, -1.15); // right forearm, on the grip
  add(box(0.12, 0.34, 0.13), dark, -0.24, 1.14, -0.2, -1.25); // left forearm, under the fore-end
  // Head: face, a helmet shell with a brim, a headset band.
  add(new THREE.SphereGeometry(0.145, 12, 10), skin, 0, 1.62, 0);
  const helm = add(new THREE.SphereGeometry(0.168, 12, 10), shell, 0, 1.665, 0); helm.scale.y = 0.8;
  add(box(0.37, 0.035, 0.37), shell, 0, 1.645, 0); // brim
  add(box(0.31, 0.07, 0.31), dark, 0, 1.7, 0); // headset band
  // A lit team strip across the chest and back, and a shoulder patch:
  // at night the silhouette is dark, so these are what read as friend or foe.
  const stripMat = new THREE.MeshBasicMaterial({ color: team.color });
  add(box(0.42, 0.055, 0.02), stripMat, 0, 1.44, -0.185);
  add(box(0.42, 0.055, 0.02), stripMat, 0, 1.44, 0.33); // on the backpack's back face
  add(box(0.02, 0.13, 0.13), stripMat, -0.445, 1.31, 0);
  // Bought gear, toggled by syncMesh: a heavier plate over the rig and a
  // visor band across the face.
  actor.vestMesh = add(box(0.6, 0.52, 0.4), new THREE.MeshStandardMaterial({ color: 0x3d4148, roughness: 0.85 }), 0, 1.31, 0);
  actor.vestMesh.visible = false;
  actor.helmetMesh = add(box(0.3, 0.09, 0.03), new THREE.MeshBasicMaterial({ color: 0x0d1420 }), 0, 1.63, -0.145);
  actor.helmetMesh.visible = false; actor.mesh = group;
  actor.refreshGunMesh(); return group;
}

// Keep a number inside a range (shared helper re-exported for callers).
export { clamp };
