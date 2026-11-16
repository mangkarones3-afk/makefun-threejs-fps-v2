// textures.js — every upright surface in the yard is painted in code on a
// canvas: container steel with ribs, rust and stencilled fleet numbers,
// concrete, silo steel, the lit windows of the skyline, glow sprites,
// rain streaks and the night sky itself. A seeded RNG paints them, so
// the yard is the same yard on every machine — the entry ships no images.

import * as THREE from 'three';

export function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0; let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function toTex(c, repeat = false) {
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4; if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Shade a '#rrggbb' colour toward black (f<1) or white (f>1).
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) * f), g = Math.min(255, ((n >> 8) & 255) * f), b = Math.min(255, (n & 255) * f);
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

// The grime tide every upright surface wears at its foot.
function skirt(g, w, y0, h, alpha) {
  const grad = g.createLinearGradient(0, y0, 0, y0 + h); grad.addColorStop(0, 'rgba(16,12,8,0)');
  grad.addColorStop(1, `rgba(16,12,8,${alpha})`);
  g.fillStyle = grad; g.fillRect(0, y0, w, h);
}

// Rust weeping down from a top edge: streaks with soft tails.
function rust(g, rng, count, w, y0) {
  for (let i = 0; i < count; i++) {
    const x = rng() * w, len = 22 + rng() * 100; const grad = g.createLinearGradient(0, y0, 0, y0 + len);
    grad.addColorStop(0, `rgba(96,50,22,${0.28 + rng() * 0.3})`);
    grad.addColorStop(1, 'rgba(96,50,22,0)'); g.fillStyle = grad;
    g.fillRect(x, y0, 2 + rng() * 6, len);
  }
}

// A container's long side: baked base colour, vertical ribs with a light
// edge and a dark seam, rust weeping from the top rail and the door gear,
export function containerSideTexture(hex, label, seed) {
  const rng = mulberry32(seed); const [c, g] = canvas(512, 256);
  g.fillStyle = hex; g.fillRect(0, 0, 512, 256);
  // Broad tonal patches: sun-faded panels and dock grime.
  for (let i = 0; i < 30; i++) {
    g.fillStyle = rng() < 0.5 ? `rgba(255,240,210,${0.03 + rng() * 0.05})` : `rgba(8,6,4,${0.04 + rng() * 0.06})`;
    g.fillRect(rng() * 512, rng() * 200, 30 + rng() * 130, 20 + rng() * 90);
  }
  // Ribs.
  for (let x = 0; x < 512; x += 32) {
    const grad = g.createLinearGradient(x, 0, x + 32, 0); grad.addColorStop(0, 'rgba(0,0,0,0.34)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.13)'); grad.addColorStop(0.62, 'rgba(255,255,255,0.02)');
    grad.addColorStop(1, 'rgba(0,0,0,0.34)'); g.fillStyle = grad;
    g.fillRect(x, 0, 32, 256);
  }
  // Top and bottom rails.
  g.fillStyle = 'rgba(0,0,0,0.30)'; g.fillRect(0, 0, 512, 12);
  g.fillRect(0, 240, 512, 16); g.fillStyle = 'rgba(255,255,255,0.10)';
  g.fillRect(0, 12, 512, 3); rust(g, rng, 22, 512, 8);
  for (let i = 0; i < 12; i++) { // rust bloom spots
    const x = rng() * 512, y = 120 + rng() * 120, r = 4 + rng() * 16;
    const grad = g.createRadialGradient(x, y, 1, x, y, r);
    grad.addColorStop(0, `rgba(88,44,20,${0.25 + rng() * 0.25})`);
    grad.addColorStop(1, 'rgba(88,44,20,0)'); g.fillStyle = grad;
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  skirt(g, 512, 176, 80, 0.52);
  // The stencil, worn: paint it, then knock speckles back out.
  g.fillStyle = 'rgba(242,236,222,0.88)'; g.font = 'bold 64px ui-monospace, Menlo, monospace';
  g.textAlign = 'left'; g.fillText(label, 30, 108);
  g.font = 'bold 25px ui-monospace, Menlo, monospace'; g.fillStyle = 'rgba(242,236,222,0.66)';
  g.fillText('YARDLINE FREIGHT CO.', 30, 148); g.font = '21px ui-monospace, Menlo, monospace';
  g.fillText('MAX GROSS 24000 KG', 30, 182); g.fillText('TARE 2180 KG', 30, 208);
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 700; i++) {
    g.fillStyle = `rgba(0,0,0,${0.25 + rng() * 0.5})`;
    g.fillRect(24 + rng() * 330, 52 + rng() * 165, 2.2, 2.2);
  }
  g.globalCompositeOperation = 'source-over'; return toTex(c, true);
}

// A container's end doors: two panels, four locking bars, hinges, and the
// same rust and grime story as the sides.
export function containerDoorTexture(hex, seed) {
  const rng = mulberry32(seed); const [c, g] = canvas(256, 256);
  g.fillStyle = shade(hex, 0.92); g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 16; i++) {
    g.fillStyle = rng() < 0.5 ? `rgba(255,240,210,${0.03 + rng() * 0.04})` : `rgba(8,6,4,${0.04 + rng() * 0.05})`;
    g.fillRect(rng() * 256, rng() * 200, 24 + rng() * 70, 20 + rng() * 70);
  }
  // Door split and frame.
  g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(126, 0, 4, 256);
  g.fillRect(0, 0, 256, 10); g.fillRect(0, 246, 256, 10);
  // Locking bars with handle blocks.
  for (const x of [34, 96, 160, 222]) {
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x - 4, 8, 9, 240);
    g.fillStyle = 'rgba(255,255,255,0.16)'; g.fillRect(x - 4, 8, 3, 240);
    g.fillStyle = 'rgba(20,18,16,0.85)'; g.fillRect(x - 9, 128, 19, 30);
  }
  rust(g, rng, 14, 256, 6); skirt(g, 256, 180, 76, 0.5);
  return toTex(c, true);
}


