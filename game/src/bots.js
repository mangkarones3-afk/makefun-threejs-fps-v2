// bots.js — the bot brain: perception, plans, fire control.

import { MOVE } from './config.js';
import { G } from './state.js';
import { findPath, nearestNode, siteAt } from './map.js';
import { losClear, clamp } from './physics.js';

const rand = (a, b) => a + Math.random() * (b - a);

export class Brain {
  constructor(actor) {
    this.a = actor;
    this.skill = rand(.8, 1.3); // aim error scale; lower is deadlier
    this.reaction = rand(.26, .5);
    this.mode = 'hold'; // hold | push | roam
    this.holdPoint = null;
    this.goalSite = 'A';
    this.path = null;
    this.pathIdx = 0;
    this.pathAt = 0;
    this.goal = null; // { x, z }
    this.target = null;
    this.targetSince = 0;
    this.lastSeen = null; // { x, z, at }
    this.thinkAt = Math.random() * .12;
    this.burstUntil = 0;
    this.pauseUntil = 0;
    this.strafeDir = 1;
    this.strafeFlipAt = 0;
    this.crouchUntil = 0;
    this.atSite = false;
    this.clearIdx = 0;
    this.clearWait = 0;
    this.roamIdx = 0;
    this.roamWait = 0;
  }

  reset() {
    this.target = null;
    this.lastSeen = null;
    this.path = null;
    this.goal = null;
    this.atSite = false;
    this.clearIdx = 0;
    this.clearWait = 0;
    this.roamIdx = 0;
    this.roamWait = 0;
    this.a.triggerHeld = false;
  }

  site() {
    return this.goalSite || 'A';
  }

