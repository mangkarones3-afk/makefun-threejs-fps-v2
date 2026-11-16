// map.js — the yard itself: an 80 by 60 metre freight yard at night.
// Alongside the meshes it builds the invisible structure the game
// reasons with: box colliders, two plant sites, a waypoint graph for
// the bots, hold points and spawn points.

import * as THREE from 'three';
import { G } from './state.js';
import { rayBox } from './physics.js';
import {
  containerSideTexture, containerDoorTexture, concreteTexture,
  siloTexture, glowTexture, mulberry32,
} from './textures.js';
import { PUDDLE_VERT, PUDDLE_FRAG } from './shaders.js';

const SITES = {
  A: { id: 'A', name: 'Loading Dock', x0: -35, z0: -25, x1: -20, z1: -10, cx: -27.5, cz: -17.5 },
  B: { id: 'B', name: 'Tank Farm', x0: 19, z0: -25, x1: 35, z1: -9, cx: 27, cz: -17 },
};
const NODE_XY = [
  [0, 25], [-14, 18], [14, 18], [0, 13], [-14, 3], [14, 3], [-3, -4],
  [4, -13], [-14, -4], [-24, -4.5], [-24, -9.8], [-27.5, -17.5],
  [-34, -23.5], [-19.5, -14], [-15.5, -14], [27, -4.5], [27, -17],
  [20.5, -11], [35, -19.5], [0, -25], [-8, -22.5], [8, -22.5],
  [0, -19.5], [-6, 8], [8, 12.5], [-21, 13], [21, 13],
];
// [centreX, centreZ, length, axis ('x' runs the length east-west), height]
const CONTAINERS = [
  [-6, -10, 11, 'x', 2.6], [5, -4, 11, 'z', 2.6], [-2, 2, 11, 'x', 2.6],
  [-11, 5, 9, 'z', 2.6], [8, 8, 8, 'x', 2.6], [0, -17, 11, 'x', 5.2],
  [-21, 16, 11, 'x', 2.6], [19, 16, 11, 'x', 2.6], [-20.5, 2, 8, 'z', 2.6],
];
const PAINT = ['#b3541e', '#205f7a', '#5d7052', '#7a3038', '#4a4f57', '#8a6d1f', '#2e5e4e', '#6e4520', '#37506b'];
const LAMPS = [[-14, -18], [14, -18], [-14, 14], [14, 14]];
const PUDDLES = [[3, -6, 2.6], [-9, 11, 3.1], [12, -14, 2.2], [-24, 6, 2.8], [24, 20, 3.3], [-2, -24, 2.0], [8, 22, 2.4]];


let puddleUniforms = null;

export function siteAt(map, x, z) {
  for (const key of ['A', 'B']) {
    const s = map.sites[key];
    if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1) return s;
  }
  return null;
}

