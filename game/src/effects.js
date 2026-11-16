// effects.js — every short-lived visual, pooled at boot and recycled
// forever: tracers with a glowing halo, muzzle flashes with one shared
// light, impact sparks that fall and bounce, debris, dust, ejecting
// shell casings, rain drips, smoke, explosions and the breach charge.
// The hot loop allocates nothing; per-particle data lives in flat
// arrays, never in objects.

import * as THREE from 'three';
import { G } from './state.js';
import { glowTexture } from './textures.js';

const TRACER_N = 44, PARTICLE_N = 380, CASING_N = 40, FLASH_N = 12, BOOM_N = 2;

let tracers = [], flashes = [], booms = [];
let flashLight = null, particleMesh = null, casingMesh = null;
let pPos, pVel, pLife, pSpan, pSize, pGrav, pBounce, pCursor = 0;
let cPos, cVel, cRot, cSpin, cLife, cCursor = 0;
let smokeGroup = null, chargeMesh = null, chargeLampMesh = null, chargeLight = null;
let dripMesh = null, dripData = null;

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _s = new THREE.Vector3(), _m = new THREE.Matrix4(), _c = new THREE.Color();



function addSprite(scene, mat) {
  const spr = new THREE.Sprite(mat);
  spr.visible = false;
  scene.add(spr);
  return spr;
}

