// map.js — the Yard: an original container depot on a rainy night. A
// warehouse on the north-west holds Site A (the Loading Dock); an open
// tank farm on the north-east is Site B. Three lanes join the south spawn
// yard to the sites: the west service lane, the container rows of mid,
// and the east road. This module owns the layout data (colliders, sites,
// spawns, the waypoint graph) plus every mesh that draws them.

import * as THREE from 'three';
import { rayBox } from './physics.js';
import {
  containerSideTexture, containerDoorTexture, concreteTexture,
  siloTexture, skylineTexture, glowTexture, mulberry32,
} from './textures.js';

const PALETTE = {
  asphalt: '#2e3237',
  wallDark: '#43474e',
  containerA: '#a03d2d',
  containerB: '#226b6b',
  containerC: '#b07a2a',
  containerD: '#4a5a68',
  roof: '#2e3238',
};

// The ground: one big canvas — asphalt with oil stains and tyre scuffs,
// lane paint worn thin, hazard aprons at the site mouths and the two
// site markings — so the yard reads at a glance with no image files.
function groundTexture(sites) {
  const W = 2048, H = 1536; // 80 m x 60 m at ~25 px per metre
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'); const rng = mulberry32(808);
  const px = (x) => (x + 40) / 80 * W; const pz = (z) => (z + 30) / 60 * H;
  const blob = (x, y, r, style) => {
    const grad = g.createRadialGradient(x, y, 2, x, y, r); grad.addColorStop(0, style);
    grad.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = grad;
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  };
  g.fillStyle = PALETTE.asphalt; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 40; i++) blob(rng() * W, rng() * H, 90 + rng() * 260, rng() < 0.5 ? 'rgba(255,246,225,0.05)' : 'rgba(0,0,0,0.07)'); // tonal drift
  for (let i = 0; i < 9000; i++) { // speckle
    g.fillStyle = rng() < 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.05)';
    g.fillRect(rng() * W, rng() * H, 2.4, 2.4);
  }
  for (let i = 0; i < 15; i++) blob(rng() * W, rng() * H, 14 + rng() * 44, 'rgba(8,8,10,0.34)'); // oil stains
  g.strokeStyle = 'rgba(10,10,12,0.13)'; g.lineWidth = 8;
  for (let i = 0; i < 11; i++) { // tyre scuffs
    g.beginPath(); g.arc(rng() * W, rng() * H, 60 + rng() * 190, rng() * 3, rng() * 2 + 0.7);
    g.stroke();
  }
  for (let i = 0; i < 6; i++) { // puddle sheen in the paint layer too
    g.fillStyle = 'rgba(158,178,205,0.10)';
    g.beginPath(); g.ellipse(rng() * W, rng() * H, 26 + rng() * 52, 10 + rng() * 18, rng() * 3, 0, 7); g.fill();
  }
  g.strokeStyle = 'rgba(0,0,0,0.22)'; // expansion joints every 8 m
  g.lineWidth = 2;
  for (let x = -40; x <= 40; x += 8) { g.beginPath(); g.moveTo(px(x), 0); g.lineTo(px(x), H); g.stroke(); }
  for (let z = -30; z <= 30; z += 8) { g.beginPath(); g.moveTo(0, pz(z)); g.lineTo(W, pz(z)); g.stroke(); }
  g.strokeStyle = 'rgba(240,200,90,0.5)'; // lane centrelines
  g.lineWidth = 4; g.setLineDash([26, 20]);
  g.beginPath(); g.moveTo(px(-14), pz(27)); g.lineTo(px(-14), pz(-4)); g.stroke();
  g.beginPath(); g.moveTo(px(14), pz(27)); g.lineTo(px(14), pz(-4)); g.stroke(); g.setLineDash([]);
  for (const [hx0, hx1, hz] of [[-32.5, -22.5, -9.2], [21.5, 32.5, -8.2]]) { // hazard aprons
    g.save(); g.beginPath(); g.rect(px(hx0), pz(hz), px(hx1) - px(hx0), pz(hz + 1.1) - pz(hz)); g.clip();
    g.fillStyle = 'rgba(200,146,42,0.5)'; g.fillRect(px(hx0), pz(hz), px(hx1) - px(hx0), pz(hz + 1.1) - pz(hz));
    g.strokeStyle = 'rgba(24,24,28,0.55)'; g.lineWidth = 9;
    for (let x = hx0 - 2; x < hx1 + 2; x += 1.6) {
      g.beginPath(); g.moveTo(px(x), pz(hz + 1.15)); g.lineTo(px(x + 1.1), pz(hz - 0.05)); g.stroke();
    }
    g.restore();
  }
  for (const id of ['A', 'B']) { // site markings: ring, letter, name
    const s = sites[id]; g.strokeStyle = 'rgba(232,150,60,0.9)';
    g.lineWidth = 7; g.strokeRect(px(s.x0), pz(s.z0), px(s.x1) - px(s.x0), pz(s.z1) - pz(s.z0));
    g.fillStyle = 'rgba(232,150,60,0.85)'; g.font = 'bold 150px system-ui, sans-serif';
    g.textAlign = 'center'; g.fillText(id, px((s.x0 + s.x1) / 2), pz((s.z0 + s.z1) / 2) + 50);
    g.font = 'bold 34px system-ui, sans-serif';
    g.fillText(s.name.toUpperCase(), px((s.x0 + s.x1) / 2), pz(s.z1) - 24);
  }
  for (let i = 0; i < 2400; i++) { // wear: asphalt dust back over the paint
    g.fillStyle = `rgba(46,50,55,${0.10 + rng() * 0.16})`;
    g.fillRect(rng() * W, rng() * H, 3.2, 3.2);
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8; return tex;
}

