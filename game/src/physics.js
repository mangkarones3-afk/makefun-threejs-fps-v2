// physics.js — collision and ray queries against the yard's box
// colliders. Everything here is allocation-free: callers pass scratch
// objects, results come back as numbers or through an out parameter.
// Colliders are { x0, z0, x1, z1, h }: a footprint on the ground plane
// and a height, which is all a yard of containers and walls needs.

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Move a circle (pos.x/pos.z, radius r) by (dx, dz), sliding along any
// collider it would enter. Axes resolve one at a time, which is what
// makes the slide feel right. Low clutter (h < .4) is stepped over.
export function moveCircle(pos, dx, dz, r, colliders) {
  pos.x += dx;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (c.h < .4) continue;
    if (pos.x + r <= c.x0 || pos.x - r >= c.x1 || pos.z + r <= c.z0 || pos.z - r >= c.z1) continue;
    if (dx > 0) pos.x = c.x0 - r;
    else if (dx < 0) pos.x = c.x1 + r;
    else pos.x = (pos.x - c.x0 < c.x1 - pos.x) ? c.x0 - r : c.x1 + r;
  }
  pos.z += dz;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (c.h < .4) continue;
    if (pos.x + r <= c.x0 || pos.x - r >= c.x1 || pos.z + r <= c.z0 || pos.z - r >= c.z1) continue;
    if (dz > 0) pos.z = c.z0 - r;
    else if (dz < 0) pos.z = c.z1 + r;
    else pos.z = (pos.z - c.z0 < c.z1 - pos.z) ? c.z0 - r : c.z1 + r;
  }
}

// Slab test of a ray against a box given by centre and half extents.
// Returns the entry distance, or Infinity when the ray misses (or the
// box lies wholly behind the origin). Written out per axis: this is
// the hottest query in the game and stays allocation-free.
export function rayBox(ox, oy, oz, dx, dy, dz, cx, cy, cz, hx, hy, hz) {
  let tmin = 0;
  let tmax = Infinity;
  if (Math.abs(dx) < 1e-9) {
    if (ox < cx - hx || ox > cx + hx) return Infinity;
  } else {
    let t1 = (cx - hx - ox) / dx;
    let t2 = (cx + hx - ox) / dx;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return Infinity;
  }
  if (Math.abs(dy) < 1e-9) {
    if (oy < cy - hy || oy > cy + hy) return Infinity;
  } else {
    let t1 = (cy - hy - oy) / dy;
    let t2 = (cy + hy - oy) / dy;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return Infinity;
  }
  if (Math.abs(dz) < 1e-9) {
    if (oz < cz - hz || oz > cz + hz) return Infinity;
  } else {
    let t1 = (cz - hz - oz) / dz;
    let t2 = (cz + hz - oz) / dz;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}

export function rayAABB(ox, oy, oz, dx, dy, dz, cx, cy, cz, hx, hy, hz) {
  return rayBox(ox, oy, oz, dx, dy, dz, cx, cy, cz, hx, hy, hz);
}

// Ray against a sphere: entry distance or Infinity.
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return Infinity;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return Infinity;
  return tca - Math.sqrt(r2 - d2);
}

// The nearest wall (or ground) hit along a ray, written into `out` as
// { t, x, y, z, hit }. The ground plane y=0 counts as a wall.
export function raycastWalls(ox, oy, oz, dx, dy, dz, maxDist, colliders, out) {
  let best = maxDist;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    const t = rayBox(ox, oy, oz, dx, dy, dz,
      (c.x0 + c.x1) / 2, c.h / 2, (c.z0 + c.z1) / 2,
      (c.x1 - c.x0) / 2, c.h / 2, (c.z1 - c.z0) / 2);
    if (t < best) best = t;
  }
  if (dy < -1e-9) {
    const tg = -oy / dy;
    if (tg >= 0 && tg < best) best = tg;
  }
  out.t = best;
  out.x = ox + dx * best;
  out.y = oy + dy * best;
  out.z = oz + dz * best;
  out.hit = best < maxDist;
  return out;
}

// Can a straight line be drawn from A to B without crossing a collider
// or a live smoke cloud? Smoke hangs centred at head height.
export function losClear(x0, y0, z0, x1, y1, z1, colliders, smokes, now) {
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return true;
  const inv = 1 / len;
  const ux = dx * inv, uy = dy * inv, uz = dz * inv;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    const t = rayBox(x0, y0, z0, ux, uy, uz,
      (c.x0 + c.x1) / 2, c.h / 2, (c.z0 + c.z1) / 2,
      (c.x1 - c.x0) / 2, c.h / 2, (c.z1 - c.z0) / 2);
    if (t > .01 && t < len - .01) return false;
  }
  for (let i = 0; i < smokes.length; i++) {
    const s = smokes[i];
    if (now > s.until) continue;
    const t = raySphere(x0, y0, z0, ux, uy, uz, s.x, 1.2, s.z, s.r);
    if (t > 0 && t < len) return false;
  }
  return true;
}
