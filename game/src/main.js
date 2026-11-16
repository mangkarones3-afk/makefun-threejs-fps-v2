// main.js — boot and the frame loop. The simulation runs at a fixed
// 60 Hz step fed by an accumulator; rendering happens whenever the
// browser paints; the two never mix — a slow frame runs more steps,
// never a bigger step. Two presentation systems ride on the loop
// without touching the step size: hit-stop (feedback.js) scales the
// accumulator's feed to 5% for a few real-time frames on a kill, and a
// slow-motion beat at 35% closes out each round. Trauma decays in real
// time throughout, so the camera settles even while the world freezes.

import * as THREE from 'three';
import { G } from './state.js';
import { buildMap, tickMap } from './map.js';
import {
  initEffects, buildChargeMesh, initDrips, updateEffects,
  removeSmokeVisual, spawnTracer, spawnMuzzle, spawnImpact, spawnExplosion,
} from './effects.js';
import { createActors, startMatch, updateRounds } from './rounds.js';
import { PlayerController } from './player.js';
import { initHud, updateHud } from './hud.js';
import { parseShot, stageShot } from './shot.js';
import { tryFire, updateGrenades } from './weapons.js';
import { updateFeedback } from './feedback.js';
import { PostFX } from './postfx.js';
import { unlockAudio } from './audio.js';
import { skyTexture, rainTexture, mulberry32 } from './textures.js';
import { RAIN_VERT, RAIN_FRAG } from './shaders.js';

const STEP = 1 / 60;
const RAIN_N = 1300;

function boot() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // r187 dropped the Soft variant
  document.getElementById('game').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x11161f, 26, 118);
  const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, .08, 420);
  scene.add(camera);

  // The night sky: a painted dome with a sodium bloom low in the west.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(300, 28, 16),
    new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false }),
  );
  sky.rotation.y = Math.PI * .62; // turn the bloom toward the west-northwest
  scene.add(sky);

  // Rain: a shader-driven volume of streaks wrapped around the camera.
  // The falling happens in the vertex shader from a time uniform — the
  // CPU never touches a drop. Presentation only; the sim sees no rain.
  const rainRng = mulberry32(90210);
  const rainPos = new Float32Array(RAIN_N * 3);
  const rainSeed = new Float32Array(RAIN_N);
  for (let i = 0; i < RAIN_N; i++) {
    rainPos[i * 3] = (rainRng() - .5) * 96;
    rainPos[i * 3 + 1] = rainRng() * 42;
    rainPos[i * 3 + 2] = (rainRng() - .5) * 72;
    rainSeed[i] = rainRng();
  }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  rainGeo.setAttribute('aSeed', new THREE.BufferAttribute(rainSeed, 1));
  const rainUniforms = {
    uTime: { value: 0 },
    uCamPos: { value: new THREE.Vector3() },
    tStreak: { value: rainTexture() },
    uTint: { value: new THREE.Color(0x9fb6d8) },
  };
  const rain = new THREE.Points(rainGeo, new THREE.ShaderMaterial({
    vertexShader: RAIN_VERT,
    fragmentShader: RAIN_FRAG,
    uniforms: rainUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  rain.frustumCulled = false;
  scene.add(rain);

  // Night light: a dim cool moonlight for shape and shadows, and the
  // yard's four sodium floodlights as the real suns of the scene.
  scene.add(new THREE.HemisphereLight(0x44557a, 0x1c1712, .5));
  const moonlight = new THREE.DirectionalLight(0x8fb0e8, .55);
  moonlight.position.set(38, 30, 14);
  moonlight.castShadow = true;
  moonlight.shadow.mapSize.set(2048, 2048);
  moonlight.shadow.camera.left = -48;
  moonlight.shadow.camera.right = 48;
  moonlight.shadow.camera.top = 40;
  moonlight.shadow.camera.bottom = -40;
  moonlight.shadow.camera.far = 130;
  moonlight.shadow.bias = -.0006;
  moonlight.shadow.radius = 2;
  scene.add(moonlight);

  G.scene = scene;
  G.camera = camera;
  G.map = buildMap(scene);
  for (const p of G.map.lampPositions) {
    const lamp = new THREE.PointLight(0xff9a3e, 430, 42, 1.7);
    lamp.position.copy(p);
    scene.add(lamp);
  }
  initEffects(scene);
  buildChargeMesh(scene);
  initDrips(scene, G.map.dripPoints);
  createActors(scene);

  // Before the first match, stand everyone at their spawn for the
  // menu backdrop.
  for (const a of G.actors) {
    const list = G.actors.filter((o) => o.team === a.team);
    const spawn = G.map.spawns[a.team][list.indexOf(a) % 5];
    a.pos.x = spawn.x;
    a.pos.z = spawn.z;
    a.yaw = spawn.yaw;
    a.syncMesh();
  }

  const controller = new PlayerController(G.player, camera, renderer.domElement);
  const postfx = new PostFX(renderer);
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
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    postfx.resize();
  });

  let last = performance.now();
  let acc = 0;
  let lastPhase = G.phase;
  let slowmo = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    let rdt = (now - last) / 1000;
    last = now;
    if (rdt > .25) rdt = .25;

    rainUniforms.uTime.value += rdt; // rain falls on real time
    rainUniforms.uCamPos.value.copy(camera.position);

    if (!G.paused) {
      if (G.phase !== lastPhase) {
        if (G.phase === 'end') slowmo = 1.15; // the round-end beat
        lastPhase = G.phase;
      }
      // Hit-stop scales the feed; trauma keeps draining in real time.
      let scale = updateFeedback(rdt);
      if (slowmo > 0) {
        scale = Math.min(scale, .35);
        slowmo -= rdt;
      }
      acc += rdt * scale;
      let guard = 0;
      while (acc >= STEP && guard < 8) {
        step(STEP, controller, shot);
        acc -= STEP;
        guard++;
      }
      if (guard === 8) acc = 0; // a stalled tab does not fast-forward
    }
    updateHud();
    if (shot && shot.mode === 'play') stagedBurst();
    postfx.render(scene, camera, rdt);
    if (shot && !window.__shotReady) window.__shotReady = true;
  }
  requestAnimationFrame(frame);
}