export function initEffects(scene) {
  // Tracers: a hot core box wrapped in a wider, fainter halo box.
  const coreGeo = new THREE.BoxGeometry(.03, .03, 1);
  const haloGeo = new THREE.BoxGeometry(.1, .1, 1);
  const tracerMat = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
  for (let i = 0; i < TRACER_N; i++) {
    const group = new THREE.Group();
    const core = new THREE.Mesh(coreGeo, tracerMat(0xffd9a0, 0));
    const halo = new THREE.Mesh(haloGeo, tracerMat(0xff9a3e, 0));
    group.add(core); group.add(halo);
    group.visible = false;
    scene.add(group);
    tracers.push({ group, core, halo, life: 0, span: .075 });
  }
  const flashTex = glowTexture();
  for (let i = 0; i < FLASH_N; i++) {
    const spr = addSprite(scene, new THREE.SpriteMaterial({ map: flashTex, color: 0xffc37a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    flashes.push({ spr, life: 0 });
  }
  flashLight = new THREE.PointLight(0xffb36b, 0, 11, 1.8);
  scene.add(flashLight);
  particleMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ transparent: true, opacity: .95 }), PARTICLE_N);
  particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  particleMesh.frustumCulled = false;
  scene.add(particleMesh);
  pPos = new Float32Array(PARTICLE_N * 3); pVel = new Float32Array(PARTICLE_N * 3);
  pLife = new Float32Array(PARTICLE_N); pSpan = new Float32Array(PARTICLE_N);
  pSize = new Float32Array(PARTICLE_N); pGrav = new Float32Array(PARTICLE_N);
  pBounce = new Float32Array(PARTICLE_N);
  for (let i = 0; i < PARTICLE_N; i++) { particleMesh.setColorAt(i, _c.setHex(0xffffff)); hideParticle(i); }
  if (particleMesh.instanceColor) particleMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  casingMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(.021, .021, .052), new THREE.MeshStandardMaterial({ color: 0xc9a24d, roughness: .35, metalness: .8 }), CASING_N);
  casingMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  casingMesh.frustumCulled = false;
  scene.add(casingMesh);
  cPos = new Float32Array(CASING_N * 3); cVel = new Float32Array(CASING_N * 3);
  cRot = new Float32Array(CASING_N * 3); cSpin = new Float32Array(CASING_N * 3);
  cLife = new Float32Array(CASING_N);
  for (let i = 0; i < CASING_N; i++) hideCasing(i);
  const glowTex = glowTexture();
  for (let i = 0; i < BOOM_N; i++) {
    const spr = addSprite(scene, new THREE.SpriteMaterial({ map: glowTex, color: 0xffc37a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    const light = new THREE.PointLight(0xff9a4d, 0, 30, 1.7);
    scene.add(light);
    booms.push({ spr, light, life: 0, scale: 1 });
  }
  smokeGroup = new THREE.Group();
  scene.add(smokeGroup);
}

function hideParticle(i) { _m.makeScale(0, 0, 0); particleMesh.setMatrixAt(i, _m); }
function hideCasing(i) { _m.makeScale(0, 0, 0); casingMesh.setMatrixAt(i, _m); }

function emit(x, y, z, vx, vy, vz, life, size, grav, color, bounce) {
  const i = pCursor;
  pCursor = (pCursor + 1) % PARTICLE_N;
  pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z;
  pVel[i * 3] = vx; pVel[i * 3 + 1] = vy; pVel[i * 3 + 2] = vz;
  pLife[i] = life; pSpan[i] = life; pSize[i] = size; pGrav[i] = grav; pBounce[i] = bounce;
  particleMesh.setColorAt(i, _c.setHex(color));
  if (particleMesh.instanceColor) particleMesh.instanceColor.needsUpdate = true;
}

export function spawnTracer(x0, y0, z0, x1, y1, z1) {
  for (const t of tracers) {
    if (t.life > 0) continue;
    t.life = t.span;
    t.group.visible = true;
    t.core.material.opacity = .88;
    t.halo.material.opacity = .14;
    _v.set(x1 - x0, y1 - y0, z1 - z0);
    const len = Math.max(.1, _v.length());
    t.group.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    t.group.scale.set(1, 1, len);
    t.group.lookAt(x1, y1, z1);
    return;
  }
}

export function spawnMuzzle(x, y, z) {
  for (const f of flashes) {
    if (f.life > 0) continue;
    f.life = .05;
    f.spr.visible = true;
    const s = .5 + Math.random() * .3;
    f.spr.scale.set(s, s, 1);
    f.spr.position.set(x, y, z);
    f.spr.material.rotation = Math.random() * Math.PI;
    break;
  }
  // The shared light pulses to full, then falls off exponentially.
  flashLight.position.set(x, y, z);
  flashLight.intensity = 26;
  if (Math.random() < .3) spawnDust(x, y + .05, z, 1, 0x9aa0a6, .4);
}

// A casing leaves the ejection port: up and out to the shooter's
// right, tumbling, to bounce once on the concrete and lie a moment.
export function spawnCasing(x, y, z, rightX, rightZ) {
  const i = cCursor;
  cCursor = (cCursor + 1) % CASING_N;
  cPos[i * 3] = x; cPos[i * 3 + 1] = y; cPos[i * 3 + 2] = z;
  cVel[i * 3] = rightX * (.9 + Math.random() * .7) + (Math.random() - .5) * .3;
  cVel[i * 3 + 1] = 1.5 + Math.random() * .7;
  cVel[i * 3 + 2] = rightZ * (.9 + Math.random() * .7) + (Math.random() - .5) * .3;
  cRot[i * 3] = Math.random() * 3; cRot[i * 3 + 1] = Math.random() * 3; cRot[i * 3 + 2] = Math.random() * 3;
  cSpin[i * 3] = (Math.random() - .5) * 22; cSpin[i * 3 + 1] = (Math.random() - .5) * 22; cSpin[i * 3 + 2] = (Math.random() - .5) * 22;
  cLife[i] = 1.15;
}

// Where a bullet lands: sparks that skip off the ground when they fall
// back to it, debris chips that bounce once, a red bloom for flesh.
export function spawnImpact(x, y, z, flesh) {
  if (flesh) {
    for (let n = 0; n < 8; n++) {
      emit(x, y, z, (Math.random() - .5) * 2.6, Math.random() * 2.4 + .3, (Math.random() - .5) * 2.6, .26 + Math.random() * .26, .05 + Math.random() * .05, 5.5, Math.random() < .5 ? 0xa12727 : 0x7e1d1d, 0);
    }
    return;
  }
  for (let n = 0; n < 6; n++) {
    emit(x, y, z, (Math.random() - .5) * 5.4, Math.random() * 2.8 - .4, (Math.random() - .5) * 5.4, .16 + Math.random() * .2, .026 + Math.random() * .03, 6.5, Math.random() < .5 ? 0xffd9a0 : 0xfff3d0, 2);
  }
  for (let n = 0; n < 5; n++) {
    emit(x, y, z, (Math.random() - .5) * 2.4, Math.random() * 2.2 + .4, (Math.random() - .5) * 2.4, .3 + Math.random() * .28, .04 + Math.random() * .06, 6.0, 0xb9b0a0, 1);
  }
  spawnDust(x, Math.max(.25, y - .3), z, 1, 0xb2a08a, .55);
}

// The feedback system's burst: a tiered spray of sparks at a point — a
// kill confirmed in the world, not just on the HUD.
export function spawnBurst(x, y, z, count, tier) {
  const speed = tier === 'large' ? 5.2 : tier === 'medium' ? 3.8 : 2.6;
  for (let n = 0; n < count; n++) {
    const a = Math.random() * Math.PI * 2;
    const sp = (.3 + Math.random() * .7) * speed;
    emit(x, y, z, Math.cos(a) * sp, Math.random() * speed * .9 + .4, Math.sin(a) * sp, .3 + Math.random() * .35, .03 + Math.random() * .045, 6.2, n % 3 === 0 ? 0xfff3d0 : 0xffc37a, 1);
  }
  if (tier === 'large') {
    flashLight.position.set(x, y + .3, z);
    flashLight.intensity = 60;
    spawnDust(x, Math.max(.3, y), z, 2, 0xa89478, 1.3);
  }
}

// Dust rides the particle pool: slow, heavy motes that hang a moment
// where a bullet struck or a blast kicked the ground up.
export function spawnDust(x, y, z, count, color = 0xb2a08a, strength = 1) {
  for (let n = 0; n < count; n++) {
    emit(x + (Math.random() - .5) * .5 * strength, y + Math.random() * .2, z + (Math.random() - .5) * .5 * strength,
      (Math.random() - .5) * .7 * strength, .35 + Math.random() * .5, (Math.random() - .5) * .7 * strength,
      .55 + Math.random() * .5, .15 * strength, .3, color, 0);
  }
}

// The full blast: flash, light, a debris fountain and a ring of
// dust. Grenades call it at .55 scale.
export function spawnExplosion(x, y, z, scale = 1) {
  for (const b of booms) {
    if (b.life > 0) continue;
    b.life = .5;
    b.scale = scale;
    b.spr.visible = true;
    b.spr.position.set(x, y + .4 * scale, z);
    const s = 7 * scale;
    b.spr.scale.set(s, s, 1);
    b.spr.material.opacity = .95;
    b.light.position.set(x, y + .8 * scale, z);
    b.light.intensity = 950 * scale;
    break;
  }
  const debris = Math.round(16 * scale);
  for (let n = 0; n < debris; n++) {
    const a = Math.random() * Math.PI * 2;
    const sp = (1.5 + Math.random() * 4.5) * scale;
    emit(x, y + .3, z, Math.cos(a) * sp, 2 + Math.random() * 5 * scale, Math.sin(a) * sp, .4 + Math.random() * .45, .05 + Math.random() * .07, 6.5, [0xffd9a0, 0xc9a06a, 0x8a7a68][n % 3], 1);
  }
  const ringDust = Math.max(2, Math.round(6 * scale));
  for (let n = 0; n < ringDust; n++) {
    const a = (n / ringDust) * Math.PI * 2;
    spawnDust(x + Math.cos(a) * 1.3 * scale, .4, z + Math.sin(a) * 1.3 * scale, 1, 0xa89478, 1.5 * scale);
  }
  spawnDust(x, y + .8 * scale, z, 2, 0x6f6a63, 1.8 * scale);
}

// Smoke: soft sprites that hang and slowly turn. The sight-blocking
// half lives in G.smokes; this is only the visual.
const smokeTexHolder = { tex: null };
export function spawnSmokeVisual(scene, x, z) {
  if (!smokeTexHolder.tex) smokeTexHolder.tex = glowTexture();
  const group = new THREE.Group();
  for (let i = 0; i < 10; i++) {
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTexHolder.tex, color: 0xc6cad0, transparent: true, depthWrite: false, opacity: .34 }));
    const a = (i / 10) * Math.PI * 2;
    spr.position.set(x + Math.cos(a) * 2.3, .9 + (i % 3) * .75, z + Math.sin(a) * 2.3);
    spr.scale.set(3.0, 3.0, 1);
    group.add(spr);
  }
  (smokeGroup ?? scene).add(group);
  return group;
}

