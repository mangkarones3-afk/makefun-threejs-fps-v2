// player.js — the human's hands and eyes: keyboard and mouse (pointer
// lock), movement under the same acceleration rules as the bots, the
// camera, and the first-person viewmodel. The camera is where the feel
// systems land: recoil rides on top of the aim pitch and recovers
// along an exponential curve; the trauma shake from feedback.js is
// added as a camera-only offset (the body never moves); the viewmodel
// bobs, sways behind fast looks, kicks with each shot and dips on
// reloads and landings — every motion eased, every one settling back
// to its exact rest value.

import * as THREE from 'three';
import { MOVE } from './config.js';
import { G, makeNoise } from './state.js';
import { clamp } from './physics.js';
import { buildGunMesh, throwGrenade } from './weapons.js';
import { shakeOffset } from './feedback.js';
import { sfxStep, sfxDraw } from './audio.js';

const WALK_SPEED = 3.1;
const SENS = .0021;

// Exponential approach: the workhorse ease for camera and viewmodel.
function damp(cur, target, rate, dt) {
  return cur + (target - cur) * (1 - Math.exp(-rate * dt));
}

export class PlayerController {
  constructor(actor, camera, dom) {
    this.a = actor;
    this.camera = camera;
    this.dom = dom;
    this.keys = new Set();
    this.mouseDown = false;
    this.locked = false;
    this.bobPhase = 0;
    this.fov = 74; // eased toward its target: a sprint stretches it
    this.landDip = 0; // camera dip after a fall, eased back to zero
    this.wasGrounded = true;
    this.prevVy = 0;
    this.prevYaw = 0;
    this.prevPitch = 0;
    this.swayX = 0; // viewmodel lag behind fast looks
    this.swayY = 0;
    this.roll = 0; // strafe lean, eased
    this.viewmodel = new THREE.Group();
    this.gun = null;
    this.deathTilt = 0;
    camera.add(this.viewmodel);
    this.viewmodel.position.set(.24, -.22, -.45);
    this.setGun(actor.current.def.id);
    this.bind();
  }

  setGun(defId) {
    if (this.gun) this.viewmodel.remove(this.gun);
    this.gun = buildGunMesh(defId, true);
    this.gun.position.set(0, -.02, -.1);
    this.viewmodel.add(this.gun);
  }