export function nearestNode(map, x, z) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < map.nodes.length; i++) {
    const dx = map.nodes[i].x - x, dz = map.nodes[i].z - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// Breadth-first over the waypoint graph; null when no path exists.
export function findPath(map, from, to) {
  if (from === to) return [from];
  const prev = new Int32Array(map.nodes.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  while (queue.length) {
    const cur = queue.shift();
    for (const next of map.edges[cur]) {
      if (prev[next] !== -1) continue;
      prev[next] = cur;
      if (next === to) {
        const path = [to];
        let n = to;
        while (n !== from) { n = prev[n]; path.unshift(n); }
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

// The painted ground: asphalt, oil, lane paint, hazard aprons and the
// site letters in one 2048x1536 canvas (25.6 px per metre).
function groundTexture() {
  const S = 25.6;
  const c = document.createElement('canvas');
  c.width = 2048; c.height = 1536;
  const g = c.getContext('2d');
  const px = (x) => (x + 40) * S, pz = (z) => (z + 30) * S;
  const rng = mulberry32(31415);
  g.fillStyle = '#2f3338';
  g.fillRect(0, 0, 2048, 1536);
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = rng() < .5 ? 'rgba(255,255,255,.045)' : 'rgba(0,0,0,.06)';
    g.fillRect(rng() * 2048, rng() * 1536, 2, 2);
  }
  g.strokeStyle = 'rgba(232,226,210,.34)';
  g.lineWidth = 5;
  g.setLineDash([46, 30]);
  for (const x of [-3.4, 3.4]) { g.beginPath(); g.moveTo(px(x), pz(-27)); g.lineTo(px(x), pz(27)); g.stroke(); }
  g.setLineDash([]);
  for (const key of ['A', 'B']) { // hazard aprons and site letters
    const s = SITES[key];
    g.strokeStyle = 'rgba(240,170,60,.65)';
    g.lineWidth = 7;
    g.strokeRect(px(s.x0), pz(s.z0), (s.x1 - s.x0) * S, (s.z1 - s.z0) * S);
    g.fillStyle = 'rgba(240,170,60,.5)';
    g.font = 'bold 150px ui-monospace, Menlo, monospace';
    g.textAlign = 'center';
    g.fillText(key, px(s.cx), pz(s.cz) + 52);
    g.font = 'bold 34px ui-monospace, Menlo, monospace';
    g.fillStyle = 'rgba(240,236,220,.4)';
    g.fillText(s.name.toUpperCase(), px(s.cx), pz(s.cz) + 108);
  }
  for (const [x, z, r] of PUDDLES) { // wet blotches under the shader puddles
    const grad = g.createRadialGradient(px(x), pz(z), 2, px(x), pz(z), r * S);
    grad.addColorStop(0, 'rgba(16,20,28,.5)');
    grad.addColorStop(1, 'rgba(16,20,28,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(px(x), pz(z), r * S, 0, 7); g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function buildMap(scene) {
  const root = new THREE.Group();
  scene.add(root);
  const colliders = [];
  const dripPoints = [];
  const addCollider = (x0, z0, x1, z1, h) => colliders.push({ x0, z0, x1, z1, h });

  const concrete = new THREE.MeshStandardMaterial({ map: concreteTexture(), roughness: .9, metalness: .02 });
  const darkSteel = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: .55, metalness: .5 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x1b1e24, roughness: .8, metalness: .2 });
  const box = (w, h, d, mat, x, y, z, parent = root) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  // A wall is a collider and its mesh in one breath.
  const wall = (x0, z0, x1, z1, h, mat = concrete) => {
    addCollider(x0, z0, x1, z1, h);
    box(x1 - x0, h, z1 - z0, mat, (x0 + x1) / 2, h / 2, (z0 + z1) / 2);
  };

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 60),
    new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: .34, metalness: .08 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  root.add(ground);

  // Perimeter.
  wall(-40.4, -30.4, 40.4, -29.6, 3.2);
  wall(-40.4, 29.6, 40.4, 30.4, 3.2);
  wall(-40.4, -30, -39.6, 30, 3.2);
  wall(39.6, -30, 40.4, 30, 3.2);

  // The warehouse (Site A): walls with door gaps, and a roof.
  wall(-38, -25.4, -30.2, -24.6, 3.4);
  wall(-24.8, -25.4, -17, -24.6, 3.4);
  wall(-38.4, -25, -37.6, -8.6, 3.4);
  wall(-17.4, -25, -16.6, -14.6, 3.4);
  wall(-17.4, -11.4, -16.6, -8.6, 3.4);
  wall(-38, -9, -30.6, -8.2, 3.4);
  wall(-23.4, -9, -17, -8.2, 3.4);
  const roof = box(21.6, .25, 17, roofMat, -27.5, 3.5, -16.8);
  roof.castShadow = false;
  for (const [x, z] of [[-33, -20], [-22, -20], [-33, -13], [-22, -13]]) { // pillars
    addCollider(x - .25, z - .25, x + .25, z + .25, 3.4);
    box(.5, 3.4, .5, darkSteel, x, 1.7, z);
  }
  for (const [x, z] of [[-35.5, -11.5], [-19.5, -22.5]]) { // interior crates
    addCollider(x - .9, z - .9, x + .9, z + .9, 1.8);
    box(1.8, 1.8, 1.8, darkSteel, x, .9, z);
  }
  dripPoints.push({ x: -30, y: 3.4, z: -8.2 }, { x: -21, y: 3.4, z: -8.2 }, { x: -27, y: 3.4, z: -24.4 });

  // The tank farm (Site B): three silos, a pump unit, low barriers.
  const siloMat = new THREE.MeshStandardMaterial({ map: siloTexture(), roughness: .42, metalness: .55 });
  for (const [x, z] of [[23.5, -21], [30.5, -21], [27, -13.5]]) {
    addCollider(x - 2.1, z - 2.1, x + 2.1, z + 2.1, 5);
    const silo = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 5, 20), siloMat);
    silo.position.set(x, 2.5, z);
    silo.castShadow = true; silo.receiveShadow = true;
    root.add(silo);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(2.45, .9, 20), darkSteel);
    cap.position.set(x, 5.45, z);
    root.add(cap);
  }
  addCollider(19.8, -13.1, 22.2, -11.9, 1.1);
  box(2.4, 1.1, 1.2, darkSteel, 21, .55, -12.5);
  const pumpTank = new THREE.Mesh(new THREE.CylinderGeometry(.42, .42, 1.9, 12), siloMat);
  pumpTank.rotation.z = Math.PI / 2;
  pumpTank.position.set(21, 1.35, -12.5);
  root.add(pumpTank);
  wall(20, -24.4, 34, -23.8, .55);
  wall(33.9, -23, 34.5, -11, .55);

  // Containers: side texture on the long faces, doors on the ends.
  CONTAINERS.forEach(([cx, cz, len, axis, h], idx) => {
    const paint = PAINT[idx % PAINT.length];
    const side = new THREE.MeshStandardMaterial({ map: containerSideTexture(paint, `YL-${1042 + idx * 137}`, 500 + idx * 31), roughness: .62, metalness: .28 });
    const door = new THREE.MeshStandardMaterial({ map: containerDoorTexture(paint, 900 + idx * 17), roughness: .62, metalness: .28 });
    const top = new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: .8, metalness: .3 });
    const group = new THREE.Group();
    for (let lvl = 0; lvl < (h > 3 ? 2 : 1); lvl++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(len, 2.6, 2.6), [door, door, top, top, side, side]);
      m.position.y = 1.3 + lvl * 2.6;
      m.castShadow = true; m.receiveShadow = true;
      group.add(m);
    }
    group.position.set(cx, 0, cz);
    if (axis === 'z') group.rotation.y = Math.PI / 2;
    root.add(group);
    if (axis === 'x') addCollider(cx - len / 2, cz - 1.3, cx + len / 2, cz + 1.3, h);
    else addCollider(cx - 1.3, cz - len / 2, cx + 1.3, cz + len / 2, h);
    // Rain drips off the two ends of the top front edge.
    if (axis === 'x') dripPoints.push({ x: cx - len * .38, y: h, z: cz + 1.35 }, { x: cx + len * .38, y: h, z: cz + 1.35 });
    else dripPoints.push({ x: cx + 1.35, y: h, z: cz - len * .38 }, { x: cx + 1.35, y: h, z: cz + len * .38 });
  });

  // Loose crates and low barriers.
  for (const [x, z, s, h] of [[-14.5, -1, 1.2, 1.2], [14.5, -2, 1.2, 1.2], [0, -20, 1.6, 1.2]]) {
    addCollider(x - s / 2, z - s / 2, x + s / 2, z + s / 2, h);
    box(s, h, s, darkSteel, x, h / 2, z);
  }
  wall(11.7, -2.8, 12.3, 1.8, .55);
  wall(-15.3, 13.2, -10.7, 13.8, .55);
  wall(13.7, 9.7, 18.3, 10.3, .55);
  wall(-8.3, -24.3, -3.7, -23.7, .55);
  wall(23.7, -.3, 24.3, 4.3, .55);

  // Floodlights: pole, head, halo and ground pool. The wet specular
  // streaks themselves are the puddle shader's job.
  const glowTex = glowTexture();
  const lampPositions = [];
  const addSprite = (mat, x, y, z, s) => {
    const spr = new THREE.Sprite(mat);
    spr.position.set(x, y, z);
    spr.scale.set(s, s, 1);
    root.add(spr);
    return spr;
  };
  for (const [x, z] of LAMPS) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.09, .13, 6.2, 8), darkSteel);
    pole.position.set(x, 3.1, z);
    pole.castShadow = true;
    root.add(pole);
    box(.9, .22, .4, darkSteel, x, 6.25, z);
    const lampFace = new THREE.Mesh(new THREE.PlaneGeometry(.8, .3), new THREE.MeshBasicMaterial({ color: 0xffc98a }));
    lampFace.position.set(x, 6.12, z);
    lampFace.rotation.x = Math.PI / 3;
    root.add(lampFace);
    addSprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff9a4d, transparent: true, opacity: .5, blending: THREE.AdditiveBlending, depthWrite: false }), x, 6.2, z, 8);
    const pool = new THREE.Mesh(new THREE.CircleGeometry(6.4, 24),
      new THREE.MeshBasicMaterial({ map: glowTex, color: 0xff9a4d, transparent: true, opacity: .17, blending: THREE.AdditiveBlending, depthWrite: false }));
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(x, .02, z);
    root.add(pool);
    lampPositions.push(new THREE.Vector3(x, 6.2, z));
  }

  // Site markers: a painted ring on the ground at each site.
  for (const key of ['A', 'B']) {
    const s = SITES[key];
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.9, 2.25, 40),
      new THREE.MeshBasicMaterial({ color: 0xffb45e, transparent: true, opacity: .55, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(s.cx, .03, s.cz);
    root.add(ring);
  }

  // Puddles: fresnel plates with lamp glints (see shaders.js).
  puddleUniforms = {
    uCamPos: { value: new THREE.Vector3() },
    uLamps: { value: lampPositions.map((p) => new THREE.Vector4(p.x, p.y, p.z, 2.6)) },
    uLampColor: { value: new THREE.Color(0xff9a3e) },
    uSkyColor: { value: new THREE.Color(0x2a3c5e) },
  };
  const puddleMat = new THREE.ShaderMaterial({ vertexShader: PUDDLE_VERT, fragmentShader: PUDDLE_FRAG, uniforms: puddleUniforms, transparent: true, depthWrite: false });
  for (const [x, z, r] of PUDDLES) {
    const p = new THREE.Mesh(new THREE.CircleGeometry(r, 26), puddleMat);
    p.rotation.x = -Math.PI / 2;
    p.position.set(x, .03, z);
    root.add(p);
  }

  // The waypoint graph: edges where a walker at head height has a
  // clear straight line, at most 17.5 m long.
  const nodes = NODE_XY.map(([x, z]) => ({ x, z }));
  const edges = nodes.map(() => []);
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[j].x - nodes[i].x, dz = nodes[j].z - nodes[i].z;
      const len = Math.hypot(dx, dz);
      if (len > 17.5) continue;
      let blocked = false;
      for (const col of colliders) {
        if (col.h < 1.5) continue;
        const t = rayBox(nodes[i].x, 1.5, nodes[i].z, dx / len, 0, dz / len,
          (col.x0 + col.x1) / 2, col.h / 2, (col.z0 + col.z1) / 2,
          (col.x1 - col.x0) / 2, col.h / 2, (col.z1 - col.z0) / 2);
        if (t < len - .6) { blocked = true; break; }
      }
      if (!blocked) { edges[i].push(j); edges[j].push(i); }
    }
  }

  const holdPoints = {
    A: [{ x: -31, z: -21, yaw: 2.6 }, { x: -24.5, z: -12, yaw: -2.8 }, { x: -19.5, z: -19, yaw: 1.8 }, { x: -33, z: -11, yaw: -.6 }],
    B: [{ x: 22.5, z: -21.5, yaw: 2.8 }, { x: 32, z: -12.5, yaw: -2.4 }, { x: 24, z: -10.5, yaw: .4 }, { x: 33.5, z: -20, yaw: 1.2 }],
    mid: [{ x: -6, z: -8, yaw: .3 }, { x: 7, z: 4, yaw: -2.9 }, { x: -13, z: 11, yaw: 1.2 }, { x: 13, z: -13, yaw: -1.8 }],
  };
  const spawns = {
    atk: [0, 1, 2, 3, 4].map((i) => ({ x: -4 + i * 2, z: i % 2 ? 26.5 : 25.5, yaw: 0 })),
    def: [0, 1, 2, 3, 4].map((i) => ({ x: -4 + i * 2, z: i % 2 ? -26.5 : -25.5, yaw: Math.PI })),
  };
  return { colliders, sites: { A: SITES.A, B: SITES.B }, nodes, edges, holdPoints, spawns, root, dripPoints, lampPositions };
}

// Per-frame dressing: the puddles tracking the camera.
export function tickMap(dt) {
  if (puddleUniforms && G.camera) puddleUniforms.uCamPos.value.copy(G.camera.position);
}