function signTexture(text, sub) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 160;
  const g = c.getContext('2d'); g.fillStyle = '#20242a';
  g.fillRect(0, 0, 512, 160); g.strokeStyle = '#e8963c';
  g.lineWidth = 6; g.strokeRect(6, 6, 500, 148);
  g.fillStyle = '#f2e9d8'; g.font = 'bold 64px system-ui, sans-serif';
  g.textAlign = 'center'; g.fillText(text, 256, 78);
  g.fillStyle = '#e8963c'; g.font = 'bold 34px system-ui, sans-serif';
  g.fillText(sub, 256, 128); const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; return tex;
}

// Moving dressing, animated by tickMap: the crane's trolley and swaying
// load, its beacon, the warehouse's rotating warning light, site pillars.
const anim = { t: 0, trolley: null, load: null, beacon: null, beaconGlow: null, warn: null, pillars: [] };

export function tickMap(dt) {
  anim.t += dt; const t = anim.t;
  if (anim.trolley) {
    const x = Math.sin(t * 0.09) * 9.5; anim.trolley.position.x = x;
    anim.load.rotation.z = Math.sin(t * 0.45) * 0.035; anim.load.rotation.x = Math.sin(t * 0.31 + 1) * 0.02;
  }
  if (anim.beacon) {
    const on = (t * 1.3) % 1 < 0.55; anim.beacon.material.color.setHex(on ? 0xff2a22 : 0x4d0f0c);
    anim.beaconGlow.material.opacity = on ? 0.75 : 0.05;
  }
  if (anim.warn) anim.warn.rotation.y += dt * 2.3;
  for (const p of anim.pillars) {
    p.material.opacity = 0.085 + 0.04 * (0.5 + 0.5 * Math.sin(t * 2 + p.userData.phase));
  }
}

