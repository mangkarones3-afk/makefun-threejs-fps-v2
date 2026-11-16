// main.js — boot and the frame loop. The simulation runs at a fixed 60 Hz
// step (accumulator), rendering happens whenever the browser paints, and
// the two never mix: a slow frame runs more steps, never a bigger step.
// Two presentation beats ride on top of the accumulator without touching
// the step itself: hit-stop freezes the sim for a few frames on a kill,
// and a slow-motion beat closes out each round.

import * as THREE from 'three';
import { G } from './state.js';
import { buildMap, tickMap } from './map.js';
import {
  initEffects, buildChargeMesh, updateEffects, removeSmokeVisual,
  spawnTracer, spawnMuzzle, spawnImpact, spawnExplosion,
} from './effects.js';
import { createActors, startMatch, updateRounds } from './rounds.js';
import { PlayerController } from './player.js';
import { initHud, updateHud } from './hud.js';
import { parseShot, stageShot } from './shot.js';
import { tryFire, updateGrenades } from './weapons.js';
import { unlockAudio } from './audio.js';
import { skyTexture, glowTexture, rainTexture, mulberry32 } from './textures.js';

const STEP = 1 / 60;

function boot() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight); renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18; document.getElementById('game').appendChild(renderer.domElement);

  const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0x11161f, 26, 118);

  const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.08, 420);
  scene.add(camera);

  // The night sky: a painted dome with a sodium bloom low in the west,
  // a pale moon high in the east, and cloud banks drifting through both.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(300, 28, 16),
    new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false }),
  );
  // Turn the bloom (painted at u=0.30) toward the yard's west-northwest.
  sky.rotation.y = Math.PI * 0.62; scene.add(sky);
  const glowTex = glowTexture();
  const horizonGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: 0xff9a4d, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  horizonGlow.position.set(-130, 20, -140); horizonGlow.scale.set(200, 95, 1);
  scene.add(horizonGlow);
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: 0xd7e2f5, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  moon.position.set(150, 135, -170); moon.scale.set(30, 30, 1);
  scene.add(moon);
  // Rain: a box of falling streaks over the yard, slanting with the wind,
  // recycled as they land. Presentation only — the sim never sees it.
  const cloudRng = mulberry32(777); const RAIN = 1100;
  const rainPos = new Float32Array(RAIN * 3); const rainVel = new Float32Array(RAIN);
  for (let i = 0; i < RAIN; i++) {
    rainPos[i * 3] = (cloudRng() - 0.5) * 96; rainPos[i * 3 + 1] = cloudRng() * 42;
    rainPos[i * 3 + 2] = (cloudRng() - 0.5) * 72; rainVel[i] = 19 + cloudRng() * 9;
  }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3).setUsage(THREE.DynamicDrawUsage));
  const rain = new THREE.Points(rainGeo, new THREE.PointsMaterial({
    map: rainTexture(), color: 0x9fb6d8, size: 1.5, sizeAttenuation: true,
    transparent: true, opacity: 0.34, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  rain.frustumCulled = false; scene.add(rain);

  // Night light: a dim cool moonlight for shape and shadows, and the
  // yard's four sodium floodlights as the real suns of the scene — hot
  scene.add(new THREE.HemisphereLight(0x44557a, 0x1c1712, 0.5));
  const moonlight = new THREE.DirectionalLight(0x8fb0e8, 0.55); moonlight.position.set(38, 30, 14);
  moonlight.castShadow = true; moonlight.shadow.mapSize.set(2048, 2048);
  moonlight.shadow.camera.left = -48; moonlight.shadow.camera.right = 48;
  moonlight.shadow.camera.top = 40; moonlight.shadow.camera.bottom = -40; moonlight.shadow.camera.far = 130;
  moonlight.shadow.bias = -0.0006; moonlight.shadow.radius = 2;
  scene.add(moonlight);
  for (const [x, z] of [[-14, -18], [14, -18], [-14, 14], [14, 14]]) {
    const lamp = new THREE.PointLight(0xff9a3e, 430, 42, 1.7); lamp.position.set(x, 6.2, z);
    scene.add(lamp);
  }

  G.scene = scene; G.camera = camera;
  G.map = buildMap(scene); initEffects(scene);
  buildChargeMesh(scene); createActors(scene);

  // Before the first match, stand everyone at their spawn for the menu backdrop.
  for (const a of G.actors) {
    const list = G.actors.filter((o) => o.team === a.team); const spawn = G.map.spawns[a.team][list.indexOf(a) % 5];
    a.pos.x = spawn.x; a.pos.z = spawn.z;
    a.yaw = spawn.yaw; a.syncMesh();
  }
  G.player.syncMesh?.();

  const controller = new PlayerController(G.player, camera, renderer.domElement);
  initHud({
    onPlay: () => { unlockAudio(); startMatch(); controller.requestLock(); },
    onResume: () => { unlockAudio(); controller.requestLock(); },
    onAgain: () => { unlockAudio(); startMatch(); controller.requestLock(); },
  });

  const shot = parseShot();
  if (shot) {
    stageShot(shot, G.player, camera);
    if (shot.mode === 'start' || shot.mode === 'end') controller.viewmodel.visible = false;
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  let last = performance.now(); let acc = 0;
  let lastPhase = G.phase; let slowmo = 0;
  function frame(now) {
    requestAnimationFrame(frame); let dt = (now - last) / 1000;
    last = now; if (dt > 0.25) dt = 0.25;
    // Rain falls on real time, whatever the sim is doing.
    {
      const pos = rainGeo.attributes.position.array;
      for (let i = 0; i < RAIN; i++) {
        pos[i * 3 + 1] -= rainVel[i] * dt;
        pos[i * 3] += 3.2 * dt; // the wind slant
        if (pos[i * 3 + 1] < 0) {
          pos[i * 3 + 1] = 40 + Math.random() * 3; pos[i * 3] = (Math.random() - 0.5) * 96;
          pos[i * 3 + 2] = (Math.random() - 0.5) * 72;
        }
        if (pos[i * 3] > 49) pos[i * 3] = -49;
      }
      rainGeo.attributes.position.needsUpdate = true;
    }
    if (!G.paused) {
      if (G.phase !== lastPhase) {
        if (G.phase === 'end') slowmo = 1.15; // the round-end beat
        lastPhase = G.phase;
      }
      if (G.hitStop > 0) {
        G.hitStop -= dt; // frozen: render the moment, step nothing
      } else {
        let scale = 1;
        if (slowmo > 0) { scale = 0.35; slowmo -= dt; }
        acc += dt * scale;
        while (acc >= STEP) {
          step(STEP, controller, shot); acc -= STEP;
        }
      }
    }
    updateHud(); if (shot && shot.mode === 'play') stagedBurst(); renderer.render(scene, camera);
    if (shot && !window.__shotReady) window.__shotReady = true;
  }
  requestAnimationFrame(frame);
}

// In the staged play shot the posed actors never pull their triggers, so
// the firefight is dressed by hand: alternating bursts between the lead
let fxTimer = 0; let fxAlt = false;
let fxBoom = 1.4;
function stagedPlayFx(dt) {
  // Every couple of seconds a charge of sparks goes up by the far Warden —
  // a grenade cooking off in the mid distance, pure light for the frame.
  fxBoom -= dt;
  if (fxBoom <= 0) {
    fxBoom = 2.6; const defs0 = G.actors.filter((a) => a.team === 'def' && !a.isPlayer);
    if (defs0[2]) spawnExplosion(defs0[2].pos.x + 1.5, 0.6, defs0[2].pos.z + 1, 0.6);
  }
  fxTimer -= dt; if (fxTimer > 0) return;
  fxTimer = 0.26; stagedBurst();
}

// One staged burst, alternating shooters — also fired once per frame
// right before the render, so the captured frame always has a tracer up.
function stagedBurst() {
  fxAlt = !fxAlt;
  const defs = G.actors.filter((a) => a.team === 'def' && !a.isPlayer);
  const atks = G.actors.filter((a) => a.team === 'atk' && !a.isPlayer); const p = G.player;
  const eye = (a) => a.eyePos();
  if (fxAlt) {
    const d = defs[0]; const e = eye(d);
    spawnMuzzle(e.x, e.y - 0.12, e.z); spawnTracer(e.x, e.y - 0.1, e.z, p.pos.x + 0.55, 1.15, p.pos.z + 0.3);
    spawnImpact(p.pos.x + 0.62, 0.9, p.pos.z + 0.34, false);
  } else {
    const e = eye(p); spawnMuzzle(e.x + 0.2, e.y - 0.14, e.z - 0.4);
    const d = defs[1]; const c = d.chestPos();
    spawnTracer(e.x + 0.2, e.y - 0.12, e.z - 0.4, c.x, c.y, c.z); spawnImpact(c.x, c.y, c.z, true);
    if (atks[0]) {
      const t = eye(atks[0]); spawnTracer(t.x, t.y - 0.1, t.z, defs[2].pos.x, 1.2, defs[2].pos.z);
    }
  }
}

function step(dt, controller, shot) {
  G.time += dt; updateRounds(dt);
  tickMap(dt);

  const staged = shot && (shot.mode === 'start' || shot.mode === 'end'); if (!staged) controller.update(dt);
  if (!shot) {
    for (const a of G.actors) if (a.brain) a.brain.update(dt);
  }
  if (shot && shot.mode === 'play') stagedPlayFx(dt);

  // Weapons: tick the held weapon, settle recoil, resolve trigger flags.
  for (const a of G.actors) {
    a.current.update(dt); a.recoilPitch -= a.recoilPitch * Math.min(1, dt * 6.5);
    if (a.alive && G.phase === 'live' && (a.triggerHeld || a.triggerEdge)) {
      if (!a.drawUntil || G.time >= a.drawUntil) tryFire(a);
    }
    a.triggerEdge = false; a.syncMesh();
  }

  updateGrenades(dt);
  // Sweep expired smoke, visuals included.
  for (let i = G.smokes.length - 1; i >= 0; i--) {
    if (G.smokes[i].until < G.time) {
      removeSmokeVisual(G.smokes[i].visual); G.smokes.splice(i, 1);
    }
  }
  if (G.flashTime > 0) G.flashTime = Math.max(0, G.flashTime - dt); updateEffects(dt);
}

boot();
