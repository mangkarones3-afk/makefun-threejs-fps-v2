// effects.js — short-lived visuals, all pooled: tracers with a hot core
// that fades, impact sparks and debris, dust puffs, muzzle flashes with a
// shared light, layered smoke, full explosions (flash, light, shockwave
// ring, debris, dust) and the breach charge model with its own pulsing
// light. Nothing here allocates per frame; pools are sized once at boot.

import * as THREE from 'three';
import { G } from './state.js';
import { glowTexture } from './textures.js';

const TRACERS = 40; const PARTICLES = 340;
const FLASHES = 10; const DUST = 26;
const BOOMS = 2;

let tracerPool = []; let flashPool = [];
let flashLight = null; let particleMesh = null;
let pPos, pVel, pLife, pMaxLife, pSize, pGrav; // per-particle data
let pCursor = 0; let dustPool = [];
let boomPool = []; let chargeMesh = null;
let chargeLightMesh = null; let chargeLight = null;
let smokeGroup = null;

const _v = new THREE.Vector3(); const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion(); const _s = new THREE.Vector3();
const _c = new THREE.Color();

function radialTexture(inner, outer) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grad.addColorStop(0, inner); grad.addColorStop(1, outer);
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function initEffects(scene) {
  // Tracers: an additive box with its own material each, so the core can
  // burn bright and fade inside its 70 ms of life.
  const tracerGeo = new THREE.BoxGeometry(0.035, 0.035, 1);
  for (let i = 0; i < TRACERS; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffc37a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.Mesh(tracerGeo, mat); mesh.visible = false;
    scene.add(mesh);
    tracerPool.push({ mesh, life: 0, maxLife: 0.07 });
  }

  const flashTex = radialTexture('rgba(255,224,160,1)', 'rgba(255,140,40,0)');
  for (let i = 0; i < FLASHES; i++) {
    const mat = new THREE.SpriteMaterial({ map: flashTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const spr = new THREE.Sprite(mat); spr.visible = false;
    scene.add(spr);
    flashPool.push({ spr, life: 0 });
  }
  flashLight = new THREE.PointLight(0xffb36b, 0, 10, 1.8); scene.add(flashLight);

  // Impact particles in one InstancedMesh: sparks fly flat and fast,
  // debris and flesh tumble under gravity.
  particleMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95 }),
    PARTICLES,
  ); particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  particleMesh.count = PARTICLES; particleMesh.frustumCulled = false;
  scene.add(particleMesh); pPos = new Float32Array(PARTICLES * 3);
  pVel = new Float32Array(PARTICLES * 3); pLife = new Float32Array(PARTICLES);
  pMaxLife = new Float32Array(PARTICLES); pSize = new Float32Array(PARTICLES);
  pGrav = new Float32Array(PARTICLES);
  for (let i = 0; i < PARTICLES; i++) {
    particleMesh.setColorAt(i, _c.setHex(0xffffff)); hideParticle(i);
  }
  if (particleMesh.instanceColor) particleMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);

  // Dust puffs: soft sprites that swell and thin.
  const dustTex = radialTexture('rgba(255,255,255,0.85)', 'rgba(255,255,255,0)');
  for (let i = 0; i < DUST; i++) {
    const mat = new THREE.SpriteMaterial({ map: dustTex, transparent: true, depthWrite: false, opacity: 0 });
    const spr = new THREE.Sprite(mat); spr.visible = false;
    scene.add(spr);
    dustPool.push({ spr, life: 0, maxLife: 1, vx: 0, vy: 0, vz: 0, s0: 1, s1: 2, o0: 0.3 });
  }

  // Explosions: a big additive flash, a hard light, and a shockwave ring
  // that runs across the ground.
  const glowTex = glowTexture();
  for (let i = 0; i < BOOMS; i++) {
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: 0xffc37a, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, opacity: 0,
    }));
    spr.visible = false; scene.add(spr);
    const light = new THREE.PointLight(0xff9a4d, 0, 30, 1.7); scene.add(light);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.86, 1, 40),
      new THREE.MeshBasicMaterial({
        color: 0xffd9a0, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }),
    ); ring.rotation.x = -Math.PI / 2;
    ring.visible = false; scene.add(ring);
    boomPool.push({ spr, light, ring, life: 0, scale: 1 });
  }

  smokeGroup = new THREE.Group(); scene.add(smokeGroup);
}

