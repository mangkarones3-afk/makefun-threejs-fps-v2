// textures.js — every surface is painted on canvases at boot.

import * as THREE from 'three';

// A small deterministic random source (mulberry32): same seed, same
// painting, on every machine and every run.
export function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function asTexture(canvas, repeat) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function darken(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) * f);
  const g = Math.min(255, ((n >> 8) & 255) * f);
  const b = Math.min(255, (n & 255) * f);
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

// The tide of grime that climbs every wall from the wet ground.
function grimeSkirt(g, w, y, h, alpha) {
  const grad = g.createLinearGradient(0, y, 0, y + h);
  grad.addColorStop(0, 'rgba(14,11,8,0)');
  grad.addColorStop(1, `rgba(14,11,8,${alpha})`);
  g.fillStyle = grad;
  g.fillRect(0, y, w, h);
}

// Rust bleeding downward from a top edge, each streak with a soft tail.
function rustWeep(g, rng, count, w, y0) {
  for (let i = 0; i < count; i++) {
    const x = rng() * w;
    const len = 20 + rng() * 105;
    const grad = g.createLinearGradient(0, y0, 0, y0 + len);
    grad.addColorStop(0, `rgba(94,48,20,${.25 + rng() * .3})`);
    grad.addColorStop(1, 'rgba(94,48,20,0)');
    g.fillStyle = grad;
    g.fillRect(x, y0, 2 + rng() * 5, len);
  }
}

// One long side of a shipping container: vertical ribs lit on one edge
// and shadowed on the other, rust from the top rail, a worn stencil.
export function containerSideTexture(hex, label, seed) {
  const rng = mulberry32(seed);
  const [c, g] = makeCanvas(512, 256);
  g.fillStyle = hex;
  g.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 26; i++) { // faded and dirty patches
    g.fillStyle = rng() < .5
      ? `rgba(255,238,205,${.03 + rng() * .05})`
      : `rgba(6,5,4,${.04 + rng() * .06})`;
    g.fillRect(rng() * 512, rng() * 190, 26 + rng() * 120, 18 + rng() * 84);
  }
  // The ribs: a 32px pitch, dark seam, bright catch-light, soft face.
  for (let x = 0; x < 512; x += 32) {
    const grad = g.createLinearGradient(x, 0, x + 32, 0);
    grad.addColorStop(0, 'rgba(0,0,0,.32)');
    grad.addColorStop(.38, 'rgba(255,255,255,.12)');
    grad.addColorStop(.64, 'rgba(255,255,255,.02)');
    grad.addColorStop(1, 'rgba(0,0,0,.32)');
    g.fillStyle = grad;
    g.fillRect(x, 0, 32, 256);
  }
  g.fillStyle = 'rgba(0,0,0,.3)';
  g.fillRect(0, 0, 512, 12);
  g.fillRect(0, 240, 512, 16);
  g.fillStyle = 'rgba(255,255,255,.09)';
  g.fillRect(0, 12, 512, 3);
  rustWeep(g, rng, 20, 512, 8);
  grimeSkirt(g, 512, 176, 80, .5);
  // The stencil.
  g.fillStyle = 'rgba(240,234,220,.88)';
  g.font = 'bold 62px ui-monospace, Menlo, monospace';
  g.textAlign = 'left';
  g.fillText(label, 28, 106);
  g.font = 'bold 24px ui-monospace, Menlo, monospace';
  g.fillStyle = 'rgba(240,234,220,.64)';
  g.fillText('YARDLINE FREIGHT CO.', 28, 146);
  g.font = '20px ui-monospace, Menlo, monospace';
  g.fillText('MAX GROSS 24000 KG', 28, 180);
  g.fillText('TARE 2180 KG', 28, 206);
  return asTexture(c, true);
}

// The container's end doors: split panels, four locking bars with
// handle blocks, hinges implied by shadow, the same rust story.
export function containerDoorTexture(hex, seed) {
  const rng = mulberry32(seed);
  const [c, g] = makeCanvas(256, 256);
  g.fillStyle = darken(hex, .92);
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 14; i++) {
    g.fillStyle = rng() < .5
      ? `rgba(255,238,205,${.03 + rng() * .04})`
      : `rgba(6,5,4,${.04 + rng() * .05})`;
    g.fillRect(rng() * 256, rng() * 200, 22 + rng() * 66, 18 + rng() * 66);
  }
  g.fillStyle = 'rgba(0,0,0,.4)';
  g.fillRect(126, 0, 4, 256);
  g.fillRect(0, 0, 256, 10);
  g.fillRect(0, 246, 256, 10);
  for (const x of [34, 96, 160, 222]) {
    g.fillStyle = 'rgba(0,0,0,.34)';
    g.fillRect(x - 4, 8, 9, 240);
    g.fillStyle = 'rgba(255,255,255,.15)';
    g.fillRect(x - 4, 8, 3, 240);
    g.fillStyle = 'rgba(18,17,15,.85)';
    g.fillRect(x - 9, 128, 19, 30);
  }
  rustWeep(g, rng, 13, 256, 6);
  grimeSkirt(g, 256, 180, 76, .48);
  return asTexture(c, true);
}

