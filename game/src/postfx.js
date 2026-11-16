// postfx.js — the fullscreen finish: the rendered frame passes once
// through a shader that lays on the vignette, the warm sodium grade, a
// breath of grain, the damage vignette and the flashbang white-out.
// One extra pass, one texture sample per pixel — the sandbox frame
// budget never notices it, and the night looks graded rather than raw.

import * as THREE from 'three';
import { G } from './state.js';
import { POST_VERT, POST_FRAG } from './shaders.js';

export class PostFX {
  constructor(renderer) {
    this.renderer = renderer;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: 4,
    });
    this.uniforms = {
      tDiffuse: { value: this.target.texture },
      uTime: { value: 0 },
      uVignette: { value: 1 },
      uFlash: { value: 0 },
      uHurt: { value: 0 },
    };
    // A single fullscreen triangle: no oversized quad corners shading
    // pixels nobody sees.
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -1, -1, 0, 3, -1, 0, -1, 3, 0,
    ]), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([
      0, 0, 2, 0, 0, 2,
    ]), 2));
    const mat = new THREE.ShaderMaterial({
      vertexShader: POST_VERT,
      fragmentShader: POST_FRAG,
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
    });
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.Mesh(geo, mat));
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  resize() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.target.setSize(size.x, size.y);
  }

  // Render the world into the target, then grade it onto the screen.
  render(scene, camera, rdt) {
    this.uniforms.uTime.value += rdt;
    this.uniforms.uFlash.value = Math.min(1, (G.flashTime ?? 0) / 1.6);
    this.uniforms.uHurt.value = Math.min(1, (G.damageFlash ?? 0) * .9);
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
  }
}