function hideParticle(i) {
  _m.makeScale(0, 0, 0); particleMesh.setMatrixAt(i, _m);
}

function emitParticle(x, y, z, vx, vy, vz, life, size, grav, color) {
  const i = pCursor; pCursor = (pCursor + 1) % PARTICLES;
  pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z;
  pVel[i * 3] = vx; pVel[i * 3 + 1] = vy; pVel[i * 3 + 2] = vz; pMaxLife[i] = life;
  pLife[i] = life; pSize[i] = size;
  pGrav[i] = grav; particleMesh.setColorAt(i, _c.setHex(color));
  if (particleMesh.instanceColor) particleMesh.instanceColor.needsUpdate = true;
}

export function spawnTracer(x0, y0, z0, x1, y1, z1) {
  for (const t of tracerPool) {
    if (t.life > 0) continue; t.life = t.maxLife;
    t.mesh.visible = true; t.mesh.material.opacity = 0.95;
    _v.set(x1 - x0, y1 - y0, z1 - z0); const len = _v.length();
    t.mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); t.mesh.scale.set(1, 1, len);
    t.mesh.lookAt(x1, y1, z1); return;
  }
}

export function spawnMuzzle(x, y, z) {
  for (const f of flashPool) {
    if (f.life > 0) continue; f.life = 0.05;
    f.spr.visible = true; const s = 0.5 + Math.random() * 0.3;
    f.spr.scale.set(s, s, 1); f.spr.position.set(x, y, z);
    f.spr.material.rotation = Math.random() * Math.PI; break;
  }
  flashLight.position.set(x, y, z); flashLight.intensity = 22;
  // One shot in three leaves a wisp of propellant smoke at the muzzle.
  if (Math.random() < 0.34) spawnDust(x, y + 0.05, z, 1, 0x9aa0a6, 0.4);
}

// Sparks where a bullet bites steel or concrete, a red bloom where it
// bites flesh, and a low dust kick-up either way.
export function spawnImpact(x, y, z, flesh) {
  if (flesh) {
    for (let n = 0; n < 8; n++) {
      emitParticle(x, y, z,
        (Math.random() - 0.5) * 2.6, Math.random() * 2.4 + 0.3, (Math.random() - 0.5) * 2.6,
        0.26 + Math.random() * 0.26, 0.05 + Math.random() * 0.05, 5.5,
        Math.random() < 0.5 ? 0xa12727 : 0x7e1d1d);
    }
  } else {
    for (let n = 0; n < 6; n++) { // sparks: fast, flat, barely fall
      emitParticle(x, y, z,
        (Math.random() - 0.5) * 5.2, Math.random() * 2.6 - 0.4, (Math.random() - 0.5) * 5.2,
        0.14 + Math.random() * 0.16, 0.028 + Math.random() * 0.03, 1.6,
        Math.random() < 0.5 ? 0xffd9a0 : 0xfff3d0);
    }
    for (let n = 0; n < 5; n++) { // debris chips
      emitParticle(x, y, z,
        (Math.random() - 0.5) * 2.4, Math.random() * 2.2 + 0.4, (Math.random() - 0.5) * 2.4,
        0.28 + Math.random() * 0.25, 0.04 + Math.random() * 0.06, 5.5, 0xb9b0a0);
    }
    spawnDust(x, Math.max(0.25, y - 0.3), z, 1, 0xb2a08a, 0.55);
  }
}

// Soft dust: footfalls, landings, a body going down, blast wash. colour is
// a hex tint; strength scales the puff's size.
export function spawnDust(x, y, z, count, color = 0xb2a08a, strength = 1) {
  for (let n = 0; n < count; n++) {
    for (const d of dustPool) {
      if (d.life > 0) continue; d.maxLife = 0.55 + Math.random() * 0.5;
      d.life = d.maxLife; d.spr.visible = true;
      d.spr.material.color.setHex(color);
      d.spr.position.set(
        x + (Math.random() - 0.5) * 0.5 * strength,
        y + Math.random() * 0.2,
        z + (Math.random() - 0.5) * 0.5 * strength,
      ); d.vx = (Math.random() - 0.5) * 0.7 * strength;
      d.vy = 0.35 + Math.random() * 0.5; d.vz = (Math.random() - 0.5) * 0.7 * strength;
      d.s0 = 0.55 * strength; d.s1 = (1.6 + Math.random() * 0.9) * strength;
      d.o0 = 0.30; d.spr.material.opacity = d.o0;
      const s = d.s0; d.spr.scale.set(s, s, 1);
      break;
    }
  }
}