// Cast concrete: fine noise, formwork lines, water stains, chipped edges.
export function concreteTexture() {
  const rng = mulberry32(9021); const [c, g] = canvas(256, 256);
  g.fillStyle = '#878d93'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5200; i++) {
    g.fillStyle = rng() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
    g.fillRect(rng() * 256, rng() * 256, 1.8, 1.8);
  }
  for (let i = 0; i < 8; i++) {
    const x = rng() * 256, y = rng() * 256, r = 16 + rng() * 46;
    const grad = g.createRadialGradient(x, y, 2, x, y, r);
    grad.addColorStop(0, `rgba(52,50,44,${0.08 + rng() * 0.1})`);
    grad.addColorStop(1, 'rgba(52,50,44,0)'); g.fillStyle = grad;
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(0, 84, 256, 2);
  g.fillRect(0, 170, 256, 2); skirt(g, 256, 205, 51, 0.4);
  return toTex(c, true);
}

// A silo's skin: pale steel panels, two weld bands, rust weeping from the
// rim and a stained skirt.
export function siloTexture() {
  const rng = mulberry32(7331); const [c, g] = canvas(256, 256);
  g.fillStyle = '#a7aeb4'; g.fillRect(0, 0, 256, 256);
  for (let x = 0; x < 256; x += 64) {
    g.fillStyle = 'rgba(0,0,0,0.13)'; g.fillRect(x, 0, 2, 256);
    g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(x + 2, 0, 2, 256);
  }
  for (const y of [70, 158]) {
    g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(0, y, 256, 5);
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, y + 5, 256, 2);
  }
  rust(g, rng, 16, 256, 4); skirt(g, 256, 190, 66, 0.42);
  return toTex(c, true);
}

// A distant tower at dusk: near-black facade, a grid of windows, some lit
// warm, some lit cool, most dark. Drawn once per tower with its own seed.
export function skylineTexture(seed) {
  const rng = mulberry32(seed); const [c, g] = canvas(256, 256);
  g.fillStyle = '#141a26'; g.fillRect(0, 0, 256, 256);
  const cols = 9, rows = 16; const cw = 256 / cols, ch = 256 / rows;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const r = rng();
      if (r < 0.30) g.fillStyle = `rgba(255,${176 + rng() * 40 | 0},110,${0.55 + rng() * 0.4})`;
      else if (r < 0.38) g.fillStyle = `rgba(168,198,255,${0.4 + rng() * 0.3})`;
      else g.fillStyle = 'rgba(38,46,62,0.9)'; g.fillRect(i * cw + 3, j * ch + 4, cw - 6, ch - 7);
    }
  }
  return toTex(c);
}

// A soft round glow sprite (lamp halos, the sun's bloom, beacons).
export function glowTexture() {
  const [c, g] = canvas(128, 128); const grad = g.createRadialGradient(64, 64, 2, 64, 64, 63);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.25, 'rgba(255,255,255,0.42)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.12)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  return toTex(c);
}


// The night sky as one tall gradient: near-black zenith with early
// stars, a deep blue band, and low over the yard's west end a sodium
export function skyTexture() {
  const [c, g] = canvas(1024, 512); const v = g.createLinearGradient(0, 0, 0, 512);
  v.addColorStop(0, '#020409'); v.addColorStop(0.34, '#081020');
  v.addColorStop(0.55, '#14233f'); v.addColorStop(0.72, '#2c2c48');
  v.addColorStop(0.86, '#6e4a34'); v.addColorStop(1, '#a86a38');
  g.fillStyle = v; g.fillRect(0, 0, 1024, 512);
  // The sodium bloom, centred at u=0.30 of the wrap, low and wide.
  const bloom = g.createRadialGradient(307, 478, 8, 307, 478, 340); bloom.addColorStop(0, 'rgba(255,186,105,0.75)');
  bloom.addColorStop(0.35, 'rgba(240,150,70,0.34)'); bloom.addColorStop(1, 'rgba(240,150,70,0)');
  g.fillStyle = bloom; g.fillRect(0, 0, 1024, 512);
  // Stars, thick in the upper sky, drowned near the horizon glow.
  const rng = mulberry32(2024);
  for (let i = 0; i < 320; i++) {
    const y = rng() * 230;
    g.fillStyle = `rgba(255,255,255,${(0.25 + rng() * 0.65) * (1 - y / 260)})`;
    g.fillRect(rng() * 1024, y, 1.6, 1.6);
  }
  const tex = toTex(c); tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

// A rain streak: one thin vertical filament, bright in the middle,
// gone at both ends — the sprite the rain points carry.
export function rainTexture() {
  const [c, g] = canvas(16, 64); const grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0)'); grad.addColorStop(0.5, 'rgba(255,255,255,0.85)');
  grad.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = grad;
  g.fillRect(6, 0, 4, 64); const side = g.createLinearGradient(0, 0, 16, 0);
  side.addColorStop(0, 'rgba(0,0,0,1)'); side.addColorStop(0.5, 'rgba(0,0,0,0)');
  side.addColorStop(1, 'rgba(0,0,0,1)'); g.globalCompositeOperation = 'destination-out';
  g.fillStyle = side; g.fillRect(0, 0, 16, 64);
  g.globalCompositeOperation = 'source-over'; return toTex(c);
}