// In the staged play shot the posed actors never pull their triggers,
// so the firefight is dressed by hand: alternating bursts between the
// lead Warden and the player, dressed again right before each render.
let fxTimer = 0;
let fxAlt = false;
let fxBoom = 1.4;
function stagedPlayFx(dt) {
  fxBoom -= dt;
  if (fxBoom <= 0) {
    fxBoom = 2.6;
    const defs0 = G.actors.filter((a) => a.team === 'def' && !a.isPlayer);
    if (defs0[2]) spawnExplosion(defs0[2].pos.x + 1.5, .6, defs0[2].pos.z + 1, .6);
  }
  fxTimer -= dt;
  if (fxTimer > 0) return;
  fxTimer = .26;
  stagedBurst();
}

function stagedBurst() {
  fxAlt = !fxAlt;
  const defs = G.actors.filter((a) => a.team === 'def' && !a.isPlayer);
  const atks = G.actors.filter((a) => a.team === 'atk' && !a.isPlayer);
  const p = G.player;
  const eye = (a) => a.eyePos();
  if (fxAlt) {
    const d = defs[0];
    const e = eye(d);
    spawnMuzzle(e.x, e.y - .12, e.z);
    spawnTracer(e.x, e.y - .1, e.z, p.pos.x + .55, 1.15, p.pos.z + .3);
    spawnImpact(p.pos.x + .62, .9, p.pos.z + .34, false);
  } else {
    const e = eye(p);
    spawnMuzzle(e.x + .2, e.y - .14, e.z - .4);
    const d = defs[1];
    const c = d.chestPos();
    spawnTracer(e.x + .2, e.y - .12, e.z - .4, c.x, c.y, c.z);
    spawnImpact(c.x, c.y, c.z, true);
    if (atks[0]) {
      const t = eye(atks[0]);
      spawnTracer(t.x, t.y - .1, t.z, defs[2].pos.x, 1.2, defs[2].pos.z);
    }
  }
}

function step(dt, controller, shot) {
  G.time += dt;
  updateRounds(dt);
  tickMap(dt);

  const staged = shot && (shot.mode === 'start' || shot.mode === 'end');
  if (!staged) controller.update(dt);
  if (!shot) {
    for (const a of G.actors) if (a.brain) a.brain.update(dt);
  }
  if (shot && shot.mode === 'play') stagedPlayFx(dt);

  // Weapons: tick the held weapon, settle recoil along its recovery
  // curve, resolve trigger flags into shots.
  for (const a of G.actors) {
    a.current.update(dt);
    a.recoilPitch -= a.recoilPitch * Math.min(1, dt * 6.5);
    if (a.alive && G.phase === 'live' && (a.triggerHeld || a.triggerEdge)) {
      if (!a.drawUntil || G.time >= a.drawUntil) tryFire(a);
    }
    a.triggerEdge = false;
    a.syncMesh();
  }

  updateGrenades(dt);
  for (let i = G.smokes.length - 1; i >= 0; i--) { // sweep expired smoke
    if (G.smokes[i].until < G.time) {
      removeSmokeVisual(G.smokes[i].visual);
      G.smokes.splice(i, 1);
    }
  }
  if (G.flashTime > 0) G.flashTime = Math.max(0, G.flashTime - dt);
  updateEffects(dt);
}

boot();