// The full blast: flash, light, a ground shockwave, a debris fountain and
// a ring of dust. scale 1 is the breach charge; grenades call it smaller.
export function spawnExplosion(x, y, z, scale = 1) {
  for (const b of boomPool) {
    if (b.life > 0) continue; b.life = 0.5;
    b.scale = scale; b.spr.visible = true;
    b.spr.position.set(x, y + 0.4 * scale, z); const s = 7 * scale;
    b.spr.scale.set(s, s, 1); b.spr.material.opacity = 0.95;
    b.light.position.set(x, y + 0.8 * scale, z); b.light.intensity = 950 * scale;
    b.ring.visible = true; b.ring.position.set(x, 0.14, z);
    break;
  }
  const debris = Math.round(16 * scale);
  for (let n = 0; n < debris; n++) {
    const a = Math.random() * Math.PI * 2; const sp = (1.5 + Math.random() * 4.5) * scale;
    emitParticle(x, y + 0.3, z,
      Math.cos(a) * sp, 2 + Math.random() * 5 * scale, Math.sin(a) * sp,
      0.4 + Math.random() * 0.45, 0.05 + Math.random() * 0.07, 6.5,
      [0xffd9a0, 0xc9a06a, 0x8a7a68][n % 3]);
  }
  const ringDust = Math.max(2, Math.round(6 * scale));
  for (let n = 0; n < ringDust; n++) {
    const a = (n / ringDust) * Math.PI * 2;
    spawnDust(x + Math.cos(a) * 1.3 * scale, 0.4, z + Math.sin(a) * 1.3 * scale, 1, 0xa89478, 1.5 * scale);
  }
  spawnDust(x, y + 0.8 * scale, z, 2, 0x6f6a63, 1.8 * scale);
}

// A smoke cloud: a cluster of soft sprites that grows, hangs, and thins.
// The matching sight-blocker entry lives in G.smokes (state.js); this is
// only the visual half — the two are removed together.
const smokeTexHolder = { tex: null };
export function spawnSmokeVisual(scene, x, z) {
  if (!smokeTexHolder.tex) {
    smokeTexHolder.tex = radialTexture('rgba(198,202,208,0.55)', 'rgba(198,202,208,0)');
  }
  const group = new THREE.Group();
  for (let i = 0; i < 10; i++) {
    const mat = new THREE.SpriteMaterial({ map: smokeTexHolder.tex, transparent: true, depthWrite: false, opacity: 0.5 });
    const spr = new THREE.Sprite(mat); const a = (i / 10) * Math.PI * 2;
    spr.position.set(x + Math.cos(a) * 1.15, 0.9 + (i % 3) * 0.75, z + Math.sin(a) * 1.15);
    spr.scale.set(3.8, 3.8, 1); group.add(spr);
  }
  group.position.set(0, 0, 0); smokeGroup.add(group);
  return group;
}

export function removeSmokeVisual(group) {
  smokeGroup.remove(group);
}

export function chargeMeshRef() {
  return chargeMesh;
}

// The breach charge: a slab with a keypad, an antenna stub, and a light —
// mesh and a real point light — that blinks faster as the timer runs down.
export function buildChargeMesh(scene) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.46, 0.16, 0.34),
    new THREE.MeshStandardMaterial({ color: 0x2c2f26, roughness: 0.6, metalness: 0.3 }),
  ); body.position.y = 0.08;
  group.add(body);
  const pad = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.03, 0.2),
    new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.4, metalness: 0.4 }),
  ); pad.position.set(0, 0.17, 0);
  group.add(pad);
  const antenna = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, 0.3, 6),
    new THREE.MeshBasicMaterial({ color: 0x0c0d10 }),
  ); antenna.position.set(-0.18, 0.3, -0.12);
  group.add(antenna);
  chargeLightMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xff2222 }),
  ); chargeLightMesh.position.set(0.16, 0.18, 0.1);
  group.add(chargeLightMesh); chargeLight = new THREE.PointLight(0xff3333, 0, 8, 1.8);
  chargeLight.position.set(0, 0.35, 0); group.add(chargeLight);
  group.visible = false; scene.add(group);
  chargeMesh = group; return group;
}