  perceive() {
    const a = this.a;
    if (a.blind) {
      this.target = null;
      return;
    }
    const eye = a.eyePos();
    let best = null;
    let bestD = Infinity;
    for (const e of G.actors) {
      if (!e.alive || e.team === a.team) continue;
      const ee = e.eyePos();
      const d = Math.hypot(ee.x - eye.x, ee.z - eye.z);
      if (d > 62 || d >= bestD) continue;
      // Field of view: wide, but not through the back of the head.
      const ang = Math.atan2(-(ee.x - eye.x), -(ee.z - eye.z));
      const diff = Math.abs(((ang - a.yaw) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
      if (diff > 1.85 && d > 5) continue;
      if (!losClear(eye.x, eye.y, eye.z, ee.x, ee.y - .25, ee.z, G.map.colliders, G.smokes, G.time)) continue;
      best = e;
      bestD = d;
    }
    if (best) {
      if (this.target !== best) this.targetSince = G.time;
      this.target = best;
      this.lastSeen = { x: best.pos.x, z: best.pos.z, at: G.time };
    } else {
      this.target = null;
      // Hearing: a recent enemy shot near enough draws investigation.
      for (let i = G.noises.length - 1; i >= 0; i--) {
        const n = G.noises[i];
        if (n.team === a.team || G.time - n.at > 2.5) continue;
        if (Math.hypot(n.x - a.pos.x, n.z - a.pos.z) < n.radius) {
          if (!this.lastSeen || n.at > this.lastSeen.at) {
            this.lastSeen = { x: n.x, z: n.z, at: n.at };
          }
          break;
        }
      }
    }
  }

  canStillSee() {
    if (!this.target || !this.target.alive) return false;
    const eye = this.a.eyePos();
    const ee = this.target.eyePos();
    return losClear(eye.x, eye.y, eye.z, ee.x, ee.y - .25, ee.z, G.map.colliders, G.smokes, G.time);
  }

  setGoal(x, z) {
    if (!this.goal || Math.hypot(this.goal.x - x, this.goal.z - z) > 2) {
      this.goal = { x, z };
      this.path = null;
    }
  }

  followGoal(dt, speed) {
    const a = this.a;
    if (!this.goal) return true;
    const now = G.time;
    if (!this.path || now - this.pathAt > 3) {
      const from = nearestNode(G.map, a.pos.x, a.pos.z);
      const to = nearestNode(G.map, this.goal.x, this.goal.z);
      const idxPath = findPath(G.map, from, to);
      this.path = idxPath ? idxPath.map((i) => G.map.nodes[i]) : [];
      this.pathIdx = 0;
      this.pathAt = now;
      // Skip nodes already behind us.
      while (this.pathIdx < this.path.length &&
        Math.hypot(this.path[this.pathIdx].x - a.pos.x, this.path[this.pathIdx].z - a.pos.z) < 1.2) {
        this.pathIdx++;
      }
    }
    let tx = this.goal.x;
    let tz = this.goal.z;
    if (this.pathIdx < this.path.length) {
      tx = this.path[this.pathIdx].x;
      tz = this.path[this.pathIdx].z;
      if (Math.hypot(tx - a.pos.x, tz - a.pos.z) < 1.15) {
        this.pathIdx++;
        return this.stepToward(dt, speed, tx, tz);
      }
    }
    return this.stepToward(dt, speed, tx, tz);
  }

  stepToward(dt, speed, tx, tz) {
    const a = this.a;
    const dx = tx - a.pos.x;
    const dz = tz - a.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < .55) return true;
    // Separation, so bots do not stack inside each other.
    let sx = 0, sz = 0;
    for (const o of G.actors) {
      if (o === a || !o.alive) continue;
      const ox = a.pos.x - o.pos.x;
      const oz = a.pos.z - o.pos.z;
      const od = Math.hypot(ox, oz);
      if (od > .01 && od < .9) {
        sx += (ox / od) * (.9 - od);
        sz += (oz / od) * (.9 - od);
      }
    }
    a.move(dx / d + sx * 1.6, dz / d + sz * 1.6, speed, dt);
    if (!this.target) this.faceToward(a.pos.x + dx, a.pos.z + dz, dt, 6);
    return false;
  }

  faceToward(x, z, dt, rate = 9) {
    const a = this.a;
    const want = Math.atan2(-(x - a.pos.x), -(z - a.pos.z));
    const diff = ((want - a.yaw) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
    a.yaw += clamp(diff, -rate * dt, rate * dt);
    return Math.abs(diff) < .05;
  }

  engage(dt) {
    const a = this.a;
    const t = this.target;
    const eye = a.eyePos();
    const dist = Math.hypot(t.pos.x - a.pos.x, t.pos.z - a.pos.z);
    // Aim at the chest, sometimes the head, with an error that grows
    // with range, target speed and this bot's (lack of) skill.
    const headShot = (this.targetSince * 7 % 1) < .28;
    const aimY = t.pos.y + (headShot ? 1.52 : 1.02) - (t.crouch ? .34 : 0);
    const err = this.skill * (.10 + dist * .008) * (1 + t.speedNow * .13);
    const ax = t.pos.x + Math.sin(G.time * 1.7 + a.id * 3) * err;
    const az = t.pos.z + Math.cos(G.time * 1.3 + a.id * 5) * err;
    this.faceToward(ax, az, dt, 10);
    const dy = aimY - eye.y;
    const wantPitch = Math.atan2(dy, Math.max(.1, dist));
    a.pitch += clamp(wantPitch - a.pitch, -6 * dt, 6 * dt);

    // Preferred range by weapon: shotguns close, long guns far.
    const pref = { scatter: 10, raptor: 15, meridian: 20, needle: 26, farshot: 32, p9: 13 }[a.current.def.id] ?? 18;
    if (dist > pref) {
      this.stepToward(dt, MOVE.runSpeed * a.current.def.weight, t.pos.x, t.pos.z);
    } else if (dist < 5) {
      this.stepToward(dt, MOVE.runSpeed * .7, a.pos.x - (t.pos.x - a.pos.x), a.pos.z - (t.pos.z - a.pos.z));
    } else {
      if (G.time > this.strafeFlipAt) {
        this.strafeDir = Math.random() < .5 ? -1 : 1;
        this.strafeFlipAt = G.time + rand(.6, 1.3);
      }
      const bursting = G.time < this.burstUntil;
      const sx = -Math.cos(a.yaw) * this.strafeDir;
      const sz = Math.sin(a.yaw) * this.strafeDir;
      a.move(sx, sz, bursting ? .5 : 1.6, dt);
    }

    // Fire control: a reaction delay on first sight, then bursts
    // separated by pauses booked when the burst starts, so the cycle
    // can never collapse into a continuous stream.
    a.triggerHeld = false;
    a.triggerEdge = false;
    if (G.time - this.targetSince < this.reaction) return;
    if (G.time < this.pauseUntil) return;
    if (G.time >= this.burstUntil) {
      const burst = a.current.def.auto ? rand(.28, .55) : .09;
      this.burstUntil = G.time + burst;
      this.pauseUntil = this.burstUntil + rand(.3, .65) * this.skill;
      if (Math.random() < .3) this.crouchUntil = G.time + rand(.5, 1.1);
    }
    a.crouch = G.time < this.crouchUntil;
    if (a.current.def.auto) a.triggerHeld = true;
    else if (a.current.cooldown <= 0) a.triggerEdge = true;
    // Reload between fights, or swap to the pistol up close.
    if (a.current.mag === 0) {
      if (a.current === a.primary && a.pistol.mag > 0 && dist < 12) {
        a.current = a.pistol;
        a.refreshGunMesh();
      } else {
        a.current.startReload(a);
      }
    }
  }

  update(dt) {
    const a = this.a;
    if (!a.alive || G.phase !== 'live') {
      a.triggerHeld = false;
      return;
    }
    if (G.time >= this.thinkAt) {
      this.thinkAt = G.time + .11;
      this.perceive();
    }
    a.wantPlant = false;
    a.wantDefuse = false;

    if (this.target && this.canStillSee()) {
      this.engage(dt);
      return;
    }
    this.target = null;
    a.triggerHeld = false;
    a.crouch = false;

    const charge = G.charge;
    const mySite = this.site();

    // The charge is down: the nearest attacker fetches it.
    if (a.team === 'atk' && charge.state === 'dropped') {
      let nearest = null;
      let nd = Infinity;
      for (const o of G.actors) {
        if (o.team !== 'atk' || !o.alive) continue;
        const d = Math.hypot(o.pos.x - charge.x, o.pos.z - charge.z);
        if (d < nd) { nd = d; nearest = o; }
      }
      if (nearest === a) {
        this.setGoal(charge.x, charge.z);
        this.followGoal(dt, MOVE.runSpeed);
        return;
      }
    }

    // I carry the charge: get to the site and plant.
    if (a.team === 'atk' && charge.state === 'carried' && charge.carrier === a) {
      const site = G.map.sites[mySite];
      if (siteAt(G.map, a.pos.x, a.pos.z) === site) {
        this.faceToward(site.cx, site.cz - 6, dt, 5);
        a.wantPlant = true;
        a.move(0, 0, 0, dt);
        return;
      }
      this.setGoal(site.cx, site.cz);
      this.followGoal(dt, MOVE.runSpeed * .98);
      return;
    }

    // Planted: defenders converge and one defuses; attackers dig in.
    if (charge.state === 'planted') {
      if (a.team === 'def') {
        const d = Math.hypot(a.pos.x - charge.x, a.pos.z - charge.z);
        let nearest = true;
        for (const o of G.actors) {
          if (o.team !== 'def' || !o.alive || o === a) continue;
          if (Math.hypot(o.pos.x - charge.x, o.pos.z - charge.z) < d) nearest = false;
        }
        if (nearest && d < 1.7) {
          this.faceToward(charge.x, charge.z, dt, 6);
          a.wantDefuse = true;
          a.move(0, 0, 0, dt);
          return;
        }
        this.setGoal(charge.x, charge.z);
        this.followGoal(dt, MOVE.runSpeed);
        return;
      }
      const hp = G.map.holdPoints[charge.site][a.id % G.map.holdPoints[charge.site].length];
      this.setGoal(hp.x, hp.z);
      if (this.followGoal(dt, MOVE.runSpeed * .95)) {
        this.faceToward(charge.x, charge.z, dt, 4);
        a.crouch = a.id % 2 === 0;
      }
      return;
    }

    // Investigate the last sound or sighting.
    if (this.lastSeen && G.time - this.lastSeen.at < 6 && this.mode !== 'hold') {
      this.setGoal(this.lastSeen.x, this.lastSeen.z);
      if (this.followGoal(dt, MOVE.runSpeed * .96)) this.lastSeen = null;
      return;
    }

    switch (this.mode) {
      case 'push': {
        const site = G.map.sites[mySite];
        if (!this.atSite) {
          this.setGoal(site.cx + (a.id % 3 - 1) * 3.4, site.cz + (a.id % 2) * 3);
          if (this.followGoal(dt, MOVE.runSpeed * .97)) this.atSite = true;
          break;
        }
        // On site: clear the defenders' likely positions one by one.
        const pts = G.map.holdPoints[mySite];
        const hp = pts[(a.id + this.clearIdx) % pts.length];
        this.setGoal(hp.x, hp.z);
        if (this.followGoal(dt, MOVE.runSpeed * .9)) {
          if (!this.clearWait) this.clearWait = G.time + 1.4;
          if (G.time >= this.clearWait) {
            this.clearIdx++;
            this.clearWait = 0;
          }
          this.faceToward(site.cx, site.cz, dt, 3);
        }
        break;
      }
      case 'roam': {
        const pts = G.map.holdPoints.mid;
        const hp = pts[(a.id + this.roamIdx) % pts.length];
        this.setGoal(hp.x, hp.z);
        if (this.followGoal(dt, MOVE.runSpeed * .94)) {
          a.yaw += dt * .7 * (a.id % 2 ? 1 : -1); // slow scan
          if (!this.roamWait) this.roamWait = G.time + 2.6;
          if (G.time >= this.roamWait) {
            this.roamIdx++;
            this.roamWait = 0;
          }
        }
        break;
      }
      default: { // hold
        const hp = this.holdPoint ?? G.map.holdPoints[mySite][a.id % 2];
        this.setGoal(hp.x, hp.z);
        if (this.followGoal(dt, MOVE.runSpeed * .95)) {
          this.faceToward(a.pos.x - Math.sin(hp.yaw), a.pos.z - Math.cos(hp.yaw), dt, 3);
          a.crouch = a.id % 3 === 0;
        }
      }
    }

    if (a.current.mag < a.current.def.mag * .4 && !a.current.reloading) {
      a.current.startReload(a);
    }
  }
}