export function buildMap(scene) {
  const colliders = []; const root = new THREE.Group();
  scene.add(root); anim.pillars = [];

  const glowTex = glowTexture();
  const matWall = new THREE.MeshStandardMaterial({ map: concreteTexture(), color: 0x9aa0a8, roughness: 0.92, metalness: 0.05 });
  matWall.map.repeat.set(3, 1);
  const matWallDark = new THREE.MeshStandardMaterial({ map: concreteTexture(), color: 0x777d84, roughness: 0.95 });
  const matConcrete = new THREE.MeshStandardMaterial({ map: concreteTexture(), roughness: 0.95 });
  const matRoof = new THREE.MeshStandardMaterial({ color: PALETTE.roof, roughness: 0.95 });
  const matCrate = new THREE.MeshStandardMaterial({ color: 0x8a6b42, roughness: 0.9 });
  const matPost = new THREE.MeshStandardMaterial({ color: PALETTE.wallDark, roughness: 0.8, metalness: 0.3 });
  const containerHexes = [PALETTE.containerA, PALETTE.containerB, PALETTE.containerC, PALETTE.containerD];
  const doorMats = containerHexes.map((hex, i) => new THREE.MeshStandardMaterial({
    map: containerDoorTexture(hex, 300 + i * 17), roughness: 0.42, metalness: 0.38,
  }));

  // Box helper: adds a mesh and (unless visualOnly) a collider. x/z are the
  // centre, w/d the footprint, h the height.
  function box(x, z, w, d, h, mat, opts = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); mesh.position.set(x, h / 2, z);
    mesh.castShadow = !!opts.cast; mesh.receiveShadow = true;
    root.add(mesh);
    if (!opts.visualOnly) {
      colliders.push({ x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2, h });
    }
    return mesh;
  }

  // ---- Perimeter fence walls ----
  box(0, -29.6, 80, 1.2, 3.4, matWallDark); box(0, 29.6, 80, 1.2, 3.4, matWallDark);
  box(-39.6, 0, 1.2, 60, 3.4, matWallDark); box(39.6, 0, 1.2, 60, 3.4, matWallDark);

  // ---- Warehouse (Site A) — walls with two door gaps ----
  const WH = 3.6;
  box(-27, -27, 20.6, 0.6, WH, matWall, { cast: true }); // north wall
  box(-37, -17, 0.6, 20.6, WH, matWall, { cast: true }); // west wall
  box(-30.9, -7, 12.8, 0.6, WH, matWall, { cast: true }); // south wall, west of door
  box(-19.9, -7, 6.4, 0.6, WH, matWall, { cast: true }); // south wall, east of door
  box(-17, -21, 0.6, 12.4, WH, matWall, { cast: true }); // east wall, north of door
  box(-17, -9.6, 0.6, 5.8, WH, matWall, { cast: true }); // east wall, south of door
  const roof = box(-27, -17, 21, 21, 0.3, matRoof, { visualOnly: true });
  roof.position.y = WH + 0.15;
  // Glowing window band on the warehouse's south face.
  const winMat = new THREE.MeshStandardMaterial({ color: 0x1a1208, emissive: 0xffb066, emissiveIntensity: 2.4 });
  const win = new THREE.Mesh(new THREE.BoxGeometry(16, 0.7, 0.1), winMat); win.position.set(-27, 2.7, -6.65);
  root.add(win);
  // Rotating warning light above the warehouse roof.
  const warnBase = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 0.5, 8), matPost);
  warnBase.position.set(-27, WH + 0.55, -17); root.add(warnBase);
  const warnGroup = new THREE.Group(); warnGroup.position.set(-27, WH + 0.85, -17);
  const warnLamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 10, 10),
    new THREE.MeshBasicMaterial({ color: 0xffa63e }),
  ); warnGroup.add(warnLamp);
  const warnCone = new THREE.Mesh(
    new THREE.ConeGeometry(1.5, 4.6, 20, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xff9a3e, transparent: true, opacity: 0.13,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
    }),
  ); warnCone.rotation.z = Math.PI / 2;
  warnCone.position.x = 2.3; warnGroup.add(warnCone);
  const warnGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: 0xffa63e, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  warnGlow.scale.set(2.2, 2.2, 1); warnGroup.add(warnGlow);
  root.add(warnGroup); anim.warn = warnGroup;
  // Interior pillars and crates.
  for (const [x, z] of [[-31, -21], [-23, -21], [-31, -13], [-23, -13]]) {
    box(x, z, 1, 1, WH, matWallDark);
  }
  box(-33, -10.5, 2.4, 2.4, 1.3, matCrate, { cast: true });
  box(-20.6, -24, 3, 1.6, 1.3, matCrate, { cast: true });

  // ---- Tank farm (Site B) — silos, a pump unit, low barriers ----
  const matSilo = new THREE.MeshStandardMaterial({ map: siloTexture(), roughness: 0.28, metalness: 0.62 });
  for (const [x, z] of [[23, -22], [30.5, -13], [23.5, -9.5]]) {
    const silo = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 5, 18), matSilo); silo.position.set(x, 2.5, z);
    silo.castShadow = true; silo.receiveShadow = true;
    root.add(silo); const cap = new THREE.Mesh(new THREE.ConeGeometry(2.45, 0.9, 18), matRoof);
    cap.position.set(x, 5.45, z); root.add(cap);
    colliders.push({ x0: x - 2.1, z0: z - 2.1, x1: x + 2.1, z1: z + 2.1, h: 5 });
  }
  box(33.5, -22, 2.6, 1.8, 1.6, matWallDark, { cast: true }); // pump unit
  box(27, -19.5, 4, 0.6, 1.05, matConcrete); // low barrier
  box(20, -15.5, 0.6, 4, 1.05, matConcrete);

  // ---- Containers: mid rows and the south yard ----
  let ci = 0;
  function container(x, z, len, alongX, h = 2.6) {
    const colorIdx = ci % containerHexes.length;
    const sideTex = containerSideTexture(containerHexes[colorIdx], `YL-${2049 + ci * 137}`, 100 + ci * 31);
    sideTex.repeat.set(Math.max(1, Math.round(len / 6)), h > 3 ? 2 : 1);
    const matSide = new THREE.MeshStandardMaterial({ map: sideTex, roughness: 0.42, metalness: 0.38 });
    const mats = alongX
      ? [doorMats[colorIdx], doorMats[colorIdx], matRoof, matRoof, matSide, matSide]
      : [matSide, matSide, matRoof, matRoof, doorMats[colorIdx], doorMats[colorIdx]]; ci++;
    const w = alongX ? len : 2.6, d = alongX ? 2.6 : len;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats); mesh.position.set(x, h / 2, z);
    mesh.castShadow = true; mesh.receiveShadow = true;
    root.add(mesh);
    // Dark corner posts sell the shape without extra textures.
    const post = new THREE.BoxGeometry(0.18, h, 0.18);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const p = new THREE.Mesh(post, matPost);
      p.position.set(x + sx * (w / 2 - 0.09), h / 2, z + sz * (d / 2 - 0.09)); root.add(p);
    }
    colliders.push({ x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2, h });
  }
  container(-6, -10, 11, true); container(5, -4, 11, false);
  container(-2, 2, 11, true); container(-11, 5, 9, false);
  container(8, 8, 8, true);
  container(0, -17, 11, true, 5.2); // double stack watching mid-north
  container(-21, 16, 11, true); container(19, 16, 11, true);
  container(-20.5, 2, 8, false); // west lane cover

  // ---- Crates and barriers scattered as crouch cover ----
  box(-14.5, -1, 1.6, 1.6, 1.3, matCrate, { cast: true });
  box(14.5, -2, 1.6, 1.6, 1.3, matCrate, { cast: true });
  box(0, -20, 2.4, 2.4, 1.3, matCrate, { cast: true });
  box(-4, 20, 2, 2, 1.3, matCrate, { cast: true });
  box(-14.5, 12, 3.2, 0.5, 1.05, matConcrete); box(14.5, 10, 3.2, 0.5, 1.05, matConcrete);
  box(6, 21, 3.4, 0.5, 1.05, matConcrete); box(-6, -23, 3, 0.5, 1.05, matConcrete);
  box(7.5, -23, 3, 0.5, 1.05, matConcrete);

  // ---- Site data (declared before the ground so it can be painted) ----
  const sites = {
    A: { id: 'A', name: 'Loading Dock', x0: -35, z0: -25, x1: -20, z1: -10, cx: -27.5, cz: -17.5 },
    B: { id: 'B', name: 'Tank Farm', x0: 19, z0: -25, x1: 35, z1: -9, cx: 27, cz: -17 },
  };

  // ---- Ground: rain-slick — a low-roughness skin so the sodium lamps
  // streak across it, and gloss puddle plates that mirror their pools. ----
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 60),
    new THREE.MeshStandardMaterial({ map: groundTexture(sites), roughness: 0.34, metalness: 0.08 }),
  ); ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true; root.add(ground);
  const matPuddle = new THREE.MeshStandardMaterial({ color: 0x1c2836, roughness: 0.07, metalness: 0.55 });
  for (const [x, z, r] of [[-11, -14, 2.6], [11, -15, 2.2], [-10, 10, 2.4], [12, 11, 2.8], [-24, 8, 2.1], [24, 4, 2.3], [3, 20, 2.5]]) {
    const puddle = new THREE.Mesh(new THREE.CircleGeometry(r, 22), matPuddle); puddle.rotation.x = -Math.PI / 2;
    puddle.position.set(x, 0.02, z); root.add(puddle);
  }

  // ---- Site dressing: a light pillar and a plant ring at each centre ----
  for (const id of ['A', 'B']) {
    const s = sites[id];
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.55, 11, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xe8963c, transparent: true, opacity: 0.1,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
      }),
    ); pillar.position.set(s.cx, 5.5, s.cz);
    pillar.userData.phase = id === 'A' ? 0 : 2.1; root.add(pillar);
    anim.pillars.push(pillar);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.7, 3.05, 40),
      new THREE.MeshBasicMaterial({
        color: 0xe8963c, transparent: true, opacity: 0.4,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }),
    ); ring.rotation.x = -Math.PI / 2;
    ring.position.set(s.cx, 0.06, s.cz); root.add(ring);
  }

  // ---- Site signs on the warehouse wall and the B fence ----
  const signA = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 2), new THREE.MeshBasicMaterial({ map: signTexture('SITE A', 'LOADING DOCK') }));
  signA.position.set(-27, 2.2, -6.68); root.add(signA);
  const signB = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 2), new THREE.MeshBasicMaterial({ map: signTexture('SITE B', 'TANK FARM') }));
  signB.position.set(27, 2.2, -28.9); root.add(signB);

  // ---- Floodlight poles: emissive heads with a halo, a volumetric cone
  // in the rain, and a hot pool on the wet ground (lights in main) ----
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x2a2c26, emissive: 0xffa63e, emissiveIntensity: 3.4 });
  const coneMat = new THREE.MeshBasicMaterial({
    color: 0xff9a3e, transparent: true, opacity: 0.05,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  const poolMat = new THREE.MeshBasicMaterial({
    color: 0xff9a3e, transparent: true, opacity: 0.10,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  for (const [x, z] of [[-14, -18], [14, -18], [-14, 14], [14, 14]]) {
    box(x, z, 0.3, 0.3, 6.4, matWallDark, { visualOnly: true });
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 0.5), lampMat); lamp.position.set(x, 6.4, z);
    root.add(lamp);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: 0xffa63e, transparent: true, opacity: 0.65,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    halo.scale.set(4.4, 4.4, 1); halo.position.set(x, 6.4, z);
    root.add(halo); const cone = new THREE.Mesh(new THREE.ConeGeometry(4.8, 6.3, 24, 1, true), coneMat);
    cone.position.set(x, 3.25, z); root.add(cone);
    const pool = new THREE.Mesh(new THREE.CircleGeometry(3.6, 24), poolMat); pool.rotation.x = -Math.PI / 2;
    pool.position.set(x, 0.04, z); root.add(pool);
  }

  // ---- The gantry crane over mid (dressing only: no colliders) ----
  const craneMat = new THREE.MeshStandardMaterial({ color: 0x8a6a24, roughness: 0.55, metalness: 0.45 });
  const craneDark = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.7, metalness: 0.4 });
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.9, 15, 0.9), craneMat); leg.position.set(sx * 17.5, 7.5, -6);
    leg.castShadow = true; root.add(leg);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, 1.7), craneDark);
    foot.position.set(sx * 17.5, 0.25, -6); root.add(foot);
    const brace = new THREE.Mesh(new THREE.BoxGeometry(0.22, 8.4, 0.22), craneDark);
    brace.position.set(sx * 17.5, 7.5, -6); brace.rotation.x = 0.62;
    root.add(brace);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(36.6, 1.5, 1.7), craneMat); beam.position.set(0, 15.2, -6);
  beam.castShadow = true; root.add(beam);
  const rail = new THREE.Mesh(new THREE.BoxGeometry(36.6, 0.3, 0.4), craneDark); rail.position.set(0, 14.3, -6);
  root.add(rail);
  // Trolley and its hanging load, one pivot so the load can sway.
  const trolley = new THREE.Group(); trolley.position.set(0, 14.2, -6);
  const trolleyBox = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.9, 2.5), craneDark); trolley.add(trolleyBox);
  const load = new THREE.Group(); trolley.add(load);
  for (const cx of [-2.2, 2.2]) {
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 6.4, 5), craneDark);
    cable.position.set(cx, -3.4, 0); load.add(cable);
  }
  const spreader = new THREE.Mesh(new THREE.BoxGeometry(6.1, 0.35, 2.5), craneDark); spreader.position.y = -6.7;
  load.add(spreader); const hangTex = containerSideTexture(PALETTE.containerB, 'YL-7731', 991);
  const hangBox = new THREE.Mesh(
    new THREE.BoxGeometry(6.1, 2.6, 2.6),
    new THREE.MeshStandardMaterial({ map: hangTex, roughness: 0.58, metalness: 0.28 }),
  ); hangBox.position.y = -8.2;
  hangBox.castShadow = true; load.add(hangBox);
  root.add(trolley); anim.trolley = trolley;
  anim.load = load;
  // The crane's aircraft beacon and its halo.
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 10), new THREE.MeshBasicMaterial({ color: 0xff2a22 }));
  beacon.position.set(0, 16.25, -6); root.add(beacon);
  const beaconGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: 0xff352b, transparent: true, opacity: 0.7,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  beaconGlow.scale.set(2.6, 2.6, 1); beaconGlow.position.copy(beacon.position);
  root.add(beaconGlow); anim.beacon = beacon;
  anim.beaconGlow = beaconGlow;

  // ---- Distant skyline silhouettes outside the fence ----
  for (let i = 0; i < 10; i++) {
    const w = 8 + (i % 3) * 4, h = 8 + ((i * 7) % 14);
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, 6),
      new THREE.MeshBasicMaterial({ map: skylineTexture(500 + i * 43) }),
    ); m.position.set(-55 + i * 12, h / 2, -52 - (i % 2) * 8);
    root.add(m);
  }
  // ---- Waypoint graph: nodes joined by line of sight at head height ----
  const nodes = [
    { x: 0, z: 25 }, { x: -14, z: 18 }, { x: 14, z: 18 }, { x: 0, z: 13 },
    { x: -14, z: 3 }, { x: 14, z: 3 }, { x: -3, z: -4 }, { x: 4, z: -13 },
    { x: -14, z: -4 }, { x: -24, z: -4.5 }, { x: -24, z: -9.8 }, { x: -27.5, z: -17.5 },
    { x: -34, z: -23.5 }, { x: -19.5, z: -14 }, { x: -15.5, z: -14 }, { x: 27, z: -4.5 },
    { x: 27, z: -17 }, { x: 20.5, z: -11 }, { x: 35, z: -19.5 }, { x: 0, z: -25 },
    { x: -8, z: -22.5 }, { x: 8, z: -22.5 }, { x: 0, z: -19.5 }, { x: -6, z: 8 },
    { x: 8, z: 12.5 }, { x: -21, z: 13 }, { x: 21, z: 13 },
  ]; const edges = nodes.map(() => []);
  const probe = { x0: 0, z0: 0, x1: 0, z1: 0, h: 0 };
  function sightBetween(a, b) {
    const dx = b.x - a.x, dz = b.z - a.z; const len = Math.sqrt(dx * dx + dz * dz);
    if (len > 17.5) return false;
    for (const c of colliders) {
      if (c.h < 1.5) continue; // crates and barriers do not break a route
      probe.x0 = c.x0; probe.z0 = c.z0; probe.x1 = c.x1; probe.z1 = c.z1; probe.h = c.h;
      const t = rayBox(a.x, 1.5, a.z, dx / len, 0, dz / len, probe); if (t < len - 0.6) return false;
    }
    return true;
  }
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (sightBetween(nodes[i], nodes[j])) {
        edges[i].push(j); edges[j].push(i);
      }
    }
  }

  // Hold points: where defenders set up, and where attackers settle after a
  // plant. yaw faces the way the holder watches (0 faces north, -z).
  const holdPoints = {
    A: [
      { x: -33.5, z: -23.5, yaw: 2.6 }, { x: -20.5, z: -23.5, yaw: 3.6 },
      { x: -19, z: -9.8, yaw: 4.2 }, { x: -33, z: -11, yaw: 5.6 },
    ],
    B: [
      { x: 33.5, z: -24, yaw: 3.6 }, { x: 20.5, z: -21, yaw: 2.8 },
      { x: 29.5, z: -8.2, yaw: 4.4 }, { x: 34, z: -11, yaw: 5.8 },
    ],
    mid: [
      { x: -1, z: -19.5, yaw: 3.14 }, { x: -14, z: -5.5, yaw: 3.14 },
      { x: 13, z: -6, yaw: 3.14 },
    ],
  };

  const spawns = {
    atk: [-4, -2, 0, 2, 4].map((x, i) => ({ x, z: i % 2 ? 26.5 : 25.5, yaw: 0 })),
    def: [-4, -2, 0, 2, 4].map((x, i) => ({ x, z: i % 2 ? -26.5 : -25.5, yaw: Math.PI })),
  };

  return { colliders, sites, nodes, edges, holdPoints, spawns, root };
}

// The site a ground point falls in, or null out in the lanes.
export function siteAt(map, x, z) {
  for (const id of ['A', 'B']) {
    const s = map.sites[id]; if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1) return s;
  }
  return null;
}

// Shortest path over the waypoint graph (breadth-first). Returns a list of
// node indices including start and goal, or null when unreachable.
export function findPath(map, fromIdx, toIdx) {
  if (fromIdx === toIdx) return [fromIdx]; const prev = new Array(map.nodes.length).fill(-1);
  const queue = [fromIdx]; prev[fromIdx] = fromIdx;
  while (queue.length) {
    const cur = queue.shift();
    for (const next of map.edges[cur]) {
      if (prev[next] !== -1) continue; prev[next] = cur;
      if (next === toIdx) {
        const path = [toIdx]; let n = toIdx;
        while (n !== fromIdx) { n = prev[n]; path.unshift(n); }
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

export function nearestNode(map, x, z) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < map.nodes.length; i++) {
    const dx = map.nodes[i].x - x, dz = map.nodes[i].z - z; const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}