  bind() {
    const dom = this.dom;
    document.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      const a = this.a;
      if (!a.alive) return;
      if (e.code === 'KeyR') a.current.startReload(a);
      if (e.code === 'Digit1' && a.primary) this.switchTo(a.primary);
      if (e.code === 'Digit2') this.switchTo(a.pistol);
      if (e.code === 'Digit4' || e.code === 'KeyG') {
        if (G.phase === 'live') throwGrenade(a);
      }
      if (e.code === 'Space') e.preventDefault();
      if (e.code === 'Tab') e.preventDefault();
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
    dom.addEventListener('mousedown', (e) => {
      if (!this.locked || e.button !== 0) return;
      this.mouseDown = true;
      this.a.triggerHeld = true;
      this.a.triggerEdge = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button !== 0) return;
      this.mouseDown = false;
      this.a.triggerHeld = false;
    });
    dom.addEventListener('wheel', (e) => {
      const a = this.a;
      if (!this.locked || !a.alive || !a.primary) return;
      this.switchTo(a.current === a.primary ? a.pistol : a.primary);
    }, { passive: true });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked || !this.a.alive) return;
      this.a.yaw -= e.movementX * SENS;
      this.a.pitch = clamp(this.a.pitch - e.movementY * SENS, -1.45, 1.45);
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === dom;
      if (!this.locked) {
        this.mouseDown = false;
        this.a.triggerHeld = false;
        if ((G.phase === 'live' || G.phase === 'buy') && !G.shot) G.paused = true;
      } else {
        G.paused = false;
      }
    });
  }

  requestLock() {
    if (!G.shot) this.dom.requestPointerLock();
  }

  switchTo(inst) {
    const a = this.a;
    if (a.current === inst) return;
    a.current = inst;
    a.drawUntil = G.time + .28;
    this.setGun(inst.def.id);
    sfxDraw();
  }

  update(dt) {
    const a = this.a;
    const cam = this.camera;

    if (!a.alive) {
      // Death cam: sink and tilt where we fell.
      this.deathTilt = Math.min(1, this.deathTilt + dt * 2.2);
      cam.position.set(a.pos.x, a.pos.y + 1.5 - this.deathTilt * 1.05, a.pos.z);
      cam.rotation.set(-.4 * this.deathTilt, a.yaw, .75 * this.deathTilt);
      this.viewmodel.visible = false;
      return;
    }
    this.deathTilt = 0;
    this.viewmodel.visible = true;

    const playing = (G.phase === 'live' || G.phase === 'buy') && !G.paused;
    let wishX = 0, wishZ = 0;
    let speed = 0;
    let fwdInput = 0, rightInput = 0;
    if (playing) {
      const f = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
      const r = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
      fwdInput = f;
      rightInput = r;
      const sin = Math.sin(a.yaw), cos = Math.cos(a.yaw);
      wishX = -sin * f + cos * r;
      wishZ = -cos * f - sin * r;
      a.crouch = this.keys.has('ControlLeft') || this.keys.has('KeyC');
      const walking = this.keys.has('ShiftLeft');
      speed = a.crouch ? MOVE.crouchSpeed : walking ? WALK_SPEED : MOVE.runSpeed;
      speed *= a.current.def.weight;
      if (this.keys.has('Space') && a.grounded) {
        a.vy = MOVE.jumpSpeed;
        a.grounded = false;
      }
      a.wantPlant = this.keys.has('KeyE');
    } else {
      a.wantPlant = false;
    }
    this.prevVy = a.vy;
    a.move(wishX, wishZ, speed, dt);
    // Landing: a real fall thumps the camera down for a beat.
    if (!this.wasGrounded && a.grounded && this.prevVy < -3) {
      this.landDip = Math.min(.15, -this.prevVy * .014);
    }
    this.wasGrounded = a.grounded;
    this.landDip = damp(this.landDip, 0, 7, dt);
    if (this.landDip < .0005) this.landDip = 0;

    // Footsteps: running is loud, walking is quiet, crouching silent.
    if (a.grounded && a.speedNow > .8) {
      a.stepAcc += a.speedNow * dt;
      const stride = a.crouch ? 3.4 : 2.3;
      if (a.stepAcc > stride) {
        a.stepAcc = 0;
        const running = a.speedNow > 3.4 && !a.crouch;
        sfxStep(running);
        if (!a.crouch) makeNoise(a.pos.x, a.pos.z, a.team, running ? 14 : 8);
      }
    }

    // Camera at the eye. Recoil rides on the aim pitch; the trauma
    // shake offsets the camera along its own right and up, plus roll.
    const eye = a.eyePos();
    const rightX = Math.cos(a.yaw);
    const rightZ = -Math.sin(a.yaw);
    cam.position.set(
      eye.x + rightX * shakeOffset.x,
      eye.y + shakeOffset.y - this.landDip,
      eye.z + rightZ * shakeOffset.x,
    );
    const yawVel = dt > 0 ? (a.yaw - this.prevYaw) / dt : 0;
    const pitchVel = dt > 0 ? (a.pitch - this.prevPitch) / dt : 0;
    this.prevYaw = a.yaw;
    this.prevPitch = a.pitch;
    const rollTarget = clamp(-rightInput * .011 - yawVel * .0016, -.03, .03);
    this.roll = damp(this.roll, rollTarget, 11, dt);
    cam.rotation.order = 'YXZ';
    cam.rotation.set(a.pitch + a.recoilPitch, a.yaw, this.roll + shakeOffset.roll);

    // FOV kick: a full sprint forward stretches the view a few degrees.
    const sprinting = a.grounded && a.speedNow > 4.2 && fwdInput > 0;
    const fovTarget = sprinting ? 79 : 74;
    if (Math.abs(fovTarget - this.fov) > .02) {
      this.fov = damp(this.fov, fovTarget, 7, dt);
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }

    // Viewmodel: walk bob, look sway, recoil kick, reload dip, landing
    // dip — all damped, settling exactly at rest.
    this.swayX = damp(this.swayX, clamp(-yawVel * .012, -.055, .055), 13, dt);
    this.swayY = damp(this.swayY, clamp(pitchVel * .01, -.045, .045), 13, dt);
    const bob = a.grounded ? Math.min(1, a.speedNow / 4) : 0;
    this.bobPhase += dt * a.speedNow * 1.7;
    const dip = a.current.reloading
      ? Math.sin(Math.min(1, 1 - a.current.reloadLeft / a.current.def.reload) * Math.PI)
      : 0;
    this.viewmodel.position.set(
      .24 + Math.sin(this.bobPhase) * .008 * bob + this.swayX,
      -.22 + Math.abs(Math.cos(this.bobPhase)) * .01 * bob - dip * .13 + this.swayY - this.landDip * .55,
      -.45 + a.recoilPitch * 1.4,
    );
    this.viewmodel.rotation.x = -dip * .7 + a.recoilPitch * .9;
    this.viewmodel.rotation.y = this.swayX * 1.6;
  }
}
