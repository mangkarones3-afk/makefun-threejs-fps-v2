// actors.js — the Actor: body, health, weapons, movement, hit tests, damage.

import * as THREE from 'three';
import { MOVE, TEAMS, ECONOMY } from './config.js';
import { G } from './state.js';
import { moveCircle, raySphere, rayAABB, clamp } from './physics.js';
import { WeaponInst, buildGunMesh } from './weapons.js';
import { sfxHurt } from './audio.js';
import { spawnDust } from './effects.js';
import { playerHurtFlash } from './feedback.js';
import { RIM_FRAG_CHUNK } from './shaders.js';

const BOT_NAMES = {
  atk: ['Vex', 'Onyx', 'Rook', 'Sable', 'Flint'],
  def: ['Hale', 'Moss', 'Tarn', 'Vigil', 'Corin'],
};

let nextId = 1;

export class Actor {
  constructor(team, slot, isPlayer = false) {
    this.id = nextId++;
    this.team = team;
    this.name = isPlayer ? 'You' : BOT_NAMES[team][slot % BOT_NAMES[team].length];
    this.isPlayer = isPlayer;
    this.pos = { x: 0, y: 0, z: 0 }; // feet
    this.vel = { x: 0, z: 0 };
    this.vy = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.recoilPitch = 0;
    this.crouch = false;
    this.grounded = true;
    this.speedNow = 0;
    this.alive = true;
    this.hp = 100;
    this.armor = 0;
    this.helmet = false;
    this.money = 0;
    this.kills = 0;
    this.deaths = 0;
    this.pistol = new WeaponInst('p9');
    this.primary = null;
    this.current = this.pistol;
    this.grenades = [];
    this.triggerHeld = false;
    this.triggerEdge = false; // pressed this step (semi-automatics)
    this.drawUntil = 0;
    this.wantPlant = false;
    this.wantDefuse = false;
    this.blindUntil = 0;
    this.flashT = 0; // hit-flash amount on the mesh, decayed in syncMesh
    this.lastAttacker = null;
    this.lastHurtAt = -9;
    this.hurtFromYaw = 0;
    this.stepAcc = 0;
    this.shotsFired = 0;
    this.mesh = null;
    this.gunMesh = null;
    this.brain = null;
    this.deathAt = 0;
  }

  eyePos() {
    const h = this.crouch ? MOVE.eyeCrouch : MOVE.eyeStand;
    return { x: this.pos.x, y: this.pos.y + h, z: this.pos.z };
  }

  chestPos() {
    return { x: this.pos.x, y: this.pos.y + (this.crouch ? .75 : 1.05), z: this.pos.z };
  }

  get blind() {
    return G.time < this.blindUntil;
  }

  // Ray test against head sphere and body box; the nearer hit wins.
  hitTest(origin, dir, maxT) {
    const headY = this.pos.y + (this.crouch ? 1.16 : 1.58);
    const th = raySphere(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z,
      this.pos.x, headY, this.pos.z, .21);
    const bodyH = this.crouch ? 1.0 : 1.42;
    const tb = rayAABB(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z,
      this.pos.x, this.pos.y + bodyH / 2, this.pos.z, .34, bodyH / 2, .34);
    if (th < tb && th < maxT) return { t: th, part: 'head' };
    if (tb < maxT) return { t: tb, part: 'body' };
    return null;
  }

  // Armour soaks half of what it blocks and pays point for point: a
  // vest covers the body, a helmet extends the cover to the head.
  // Uncovered hits land at full price.
  takeDamage(amount, part, attacker) {
    if (!this.alive || G.phase !== 'live') return;
    let dmg = amount;
    if (this.armor > 0) {
      const covered = part === 'body' || (part === 'head' && this.helmet);
      if (covered) {
        const soaked = dmg * .5;
        this.armor = Math.max(0, this.armor - soaked);
        dmg -= soaked;
      }
    }
    this.hp -= dmg;
    this.lastAttacker = attacker;
    this.lastHurtAt = G.time;
    this.flashT = 1;
    if (attacker) {
      this.hurtFromYaw = Math.atan2(-(attacker.pos.x - this.pos.x), -(attacker.pos.z - this.pos.z));
    }
    if (this.isPlayer) {
      sfxHurt();
      playerHurtFlash(Math.min(1, dmg / 45));
    }
    if (this.hp <= 0) {
      this.hp = 0;
      this.die(attacker, part);
    }
  }