export function updateEffects(dt) {
  for (const t of tracerPool) {
    if (t.life <= 0) continue; t.life -= dt;
    if (t.life <= 0) { t.mesh.visible = false; continue; }
    t.mesh.material.opacity = 0.95 * (t.life / t.maxLife);
  }
  for (const f of flashPool) {
    if (f.life <= 0) continue; f.life -= dt;
    if (f.life <= 0) f.spr.visible = false;
  }
  if (flashLight && flashLight.intensity > 0) {
    flashLight.intensity = Math.max(0, flashLight.intensity - dt * 380);
  }
  // Dust: drift, swell, thin.
  for (const d of dustPool) {
    if (d.life <= 0) continue; d.life -= dt;
    if (d.life <= 0) { d.spr.visible = false; continue; }
    const k = 1 - d.life / d.maxLife; d.spr.position.x += d.vx * dt;
    d.spr.position.y += d.vy * dt; d.spr.position.z += d.vz * dt;
    const s = d.s0 + (d.s1 - d.s0) * k; d.spr.scale.set(s, s, 1);
    d.spr.material.opacity = d.o0 * (1 - k);
  }
  // Explosions: flash shrinks, light crashes, the ring runs out and fades.
  for (const b of boomPool) {
    if (b.life <= 0) continue; b.life -= dt;
    if (b.life <= 0) {
      b.spr.visible = false; b.ring.visible = false;
      b.light.intensity = 0; continue;
    }
    const k = 1 - b.life / 0.5; b.spr.material.opacity = 0.95 * Math.max(0, 1 - k * 1.6);
    const fs = 7 * b.scale * (1 - k * 0.35); b.spr.scale.set(fs, fs, 1);
    b.light.intensity = 950 * b.scale * Math.max(0, 1 - k * 1.8); const rs = 0.5 + k * 8.5 * b.scale;
    b.ring.scale.set(rs, rs, 1); b.ring.material.opacity = 0.75 * (1 - k);
  }
  // Particles.
  let any = false;
  for (let i = 0; i < PARTICLES; i++) {
    if (pLife[i] <= 0) continue; any = true;
    pLife[i] -= dt;
    if (pLife[i] <= 0) { hideParticle(i); continue; }
    pVel[i * 3 + 1] -= pGrav[i] * dt; pPos[i * 3] += pVel[i * 3] * dt;
    pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt; pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
    if (pPos[i * 3 + 1] < 0.03) pPos[i * 3 + 1] = 0.03; const s = pSize[i] * (pLife[i] / pMaxLife[i]);
    _v.set(pPos[i * 3], pPos[i * 3 + 1], pPos[i * 3 + 2]); _q.identity();
    _s.set(s, s, s); _m.compose(_v, _q, _s);
    particleMesh.setMatrixAt(i, _m);
  }
  if (any || particleMesh.instanceMatrix.needsUpdate === false) {
    particleMesh.instanceMatrix.needsUpdate = true;
  }
  // Charge light blink: faster as detonation nears, and the point light
  // breathes with it once the charge is planted.
  if (chargeMesh && chargeMesh.visible && G.charge) {
    const planted = G.charge.state === 'planted';
    const rate = planted ? (G.charge.timer < 10 ? 9 : G.charge.timer < 25 ? 4.5 : 2.2) : 1.4;
    const on = (G.time * rate) % 1 < 0.55; chargeLightMesh.material.color.setHex(on ? 0xff2222 : 0x551111);
    if (chargeLight) chargeLight.intensity = planted && on ? 7 : 0;
  } else if (chargeLight) {
    chargeLight.intensity = 0;
  }
  // Smoke sprites breathe slowly.
  if (smokeGroup) {
    for (const group of smokeGroup.children) {
      group.rotation.y += dt * 0.05;
    }
  }
}