// Cast concrete: dense fine noise, formwork seams, damp blotches.
export function concreteTexture() {
  const rng = mulberry32(4177);
  const [c, g] = makeCanvas(256, 256);
  g.fillStyle = '#868c92';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 4800; i++) {
    g.fillStyle = rng() < .5 ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.06)';
    g.fillRect(rng() * 256, rng() * 256, 1.8, 1.8);
  }
  for (let i = 0; i < 7; i++) {
    const x = rng() * 256, y = rng() * 256, r = 15 + rng() * 44;
    const grad = g.createRadialGradient(x, y, 2, x, y, r);
    grad.addColorStop(0, `rgba(50,48,42,${.08 + rng() * .1})`);
    grad.addColorStop(1, 'rgba(50,48,42,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  g.fillStyle = 'rgba(0,0,0,.15)';
  g.fillRect(0, 84, 256, 2);
  g.fillRect(0, 170, 256, 2);
  grimeSkirt(g, 256, 205, 51, .38);
  return asTexture(c, true);
}

// Silo plate: pale steel, vertical seams, two weld bands, rust at the rim.
export function siloTexture() {
  const rng = mulberry32(9021);
  const [c, g] = makeCanvas(256, 256);
  g.fillStyle = '#a6adb3';
  g.fillRect(0, 0, 256, 256);
  for (let x = 0; x < 256; x += 64) {
    g.fillStyle = 'rgba(0,0,0,.12)';
    g.fillRect(x, 0, 2, 256);
    g.fillStyle = 'rgba(255,255,255,.1)';
    g.fillRect(x + 2, 0, 2, 256);
  }
  for (const y of [70, 158]) {
    g.fillStyle = 'rgba(0,0,0,.27)';
    g.fillRect(0, y, 256, 5);
    g.fillStyle = 'rgba(255,255,255,.11)';
    g.fillRect(0, y + 5, 256, 2);
  }
  rustWeep(g, rng, 15, 256, 4);
  grimeSkirt(g, 256, 190, 66, .4);
  return asTexture(c, true);
}

// A soft round glow: lamp halos, explosion bloom, the moon's halo.
export function glowTexture() {
  const [c, g] = makeCanvas(128, 128);
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 63);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(.25, 'rgba(255,255,255,.42)');
  grad.addColorStop(.6, 'rgba(255,255,255,.12)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return asTexture(c, false);
}

// The sky in one tall painting: near-black zenith, a deep blue
// shoulder, and low in the west the sodium bloom of the city. Stars
// thicken with altitude and drown in the glow near the horizon.
export function skyTexture() {
  const [c, g] = makeCanvas(1024, 512);
  const v = g.createLinearGradient(0, 0, 0, 512);
  v.addColorStop(0, '#020409');
  v.addColorStop(.34, '#081020');
  v.addColorStop(.55, '#14233f');
  v.addColorStop(.72, '#2c2c48');
  v.addColorStop(.86, '#6e4a34');
  v.addColorStop(1, '#a86a38');
  g.fillStyle = v;
  g.fillRect(0, 0, 1024, 512);
  const bloom = g.createRadialGradient(307, 478, 8, 307, 478, 340);
  bloom.addColorStop(0, 'rgba(255,186,105,.75)');
  bloom.addColorStop(.35, 'rgba(240,150,70,.34)');
  bloom.addColorStop(1, 'rgba(240,150,70,0)');
  g.fillStyle = bloom;
  g.fillRect(0, 0, 1024, 512);
  const rng = mulberry32(5150);
  for (let i = 0; i < 300; i++) {
    const y = rng() * 230;
    g.fillStyle = `rgba(255,255,255,${(.25 + rng() * .65) * (1 - y / 260)})`;
    g.fillRect(rng() * 1024, y, 1.6, 1.6);
  }
  const t = asTexture(c, false);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// One rain filament: bright in the middle, gone at both ends, pinched
// at the sides — the sprite a falling streak is drawn with.
export function rainTexture() {
  const [c, g] = makeCanvas(16, 64);
  const grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(.5, 'rgba(255,255,255,.85)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(6, 0, 4, 64);
  const side = g.createLinearGradient(0, 0, 16, 0);
  side.addColorStop(0, 'rgba(0,0,0,1)');
  side.addColorStop(.5, 'rgba(0,0,0,0)');
  side.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = side;
  g.fillRect(0, 0, 16, 64);
  g.globalCompositeOperation = 'source-over';
  return asTexture(c, false);
}