  die(attacker, part) {
    this.alive = false;
    this.deaths++;
    this.deathAt = G.time;
    this.triggerHeld = false;
    if (attacker && attacker !== this) {
      attacker.kills++;
      attacker.money = Math.min(ECONOMY.maxMoney, attacker.money + ECONOMY.killReward);
    }
    G.events.push({ type: 'kill', victim: this, attacker, part });
    // The charge drops where its carrier falls.
    if (G.charge && G.charge.carrier === this) {
      G.charge.state = 'dropped';
      G.charge.carrier = null;
      G.charge.x = this.pos.x;
      G.charge.z = this.pos.z;
      G.events.push({ type: 'chargeDropped', x: this.pos.x, z: this.pos.z });
    }
    if (this.mesh) {
      this.mesh.rotation.z = Math.PI / 2;
      this.mesh.position.y = .25;
    }
    spawnDust(this.pos.x, .35, this.pos.z, 2, 0xb2a08a, 1.1);
  }

  // Back to spawn for a new round. Survivors keep their primary (and
  // their armour and grenades — rounds.js strips the dead before this).
  respawn(spawn, keepPrimary) {
    this.pos.x = spawn.x;
    this.pos.z = spawn.z;
    this.pos.y = 0;
    this.vel.x = 0; this.vel.z = 0;
    this.vy = 0;
    this.yaw = spawn.yaw;
    this.pitch = 0;
    this.recoilPitch = 0;
    this.crouch = false;
    this.alive = true;
    this.hp = 100;
    this.triggerHeld = false;
    this.triggerEdge = false;
    this.wantPlant = false;
    this.wantDefuse = false;
    this.blindUntil = 0;
    if (!keepPrimary) this.primary = null;
    for (const w of [this.primary, this.pistol]) {
      if (w) { w.mag = w.def.mag; w.reserve = w.def.reserve; }
    }
    this.current = this.primary ?? this.pistol;
    this.refreshGunMesh();
    if (this.mesh) {
      this.mesh.rotation.z = 0;
      this.mesh.position.set(this.pos.x, 0, this.pos.z);
      this.mesh.visible = true;
    }
    if (this.brain) this.brain.reset();
  }

  giveWeapon(defId) {
    const inst = new WeaponInst(defId);
    if (inst.def.slot === 'primary') this.primary = inst;
    else this.pistol = inst;
    this.current = inst;
    this.refreshGunMesh();
    return inst;
  }

  refreshGunMesh() {
    if (!this.mesh) return;
    if (this.gunMesh) this.mesh.remove(this.gunMesh);
    this.gunMesh = buildGunMesh(this.current.def.id, false);
    this.gunMesh.position.set(.25, 1.27, -.33);
    this.gunMesh.rotation.y = Math.PI;
    this.mesh.add(this.gunMesh);
  }

  // Steer: wishX/wishZ is the wanted direction, speedCap the wanted
  // top speed. Acceleration closes the velocity gap.
  move(wishX, wishZ, speedCap, dt) {
    const wishLen = Math.hypot(wishX, wishZ);
    let tx = 0, tz = 0;
    if (wishLen > .01) {
      tx = (wishX / wishLen) * speedCap;
      tz = (wishZ / wishLen) * speedCap;
    }
    const accel = this.grounded ? MOVE.accel : MOVE.airAccel;
    const step = accel * dt;
    const dx = tx - this.vel.x;
    const dz = tz - this.vel.z;
    const dl = Math.hypot(dx, dz);
    if (dl > step) {
      this.vel.x += (dx / dl) * step;
      this.vel.z += (dz / dl) * step;
    } else {
      this.vel.x = tx;
      this.vel.z = tz;
    }
    const beforeX = this.pos.x;
    const beforeZ = this.pos.z;
    moveCircle(this.pos, this.vel.x * dt, this.vel.z * dt, MOVE.radius, G.map.colliders);
    // Vertical: only the player jumps, but gravity applies to everyone.
    if (!this.grounded || this.vy !== 0) {
      this.vy -= MOVE.gravity * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= 0) {
        this.pos.y = 0;
        this.vy = 0;
        this.grounded = true;
      }
    }
    const movedX = this.pos.x - beforeX;
    const movedZ = this.pos.z - beforeZ;
    this.speedNow = dt > 0 ? Math.hypot(movedX, movedZ) / dt : 0;
  }

  syncMesh() {
    if (!this.mesh) return;
    this.mesh.position.set(this.pos.x, this.pos.y, this.pos.z);
    if (this.alive) this.mesh.rotation.y = this.yaw;
    const target = this.crouch ? .74 : 1; // crouch compresses the body
    this.mesh.scale.y += (target - this.mesh.scale.y) * .35;
    // Hit flash: the uniform's emissive decays back to black.
    if (this.flashT > 0 && this.uniformMat) {
      this.flashT = Math.max(0, this.flashT - .09);
      const f = this.flashT;
      this.uniformMat.emissive.setRGB(f * .85, f * .22, f * .16);
    }
    if (this.vestMesh) this.vestMesh.visible = this.armor > 0;
    if (this.helmetMesh) this.helmetMesh.visible = this.helmet;
  }
}