export function removeSmokeVisual(group) {
  if (smokeGroup) smokeGroup.remove(group);
}

export function chargeMeshRef() { return chargeMesh; }

// The breach charge: slab, keypad, antenna, and a lamp — mesh and real
// light — that blinks faster as the timer runs down.
export function buildChargeMesh(scene) {
  const group = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x2c2f26, roughness: .6, metalness: .3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: .4, metalness: .4 });
  const add = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    group.add(m);
    return m;
  };
  add(new THREE.BoxGeometry(.46, .16, .34), steel, 0, .08, 0);
  add(new THREE.BoxGeometry(.2, .03, .2), dark, 0, .17, 0);
  add(new THREE.CylinderGeometry(.012, .012, .3, 6), new THREE.MeshBasicMaterial({ color: 0x0c0d10 }), -.18, .3, -.12);
  chargeLampMesh = add(new THREE.SphereGeometry(.035, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff2222 }), .16, .18, .1);
  chargeLight = new THREE.PointLight(0xff3333, 0, 8, 1.8);
  chargeLight.position.set(0, .35, 0);
  group.add(chargeLight);
  group.visible = false;
  scene.add(group);
  chargeMesh = group;
  return group;
}

// Rain drips off hard edges: each anchor grows a bead, lets it fall,
// and starts again on its own slow clock. Anchors come from the map.
export function initDrips(scene, points) {
  const n = Math.min(points.length, 48);
  dripMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(.016, 1, .016), new THREE.MeshBasicMaterial({ color: 0x9fc4e8, transparent: true, opacity: .55 }), n);
  dripMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  dripMesh.frustumCulled = false;
  scene.add(dripMesh);
  dripData = [];
  for (let i = 0; i < n; i++) {
    dripData.push({ x: points[i].x, y: points[i].y, z: points[i].z, phase: Math.random() * 2.4, cycle: 1.1 + Math.random() * 1.6, dropY: 0, vy: 0, falling: false });
    _m.makeScale(0, 0, 0);
    dripMesh.setMatrixAt(i, _m);
  }
}

