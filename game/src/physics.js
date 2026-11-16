// physics.js — movement and ray tests against the map's box colliders.
// A collider is { x0, z0, x1, z1, h }: a box standing on the ground (y = 0)
// reaching h metres up. The yard is flat, so actors live at y = 0 and only
// their eye height changes. All hot functions write into caller-owned
// scratch objects instead of allocating.

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function dist2D(ax, az, bx, bz) {
  const dx = ax - bx, dz = az - bz; return Math.sqrt(dx * dx + dz * dz);
}

// Move a circle (actor position + radius) through the world, one axis at a
// time so actors slide along walls instead of sticking to them. pos is
export function moveCircle(pos, dx, dz, radius, colliders) {
  pos.x += dx;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i]; if (c.h < 0.4) continue;
    if (pos.x > c.x0 - radius && pos.x < c.x1 + radius && pos.z > c.z0 - radius && pos.z < c.z1 + radius) {
      pos.x = dx > 0 ? c.x0 - radius : c.x1 + radius;
    }
  }
  pos.z += dz;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i]; if (c.h < 0.4) continue;
    if (pos.x > c.x0 - radius && pos.x < c.x1 + radius && pos.z > c.z0 - radius && pos.z < c.z1 + radius) {
      pos.z = dz > 0 ? c.z0 - radius : c.z1 + radius;
    }
  }
}

// Slab test of a ray against one box (y from 0 to h). Returns the entry
// distance along the ray, or Infinity when it misses or starts inside.
export function rayBox(ox, oy, oz, dx, dy, dz, c) {
  let tmin = 0, tmax = Infinity;
  if (Math.abs(dx) < 1e-9) {
    if (ox < c.x0 || ox > c.x1) return Infinity;
  } else {
    let t1 = (c.x0 - ox) / dx, t2 = (c.x1 - ox) / dx;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); if (tmin > tmax) return Infinity;
  }
  if (Math.abs(dz) < 1e-9) {
    if (oz < c.z0 || oz > c.z1) return Infinity;
  } else {
    let t1 = (c.z0 - oz) / dz, t2 = (c.z1 - oz) / dz;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); if (tmin > tmax) return Infinity;
  }
  if (Math.abs(dy) < 1e-9) {
    if (oy < 0 || oy > c.h) return Infinity;
  } else {
    let t1 = (0 - oy) / dy, t2 = (c.h - oy) / dy;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); if (tmin > tmax) return Infinity;
  }
  return tmin;
}

// Nearest wall hit along a ray, written into out { t, x, y, z }.
export function raycastWalls(ox, oy, oz, dx, dy, dz, maxT, colliders, out) {
  let best = maxT;
  for (let i = 0; i < colliders.length; i++) {
    const t = rayBox(ox, oy, oz, dx, dy, dz, colliders[i]); if (t < best) best = t;
  }
  out.t = best; out.x = ox + dx * best;
  out.y = oy + dy * best; out.z = oz + dz * best;
  out.hit = best < maxT; return out;
}

// Ray against a sphere; returns entry distance or Infinity.
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz; const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return Infinity; const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r; if (d2 > r2) return Infinity;
  return tca - Math.sqrt(r2 - d2);
}

// Ray against a free-standing box given by centre and half extents.
export function rayAABB(ox, oy, oz, dx, dy, dz, cx, cy, cz, hx, hy, hz) {
  const box = _box; box.x0 = cx - hx; box.x1 = cx + hx;
  box.z0 = cz - hz; box.z1 = cz + hz; box.h = cy + hy;
  const t = rayBox(ox, oy, oz, dx, dy, dz, box); if (t === Infinity) return Infinity;
  // rayBox assumes the box sits on the ground; reject hits below its base.
  const y = oy + dy * t; return y < cy - hy ? Infinity : t;
}
const _box = { x0: 0, z0: 0, x1: 0, z1: 0, h: 0 };

// Is the straight line between two eye points free of walls and smoke?
// Smoke clouds live in G.smokes as { x, z, r, until }; a segment passing
export function losClear(ax, ay, az, bx, by, bz, colliders, smokes, now) {
  const dx = bx - ax, dy = by - ay, dz = bz - az; const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 0.001) return true; const inv = 1 / len;
  _hit.t = Infinity; raycastWalls(ax, ay, az, dx * inv, dy * inv, dz * inv, len, colliders, _hit);
  if (_hit.hit) return false;
  for (let i = 0; i < smokes.length; i++) {
    const s = smokes[i]; if (s.until < now) continue;
    // Distance from the cloud's axis to the segment, in the ground plane.
    const t = clamp(((s.x - ax) * dx + (s.z - az) * dz) / (len * len), 0, 1);
    const px = ax + dx * t - s.x, pz = az + dz * t - s.z; if (px * px + pz * pz < s.r * s.r) return false;
  }
  return true;
}
const _hit = { t: 0, x: 0, y: 0, z: 0, hit: false };