// A modelled soldier from primitives: boots and shins, thighs and knee
// pads, a chest rig with pouches and a radio, arms rolled onto the gun,
// a helmeted head, a backpack — and lit team strips, because at night
// the strips are what read as friend or foe. The uniform material
// carries a fresnel rim in the team colour (see shaders.js).
export function buildActorMesh(actor) {
  const team = TEAMS[actor.team];
  const group = new THREE.Group();
  const uniform = new THREE.MeshStandardMaterial({ color: team.color, roughness: .85, metalness: .05 });
  uniform.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = { value: new THREE.Color(team.color) };
    shader.fragmentShader = 'uniform vec3 uRimColor;\n' + shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n' + RIM_FRAG_CHUNK,
    );
  };
  uniform.customProgramCacheKey = () => 'yardline-rim';
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: .9, metalness: .1 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc9a186, roughness: .6 });
  const shell = new THREE.MeshStandardMaterial({ color: 0x33373d, roughness: .5, metalness: .35 });
  actor.uniformMat = uniform;
  // Part-list materials: 0 uniform, 1 dark kit, 2 skin, 3 shell, 4 strip.
  const mats = [uniform, dark, skin, shell, new THREE.MeshBasicMaterial({ color: team.color })];
  const add = (geo, mat, x, y, z, rx = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (rx) m.rotation.x = rx;
    m.castShadow = true;
    group.add(m);
    return m;
  };
  const part = (w, h, d, mat, x, y, z, rx = 0) => add(new THREE.BoxGeometry(w, h, d), mats[mat], x, y, z, rx);
  for (const sx of [-1, 1]) { // legs: boot, shin, thigh, knee pad
    part(.16, .14, .28, 1, sx * .13, .07, -.03);
    part(.15, .41, .17, 1, sx * .13, .345, 0);
    part(.17, .37, .19, 0, sx * .13, .735, 0);
    part(.16, .15, .05, 1, sx * .13, .52, -.11);
  }
  // [w,h,d,mat,x,y,z,rx?] — pelvis, torso, chest rig with pouches and
  // a radio, backpack, shoulders, arms on the gun, helmet furniture,
  // and the lit team strips across chest, back and shoulder.
  const PARTS = [
    [.46,.17,.28,1,0,1.0,0],[.52,.45,.30,0,0,1.3,0],[.56,.36,.35,1,0,1.31,0],
    [.12,.17,.06,1,-.15,1.24,-.2],[.12,.17,.06,1,0,1.24,-.2],[.12,.17,.06,1,.15,1.24,-.2],
    [.11,.15,.06,3,-.19,1.42,-.19],[.4,.44,.16,1,0,1.32,.24],
    [.21,.12,.23,0,-.36,1.49,0],[.21,.12,.23,0,.36,1.49,0],
    [.13,.34,.15,0,-.37,1.29,0],[.13,.34,.15,0,.37,1.29,0],
    [.12,.34,.13,1,.36,1.16,-.14,-1.15],[.12,.34,.13,1,-.24,1.14,-.2,-1.25],
    [.37,.035,.37,3,0,1.645,0],[.31,.07,.31,1,0,1.7,0],
    [.42,.055,.02,4,0,1.44,-.185],[.42,.055,.02,4,0,1.44,.33],[.02,.13,.13,4,-.445,1.31,0],
  ];
  for (const p of PARTS) part(p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7] ?? 0);
  add(new THREE.SphereGeometry(.145, 12, 10), skin, 0, 1.62, 0); // face
  const helm = add(new THREE.SphereGeometry(.168, 12, 10), shell, 0, 1.665, 0);
  helm.scale.y = .8;
  // Bought gear, toggled by syncMesh.
  actor.vestMesh = add(new THREE.BoxGeometry(.6, .52, .4), new THREE.MeshStandardMaterial({ color: 0x3d4148, roughness: .85 }), 0, 1.31, 0);
  actor.vestMesh.visible = false;
  actor.helmetMesh = add(new THREE.BoxGeometry(.3, .09, .03), new THREE.MeshBasicMaterial({ color: 0x0d1420 }), 0, 1.63, -.145);
  actor.helmetMesh.visible = false;
  actor.mesh = group;
  actor.refreshGunMesh();
  return group;
}

export { clamp };