function updateDrips(dt) {
  if (!dripMesh || !dripData) return;
  for (let i = 0; i < dripData.length; i++) {
    const d = dripData[i];
    d.phase += dt;
    if (!d.falling) {
      const k = Math.min(1, d.phase / d.cycle);
      const len = .05 + k * .3;
      _v.set(d.x, d.y - len / 2, d.z);
      _q.identity();
      _s.set(1, len, 1);
    } else {
      d.vy += 16 * dt;
      d.dropY -= d.vy * dt;
      if (d.dropY <= .06) {
        d.falling = false;
        d.phase = 0;
        d.cycle = 1.1 + Math.random() * 1.8;
        _m.makeScale(0, 0, 0);
        dripMesh.setMatrixAt(i, _m);
        continue;
      }
      _v.set(d.x, d.dropY, d.z);
      _q.identity();
      _s.set(1, .24, 1);
    }
    _m.compose(_v, _q, _s);
    dripMesh.setMatrixAt(i, _m);
  }
  dripMesh.instanceMatrix.needsUpdate = true;
}

export function updateEffects(dt) {
  for (const t of tracers) {
    if (t.life <= 0) continue;
    t.life -= dt;
    if (t.life <= 0) { t.group.visible = false; continue; }
    const k = t.life / t.span;
    t.core.material.opacity = .88 * k;
    t.halo.material.opacity = .14 * k;
  }
  for (const f of flashes) {
    if (f.life <= 0) continue;
    f.life -= dt;
    if (f.life <= 0) f.spr.visible = false;
  }
  if (flashLight && flashLight.intensity > 0) {
    flashLight.intensity *= Math.exp(-dt * 26);
    if (flashLight.intensity < .05) flashLight.intensity = 0;
  }
  for (const b of booms) {
    if (b.life <= 0) continue;
    b.life -= dt;
    if (b.life <= 0) { b.spr.visible = false; b.light.intensity = 0; continue; }
    const k = 1 - b.life / .5;
    b.spr.material.opacity = .95 * Math.max(0, 1 - k * 1.6);
    const fs = 7 * b.scale * (1 - k * .35);
    b.spr.scale.set(fs, fs, 1);
    b.light.intensity = 950 * b.scale * Math.max(0, 1 - k * 1.8);
  }
  // Particles: gravity, integration, and the ground — with a skip and
  // a bounce for the ones still carrying speed when they land.
  let anyParticle = false;
  for (let i = 0; i < PARTICLE_N; i++) {
    if (pLife[i] <= 0) continue;
    anyParticle = true;
    pLife[i] -= dt;
    if (pLife[i] <= 0) { hideParticle(i); continue; }
    pVel[i * 3 + 1] -= pGrav[i] * dt;
    pPos[i * 3] += pVel[i * 3] * dt;
    pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt;
    pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
    const floor = Math.max(.03, pSize[i] * .5);
    if (pPos[i * 3 + 1] < floor && pVel[i * 3 + 1] < 0) {
      if (pBounce[i] > 0) {
        pBounce[i]--;
        pPos[i * 3 + 1] = floor;
        pVel[i * 3 + 1] = -pVel[i * 3 + 1] * .42;
        pVel[i * 3] *= .65; pVel[i * 3 + 2] *= .65;
      } else {
        pPos[i * 3 + 1] = floor;
        pVel[i * 3 + 1] = 0;
      }
    }
    const s = pSize[i] * Math.min(1, pLife[i] / (pSpan[i] * .6));
    _v.set(pPos[i * 3], pPos[i * 3 + 1], pPos[i * 3 + 2]);
    _q.identity();
    _s.set(s, s, s);
    _m.compose(_v, _q, _s);
    particleMesh.setMatrixAt(i, _m);
  }
  if (anyParticle) particleMesh.instanceMatrix.needsUpdate = true;
  // Casings: tumble, fall, bounce once, settle, fade by shrinking.
  let anyCasing = false;
  for (let i = 0; i < CASING_N; i++) {
    if (cLife[i] <= 0) continue;
    anyCasing = true;
    cLife[i] -= dt;
    if (cLife[i] <= 0) { hideCasing(i); continue; }
    if (cPos[i * 3 + 1] > .03 || cVel[i * 3 + 1] > 0) {
      cVel[i * 3 + 1] -= 9.8 * dt;
      cPos[i * 3] += cVel[i * 3] * dt;
      cPos[i * 3 + 1] += cVel[i * 3 + 1] * dt;
      cPos[i * 3 + 2] += cVel[i * 3 + 2] * dt;
      cRot[i * 3] += cSpin[i * 3] * dt;
      cRot[i * 3 + 1] += cSpin[i * 3 + 1] * dt;
      cRot[i * 3 + 2] += cSpin[i * 3 + 2] * dt;
      if (cPos[i * 3 + 1] < .03 && cVel[i * 3 + 1] < 0) {
        cPos[i * 3 + 1] = .03;
        cVel[i * 3 + 1] = -cVel[i * 3 + 1] * .38;
        cVel[i * 3] *= .6; cVel[i * 3 + 2] *= .6;
        cSpin[i * 3] *= .5; cSpin[i * 3 + 1] *= .5; cSpin[i * 3 + 2] *= .5;
        if (Math.abs(cVel[i * 3 + 1]) < .5) cVel[i * 3 + 1] = 0;
      }
    }
    const s = Math.min(1, cLife[i] / .3);
    _v.set(cPos[i * 3], cPos[i * 3 + 1], cPos[i * 3 + 2]);
    _e.set(cRot[i * 3], cRot[i * 3 + 1], cRot[i * 3 + 2]);
    _q.setFromEuler(_e);
    _s.set(s, s, s);
    _m.compose(_v, _q, _s);
    casingMesh.setMatrixAt(i, _m);
  }
  if (anyCasing) casingMesh.instanceMatrix.needsUpdate = true;
  // The charge's lamp: a blink that quickens as the timer runs down.
  if (chargeMesh && chargeMesh.visible && G.charge) {
    const planted = G.charge.state === 'planted';
    const rate = planted ? (G.charge.timer < 10 ? 9 : G.charge.timer < 25 ? 4.5 : 2.2) : 1.4;
    const on = (G.time * rate) % 1 < .55;
    chargeLampMesh.material.color.setHex(on ? 0xff2222 : 0x551111);
    if (chargeLight) chargeLight.intensity = planted && on ? 7 : 0;
  } else if (chargeLight) {
    chargeLight.intensity = 0;
  }
  if (smokeGroup) {
    for (const group of smokeGroup.children) group.rotation.y += dt * .05;
  }
  updateDrips(dt);
}
